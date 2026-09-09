import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

REGION = os.environ['AWS_REGION']
ACCOUNT = os.environ['ACCOUNT_ID']
PARTITION = os.environ['PARTITION']
MONITOR = os.environ['MONITOR']
NAMESPACE = 'Generator/Health'
CLIENT_CONFIG = Config(retries={'mode': 'standard', 'max_attempts': 5}, connect_timeout=3, read_timeout=20)
CLIENTS = {name: boto3.client(name, config=CLIENT_CONFIG) for name in ['sqs', 'lambda', 'sns', 'events', 'scheduler', 'cloudwatch']}


def pages(service, operation, key, **kwargs):
    client = CLIENTS[service]
    if client.can_paginate(operation):
        for page in client.get_paginator(operation).paginate(**kwargs):
            yield from page.get(key, [])
    else:
        # ListEventBuses has NextToken but no SDK paginator.
        while True:
            page = getattr(client, operation)(**kwargs)
            yield from page.get(key, [])
            if not page.get('NextToken'):
                break
            kwargs['NextToken'] = page['NextToken']


def parallel(function, values):
    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(function, values))


def disappeared(error):
    return error.response['Error']['Code'] in ['ResourceNotFoundException', 'NotFound', 'NotFoundException', 'AWS.SimpleQueueService.NonExistentQueue', 'QueueDoesNotExist']


def queue_info(url):
    try:
        attrs = CLIENTS['sqs'].get_queue_attributes(QueueUrl=url, AttributeNames=[
            'QueueArn', 'RedrivePolicy', 'ApproximateNumberOfMessagesVisible',
            'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed',
        ])['Attributes']
        tags = CLIENTS['sqs'].list_queue_tags(QueueUrl=url).get('Tags', {})
        return attrs, tags
    except ClientError as error:
        if disappeared(error):
            return None
        raise


def invoke_destinations(name):
    try:
        return [item.get('DestinationConfig', {}).get('OnFailure', {}).get('Destination', '')
                for item in pages('lambda', 'list_function_event_invoke_configs', 'FunctionEventInvokeConfigs', FunctionName=name)]
    except ClientError as error:
        if disappeared(error):
            return []
        raise


def subscription_dlq(subscription):
    arn = subscription['SubscriptionArn']
    if not arn.startswith('arn:'):
        return ''
    try:
        attrs = CLIENTS['sns'].get_subscription_attributes(SubscriptionArn=arn)['Attributes']
        return json.loads(attrs.get('RedrivePolicy', '{}')).get('deadLetterTargetArn', '')
    except ClientError as error:
        if disappeared(error):
            return ''
        raise


def bus_dlqs(bus):
    name = bus['Name']
    try:
        result = [CLIENTS['events'].describe_event_bus(Name=name).get('DeadLetterConfig', {}).get('Arn', '')]
        for rule in pages('events', 'list_rules', 'Rules', EventBusName=name):
            for target in pages('events', 'list_targets_by_rule', 'Targets', EventBusName=name, Rule=rule['Name']):
                result.append(target.get('DeadLetterConfig', {}).get('Arn', ''))
        return result
    except ClientError as error:
        if disappeared(error):
            return []
        raise


def schedule_dlq(schedule):
    try:
        return CLIENTS['scheduler'].get_schedule(Name=schedule['Name'], GroupName=schedule['GroupName']).get('Target', {}).get('DeadLetterConfig', {}).get('Arn', '')
    except ClientError as error:
        if disappeared(error):
            return ''
        raise


def discover():
    queues = {}
    targets = set()
    for info in parallel(queue_info, pages('sqs', 'list_queues', 'QueueUrls', PaginationConfig={'PageSize': 1000})):
        if info is None:
            continue
        attrs, tags = info
        queues[attrs['QueueArn']] = attrs
        targets.add(json.loads(attrs.get('RedrivePolicy', '{}')).get('deadLetterTargetArn', ''))
        if tags.get('MonitoringRole', '').lower() == 'dlq':
            targets.add(attrs['QueueArn'])
    functions = set()
    for function in pages('lambda', 'list_functions', 'Functions', FunctionVersion='ALL'):
        functions.add(function['FunctionName'])
        targets.add(function.get('DeadLetterConfig', {}).get('TargetArn', ''))
    for destinations in parallel(invoke_destinations, sorted(functions)):
        targets.update(destinations)
    for mapping in pages('lambda', 'list_event_source_mappings', 'EventSourceMappings'):
        targets.add(mapping.get('DestinationConfig', {}).get('OnFailure', {}).get('Destination', ''))
    targets.update(parallel(subscription_dlq, pages('sns', 'list_subscriptions', 'Subscriptions')))
    for destinations in parallel(bus_dlqs, pages('events', 'list_event_buses', 'EventBuses')):
        targets.update(destinations)
    targets.update(parallel(schedule_dlq, pages('scheduler', 'list_schedules', 'Schedules')))
    prefix = f'arn:{PARTITION}:sqs:{REGION}:{ACCOUNT}:'
    targets = {arn for arn in targets if arn.startswith(prefix)}
    # A disappearing queue must not turn a discovery gap into an all-clear sample.
    missing = targets - queues.keys()
    if missing:
        raise RuntimeError('Configured DLQs missing from queue inventory: ' + ', '.join(sorted(missing)))
    return {arn: queues[arn] for arn in targets}, sorted(functions)


def lambda_rates(functions, now):
    # Inspect each five-minute bucket independently; busy healthy functions cannot mask failures.
    # Look back 20 minutes because Errors is timestamped at invocation start, even for long runs.
    end = int(now.timestamp()) // 300 * 300
    start = end - 1200
    minimum = int(os.environ.get('MIN_INVOCATIONS', '1'))
    rates = []
    for offset in range(0, len(functions), 200):
        batch = functions[offset:offset + 200]
        queries = []
        for index, name in enumerate(batch):
            for suffix, metric in [('e', 'Errors'), ('i', 'Invocations')]:
                queries.append({'Id': f'f{index}{suffix}', 'ReturnData': True, 'MetricStat': {
                    'Metric': {'Namespace': 'AWS/Lambda', 'MetricName': metric, 'Dimensions': [{'Name': 'FunctionName', 'Value': name}]},
                    'Period': 300, 'Stat': 'Sum',
                }})
        args = {'MetricDataQueries': queries, 'StartTime': datetime.fromtimestamp(start, timezone.utc), 'EndTime': datetime.fromtimestamp(end, timezone.utc)}
        samples = {query['Id']: {} for query in queries}
        seen = set()
        while True:
            response = CLIENTS['cloudwatch'].get_metric_data(**args)
            if response.get('Messages'):
                raise RuntimeError('Metric query warning: ' + json.dumps(response['Messages']))
            for result in response.get('MetricDataResults', []):
                status = result.get('StatusCode')
                if status not in ('Complete', 'PartialData') or (status == 'PartialData' and not response.get('NextToken')):
                    raise RuntimeError('Incomplete Lambda metrics: ' + result['Id'] + ' ' + str(status))
                seen.add(result['Id'])
                samples[result['Id']].update(zip(result['Timestamps'], result['Values']))
            if not response.get('NextToken'):
                break
            args['NextToken'] = response['NextToken']
        if seen != samples.keys():
            raise RuntimeError('Missing Lambda metric query results')
        for index, name in enumerate(batch):
            errors, invocations = samples[f'f{index}e'], samples[f'f{index}i']
            highest = 0.0
            for stamp in errors.keys() | invocations.keys():
                count = max(invocations.get(stamp, 0), errors.get(stamp, 0))
                if count >= minimum:
                    highest = max(highest, 100 * errors.get(stamp, 0) / count)
            rates.append((name, highest))
    return rates


def handler(event, context):
    now = datetime.now(timezone.utc)
    queues, functions = discover()
    depths = [(arn, sum(int(attrs.get(key, '0')) for key in [
        'ApproximateNumberOfMessagesVisible', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed',
    ])) for arn, attrs in queues.items()]
    rates = lambda_rates(functions, now)
    depth = sum(value for _, value in depths)
    worst = max((value for _, value in rates), default=0)
    # Publish only after a complete scan. Failures yield missing data, never false zeroes.
    CLIENTS['cloudwatch'].put_metric_data(Namespace=NAMESPACE, MetricData=[
        {'MetricName': name, 'Dimensions': [{'Name': 'Monitor', 'Value': MONITOR}], 'Timestamp': now, 'Value': value, 'Unit': unit}
        for name, value, unit in [('DLQDepth', depth, 'Count'), ('WorstLambdaErrorRate', worst, 'Percent')]
    ])
    result = {'dlqCount': len(queues), 'lambdaCount': len(functions), 'depth': depth, 'worstErrorRate': worst,
              'nonemptyDLQs': sorted([(arn, value) for arn, value in depths if value], key=lambda pair: -pair[1])[:20],
              'failingFunctions': sorted([(name, value) for name, value in rates if value], key=lambda pair: -pair[1])[:20]}
    print(json.dumps(result))
    return result

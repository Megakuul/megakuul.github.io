import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

os.environ.update(AWS_REGION='eu-central-1', ACCOUNT_ID='111122223333', PARTITION='aws', MONITOR='test-monitor', MIN_INVOCATIONS='1')
path = Path(__file__).resolve().parents[1] / 'src/routes/worldskills/generator/snippets/health-monitor.py'
spec = importlib.util.spec_from_file_location('health_monitor', path)
monitor = importlib.util.module_from_spec(spec)
with patch('boto3.client'):
    spec.loader.exec_module(monitor)


def arn(name):
    return 'arn:aws:sqs:eu-central-1:111122223333:' + name


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.clients = {name: MagicMock() for name in monitor.CLIENTS}
        monitor.CLIENTS = self.clients
        self.inventory = {}
        self.queue_attrs = {}
        self.queue_tags = {}
        for service, client in self.clients.items():
            client.can_paginate.return_value = True
            def paginator(operation, service=service):
                def paginate(**kwargs):
                    value = self.inventory.get((service, operation), [])
                    return iter(value(kwargs) if callable(value) else value)
                result = MagicMock()
                result.paginate.side_effect = paginate
                return result
            client.get_paginator.side_effect = paginator
        self.clients['sqs'].get_queue_attributes.side_effect = lambda **kw: {'Attributes': self.queue_attrs[kw['QueueUrl']]}
        self.clients['sqs'].list_queue_tags.side_effect = lambda **kw: {'Tags': self.queue_tags.get(kw['QueueUrl'], {})}

    def queue(self, name, depth=0, target=None, tagged=False):
        url = 'https://sqs.eu-central-1.amazonaws.com/111122223333/' + name
        self.queue_attrs[url] = {'QueueArn': arn(name), 'ApproximateNumberOfMessagesVisible': str(depth), 'ApproximateNumberOfMessagesNotVisible': '0', 'ApproximateNumberOfMessagesDelayed': '0'}
        if target:
            self.queue_attrs[url]['RedrivePolicy'] = json.dumps({'deadLetterTargetArn': arn(target)})
        if tagged:
            self.queue_tags[url] = {'MonitoringRole': 'dlq'}
        return url

    def metric_results(self, queries, values=None):
        stamp = datetime(2026, 9, 9, 12, 0, tzinfo=timezone.utc)
        return [{'Id': q['Id'], 'StatusCode': 'Complete', 'Timestamps': [stamp] if values else [], 'Values': [values(q)] if values else []} for q in queries]

    def test_discovers_actual_targets_across_services_and_pagination(self):
        names = ['sqs-target', 'lambda-target', 'version-target', 'async-target', 'mapping-target', 'sns-target', 'bus-target', 'rule-target', 'schedule-target', 'unattached']
        urls = [self.queue(name, tagged=name == 'unattached') for name in names]
        urls += [self.queue('busy-normal-queue', depth=999), self.queue('source', target='sqs-target')]
        self.inventory['sqs', 'list_queues'] = [{'QueueUrls': urls[:4]}, {'QueueUrls': urls[4:]}]
        self.inventory['lambda', 'list_functions'] = [
            {'Functions': [{'FunctionName': 'worker', 'DeadLetterConfig': {'TargetArn': arn('lambda-target')}}]},
            {'Functions': [{'FunctionName': 'worker', 'Version': '1', 'DeadLetterConfig': {'TargetArn': arn('version-target')}}]},
        ]
        self.inventory['lambda', 'list_function_event_invoke_configs'] = [{'FunctionEventInvokeConfigs': [{'DestinationConfig': {'OnFailure': {'Destination': arn('async-target')}}}]}]
        self.inventory['lambda', 'list_event_source_mappings'] = [{'EventSourceMappings': [{'DestinationConfig': {'OnFailure': {'Destination': arn('mapping-target')}}}]}]
        self.inventory['sns', 'list_subscriptions'] = [{'Subscriptions': [{'SubscriptionArn': 'PendingConfirmation'}, {'SubscriptionArn': 'arn:aws:sns:eu-central-1:111122223333:topic:subscription'}]}]
        self.clients['sns'].get_subscription_attributes.return_value = {'Attributes': {'RedrivePolicy': json.dumps({'deadLetterTargetArn': arn('sns-target')})}}
        self.inventory['events', 'list_event_buses'] = [{'EventBuses': [{'Name': 'default'}]}]
        self.clients['events'].describe_event_bus.return_value = {'DeadLetterConfig': {'Arn': arn('bus-target')}}
        self.inventory['events', 'list_rules'] = [{'Rules': [{'Name': 'rule'}]}]
        self.inventory['events', 'list_targets_by_rule'] = [{'Targets': [{'DeadLetterConfig': {'Arn': arn('rule-target')}}]}]
        self.inventory['scheduler', 'list_schedules'] = [{'Schedules': [{'Name': 'daily', 'GroupName': 'default'}]}]
        self.clients['scheduler'].get_schedule.return_value = {'Target': {'DeadLetterConfig': {'Arn': arn('schedule-target')}}}
        queues, functions = monitor.discover()
        self.assertEqual(set(queues), {arn(name) for name in names})
        self.assertEqual(functions, ['worker'])
        self.clients['sns'].get_subscription_attributes.assert_called_once()
        # A new unattached DLQ joins on the next scan without editing the alarm.
        urls.append(self.queue('new-dlq', tagged=True))
        self.inventory['sqs', 'list_queues'].append({'QueueUrls': [urls[-1]]})
        self.assertIn(arn('new-dlq'), monitor.discover()[0])

    def test_low_volume_failure_is_not_hidden_by_busy_healthy_functions(self):
        functions = ['critical', 'busy']
        def get_metrics(**kwargs):
            results = self.metric_results(kwargs['MetricDataQueries'], lambda q: {'f0e': 1, 'f0i': 1, 'f1e': 0, 'f1i': 100000}[q['Id']])
            if 'NextToken' not in kwargs:
                return {'MetricDataResults': results[:2], 'NextToken': 'next'}
            return {'MetricDataResults': results[2:]}
        self.clients['cloudwatch'].get_metric_data.side_effect = get_metrics
        rates = dict(monitor.lambda_rates(functions, datetime(2026, 9, 9, 12, 10, tzinfo=timezone.utc)))
        self.assertEqual(rates, {'critical': 100, 'busy': 0})
        args = self.clients['cloudwatch'].get_metric_data.call_args.kwargs
        self.assertEqual(args['NextToken'], 'next')
        self.assertEqual((args['EndTime'] - args['StartTime']).total_seconds(), 1200)
        for query in args['MetricDataQueries']:
            self.assertEqual(query['MetricStat']['Metric']['Dimensions'][0]['Name'], 'FunctionName')

    def test_event_bus_manual_pagination(self):
        client = self.clients['events']
        client.can_paginate.return_value = False
        client.list_event_buses.side_effect = [
            {'EventBuses': [{'Name': 'one'}], 'NextToken': 'next'},
            {'EventBuses': [{'Name': 'two'}]},
        ]
        self.assertEqual(list(monitor.pages('events', 'list_event_buses', 'EventBuses')), [{'Name': 'one'}, {'Name': 'two'}])
        self.assertEqual(client.list_event_buses.call_args.kwargs, {'NextToken': 'next'})

    def test_more_than_one_metric_batch_and_idle_functions(self):
        self.clients['cloudwatch'].get_metric_data.side_effect = lambda **kw: {'MetricDataResults': self.metric_results(kw['MetricDataQueries'])}
        rates = monitor.lambda_rates([f'worker-{i}' for i in range(401)], datetime.now(timezone.utc))
        self.assertEqual(len(rates), 401)
        self.assertTrue(all(value == 0 for _, value in rates))
        self.assertEqual(self.clients['cloudwatch'].get_metric_data.call_count, 3)

    def test_depth_includes_visible_inflight_and_delayed_messages(self):
        attrs = {'ApproximateNumberOfMessagesVisible': '1', 'ApproximateNumberOfMessagesNotVisible': '2', 'ApproximateNumberOfMessagesDelayed': '3'}
        with patch.object(monitor, 'discover', return_value=({arn('dlq'): attrs}, ['worker'])), patch.object(monitor, 'lambda_rates', return_value=[('worker', 25)]):
            result = monitor.handler({}, None)
        self.assertEqual(result['depth'], 6)
        data = self.clients['cloudwatch'].put_metric_data.call_args.kwargs['MetricData']
        self.assertEqual({x['MetricName']: x['Value'] for x in data}, {'DLQDepth': 6, 'WorstLambdaErrorRate': 25})

    def test_incomplete_metric_data_never_publishes_zeroes(self):
        self.clients['cloudwatch'].get_metric_data.return_value = {'MetricDataResults': [{'Id': 'f0e', 'StatusCode': 'Forbidden'}]}
        with patch.object(monitor, 'discover', return_value=({}, ['worker'])):
            with self.assertRaisesRegex(RuntimeError, 'Incomplete Lambda metrics'):
                monitor.handler({}, None)
        self.clients['cloudwatch'].put_metric_data.assert_not_called()

    def test_discovery_failure_never_publishes_zeroes(self):
        with patch.object(monitor, 'discover', side_effect=RuntimeError('AccessDenied')):
            with self.assertRaisesRegex(RuntimeError, 'AccessDenied'):
                monitor.handler({}, None)
        self.clients['cloudwatch'].put_metric_data.assert_not_called()

    def test_configured_missing_queue_is_not_reported_healthy(self):
        url = self.queue('source', target='missing')
        self.inventory['sqs', 'list_queues'] = [{'QueueUrls': [url]}]
        with self.assertRaisesRegex(RuntimeError, 'missing from queue inventory'):
            monitor.discover()


if __name__ == '__main__':
    unittest.main()

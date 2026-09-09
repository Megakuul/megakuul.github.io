import json
import os
import re
import sys
import urllib.parse
import zipfile
from pathlib import Path

work = Path(sys.argv[1])
action = sys.argv[2]
logical = sys.argv[3] if len(sys.argv) > 3 else ''
template = json.loads((work / 'template.json').read_text())
identity = json.loads((work / 'identity.json').read_text())
region = os.environ['REGION']
account = identity['Account']
partition = identity['Arn'].split(':')[1]
prefix = os.environ['NAME']
resources = template['Resources']
env_parameters = {'RetentionDays': 'RETENTION', 'RateLimit': 'RATE_LIMIT', 'ManagedRuleMode': 'MANAGED_RULES', 'IncludeGlobalIAM': 'GLOBAL_IAM', 'ErrorRatePercent': 'ERROR_RATE', 'MinInvocations': 'MIN_INVOCATIONS', 'NotificationTopicArn': 'TOPIC_ARN', 'VpcId': 'VPC_ID', 'GroupNames': 'SG_NAMES', 'TagKey': 'TAG_KEY', 'TagValue': 'TAG_VALUE'}
parameters = {}
for key, definition in template['Parameters'].items():
    value = os.environ.get(env_parameters[key], definition.get('Default'))
    if value is None:
        raise ValueError('Set ' + env_parameters[key])
    if definition['Type'] == 'Number':
        value = float(value) if '.' in str(value) else int(value)
    if 'AllowedValues' in definition and value not in definition['AllowedValues']:
        raise ValueError('Invalid ' + env_parameters[key])
    if 'MinValue' in definition and value < definition['MinValue'] or 'MaxValue' in definition and value > definition['MaxValue']:
        raise ValueError('Out of range: ' + env_parameters[key])
    parameters[key] = value
parameters.update({'AWS::Region': region, 'AWS::AccountId': account, 'AWS::Partition': partition, 'AWS::StackName': prefix, 'AWS::NoValue': None})
parameters['GroupName'] = os.environ.get('SG_NAME')


def read(name):
    path = work / (name + '.json')
    return json.loads(path.read_text()) if path.exists() and path.stat().st_size else {}


def name(key):
    resource = resources[key]
    props = resource.get('Properties', {})
    kind = resource['Type']
    if kind == 'AWS::S3::Bucket':
        return prefix[:24].lower() + '-' + account + '-' + region
    field = {'AWS::Logs::LogGroup': 'LogGroupName', 'AWS::SQS::Queue': 'QueueName', 'AWS::Lambda::Function': 'FunctionName', 'AWS::Config::ConfigurationRecorder': 'Name', 'AWS::Config::DeliveryChannel': 'Name', 'AWS::WAFv2::WebACL': 'Name', 'AWS::Logs::DeliveryDestination': 'Name', 'AWS::EC2::SecurityGroup': 'GroupName', 'AWS::CloudWatch::Alarm': 'AlarmName'}.get(kind)
    return resolve(props[field]) if field and field in props else prefix + '-' + key


def arn(key):
    kind = resources[key]['Type']
    n = name(key)
    base = 'arn:' + partition + ':'
    if kind == 'AWS::S3::Bucket':
        return base + 's3:::' + n
    if kind in ('AWS::IAM::Role', 'AWS::IAM::ManagedPolicy', 'AWS::IAM::InstanceProfile'):
        typ = {'AWS::IAM::Role': 'role', 'AWS::IAM::ManagedPolicy': 'policy', 'AWS::IAM::InstanceProfile': 'instance-profile'}[kind]
        return base + 'iam::' + account + ':' + typ + resources[key].get('Properties', {}).get('Path', '/') + n
    if kind == 'AWS::WAFv2::WebACL':
        response = read(key)
        return response.get('WebACL', response.get('Summary', {}))['ARN']
    if kind == 'AWS::Logs::DeliveryDestination':
        return read(key)['deliveryDestination']['arn']
    service, resource = {'AWS::Logs::LogGroup': ('logs', 'log-group:' + n), 'AWS::SQS::Queue': ('sqs', n), 'AWS::SNS::Topic': ('sns', n), 'AWS::Lambda::Function': ('lambda', 'function:' + n), 'AWS::Events::Rule': ('events', 'rule/' + n), 'AWS::CloudWatch::Alarm': ('cloudwatch', 'alarm:' + n)}[kind]
    return base + service + ':' + region + ':' + account + ':' + resource


def reference(key):
    if key in parameters:
        return parameters[key]
    kind = resources[key]['Type']
    if kind == 'AWS::SQS::Queue':
        return read(key)['QueueUrl']
    if kind in ('AWS::SNS::Topic', 'AWS::IAM::ManagedPolicy'):
        return arn(key)
    if kind == 'AWS::EC2::SecurityGroup':
        response = read(key)
        return response.get('GroupId') or response['SecurityGroups'][0]['GroupId']
    return name(key)


def resolve(value):
    if isinstance(value, list):
        return [v for item in value if (v := resolve(item)) is not None]
    if not isinstance(value, dict):
        return value
    if 'Ref' in value:
        return reference(value['Ref'])
    if 'Fn::GetAtt' in value:
        key, attribute = value['Fn::GetAtt']
        if attribute == 'GroupId':
            return reference(key)
        if attribute != 'Arn':
            raise ValueError('Unsupported attribute: ' + attribute)
        return arn(key) + (':*' if resources[key]['Type'] == 'AWS::Logs::LogGroup' else '')
    if 'Fn::Sub' in value:
        def replace(match):
            key = match[1]
            return str(resolve({'Fn::GetAtt': key.split('.', 1)}) if '.' in key else reference(key))
        return re.sub(r'\$\{([^}]+)\}', replace, value['Fn::Sub'])
    if 'Fn::If' in value:
        condition, yes, no = value['Fn::If']
        return resolve(yes if resolve(template['Conditions'][condition]) else no)
    if 'Fn::Equals' in value:
        left, right = resolve(value['Fn::Equals'])
        return left == right
    if 'Fn::Not' in value:
        return not resolve(value['Fn::Not'][0])
    if 'Fn::Join' in value:
        separator, items = value['Fn::Join']
        return separator.join(resolve(items))
    return {key: result for key, item in value.items() if (result := resolve(item)) is not None}


def props(key):
    return resolve(resources[key].get('Properties', {}))


def tags(p):
    return p.get('Tags', [{'Key': parameters['TagKey'], 'Value': parameters['TagValue']}])


def tagmap(p):
    return {tag['Key']: tag['Value'] for tag in tags(p)}


def dump(value):
    print(json.dumps(value, separators=(',', ':')))


if action == 'init':
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,29}', prefix):
        raise ValueError('NAME must be 1-30 lowercase letters, digits or hyphens, starting with a letter')
    key = parameters['TagKey']
    if not key or key.lower().startswith('aws:') or key == 'MonitoringRole':
        raise ValueError('Use a custom tag key; aws: and MonitoringRole are reserved')
    if len(key) > 128 or len(parameters['TagValue']) > 256:
        raise ValueError('Tag key/value too long')
    if 'GroupNames' in parameters:
        names = [n.strip() for n in parameters['GroupNames'].split(',')]
        if not all(names) or len(set(n.lower() for n in names)) != len(names):
            raise ValueError('Supply unique, comma-separated SG_NAMES')
        if not all(1 <= len(n) <= 255 and not n.lower().startswith('sg-') and re.fullmatch(r'[a-zA-Z0-9 ._:/()#@\[\]+=&;{}!$*-]+', n) for n in names):
            raise ValueError('Invalid security group name')
        (work / 'names').write_bytes(('\0'.join(names) + '\0').encode())
    sys.exit()

if action == 'field':
    value = read(logical)
    for key in sys.argv[4].split('.'):
        value = value[key]
    print(value if isinstance(value, str) else json.dumps(value))
    sys.exit()
if action == 'value':
    print(reference(logical))
    sys.exit()
if action == 'arn':
    print(arn(logical))
    sys.exit()
if action == 'outputs':
    if logical == 'SecurityGroup':
        dump({'Name': name(logical), 'GroupId': reference(logical)})
    else:
        dump({key: resolve(output['Value']) for key, output in template.get('Outputs', {}).items() if not key.startswith('Fn::')})
    sys.exit()
if action == 'existing-config':
    recorders = read('existing')['ConfigurationRecorders']
    existing = next((r for r in recorders if not r.get('servicePrincipal')), None)
    if existing and (existing['name'] != prefix or existing['roleARN'] != arn('ConfigRole')):
        print(existing['name'])
    sys.exit()
if action == 'config-existing-tag':
    recorder = next(r for r in read('existing')['ConfigurationRecorders'] if r['name'] == os.environ['RECORDER'])
    dump({'ResourceArn': recorder['arn'], 'Tags': tags({})})
    sys.exit()
if action == 'config-tag':
    dump({'ResourceArn': read(logical)['ConfigurationRecorders'][0]['arn'], 'Tags': tags({})})
    sys.exit()

p = props(logical)
n = name(logical)
if action == 'log-create':
    result = {'logGroupName': n, 'tags': tagmap(p), 'deletionProtectionEnabled': True, 'logGroupClass': p.get('LogGroupClass', 'STANDARD')}
elif action == 'log-retention':
    result = {'logGroupName': n, 'retentionInDays': p['RetentionInDays']}
elif action == 'log-protect':
    result = {'logGroupIdentifier': n, 'deletionProtectionEnabled': True}
elif action == 'log-tag':
    result = {'resourceArn': arn(logical), 'tags': tagmap(p)}
elif action == 'log-policy':
    result = {'policyName': p['PolicyName'], 'policyDocument': p['PolicyDocument']}
elif action == 'delivery-put':
    result = {'name': n, 'outputFormat': p['OutputFormat'], 'deliveryDestinationConfiguration': {'destinationResourceArn': p['DestinationResourceArn']}, 'tags': tagmap(p)}
elif action == 'delivery-tag':
    result = {'resourceArn': arn(logical), 'tags': tagmap(p)}
elif action == 'role-create':
    result = {'RoleName': n, 'Path': p.get('Path', '/'), 'AssumeRolePolicyDocument': json.dumps(p['AssumeRolePolicyDocument']), 'Tags': tags(p)}
    if p.get('Description'):
        result['Description'] = p['Description']
elif action == 'role-trust':
    result = {'RoleName': n, 'PolicyDocument': json.dumps(p['AssumeRolePolicyDocument'])}
elif action == 'role-tag':
    result = {'RoleName': n, 'Tags': tags(p)}
elif action == 'role-policy':
    policy = p['Policies'][int(sys.argv[4])]
    result = {'RoleName': n, 'PolicyName': policy['PolicyName'], 'PolicyDocument': json.dumps(policy['PolicyDocument'])}
elif action == 'role-attach':
    result = {'RoleName': n, 'PolicyArn': p['ManagedPolicyArns'][int(sys.argv[4])]}
elif action == 'profile-create':
    result = {'InstanceProfileName': n, 'Tags': tags(p)}
elif action == 'profile-tag':
    result = {'InstanceProfileName': n, 'Tags': tags(p)}
elif action == 'profile-add':
    roles = read(logical)['InstanceProfile']['Roles']
    if roles and [r['RoleName'] for r in roles] != p['Roles']:
        raise ValueError('Existing instance profile contains a different role')
    result = {'InstanceProfileName': n, 'RoleName': p['Roles'][0]} if not roles else None
elif action == 'queue-create':
    result = {'QueueName': n, 'Attributes': {key: json.dumps(value) if not isinstance(value, str) else value for key, value in p.items() if key not in ('QueueName', 'Tags')}, 'tags': tagmap(p)}
elif action == 'queue-set':
    result = {'QueueUrl': reference(logical), 'Attributes': {key: json.dumps(value) if not isinstance(value, str) else value for key, value in p.items() if key not in ('QueueName', 'Tags')}}
elif action == 'queue-tag':
    result = {'QueueUrl': reference(logical), 'Tags': tagmap(p)}
elif action == 'queue-policy':
    result = {'QueueUrl': p['Queues'][0], 'Attributes': {'Policy': json.dumps(p['PolicyDocument'])}}
elif action == 'policy-create':
    result = {'PolicyName': n, 'PolicyDocument': json.dumps(p['PolicyDocument']), 'Description': p['Description'], 'Tags': tags(p)}
elif action == 'policy-tag':
    result = {'PolicyArn': arn(logical), 'Tags': tags(p)}
elif action == 'policy-check':
    document = read(logical)['PolicyVersion']['Document']
    if isinstance(document, str):
        document = json.loads(urllib.parse.unquote(document))
    if document != p['PolicyDocument']:
        raise ValueError('Existing managed policy differs; choose another NAME or revise the policy explicitly')
    sys.exit()
elif action == 'policy-attach':
    result = {'RoleName': p['Roles'][0], 'PolicyArn': arn(logical)} if p.get('Roles') else None
elif action == 'waf-create':
    result = {key: p[key] for key in ('Name', 'Scope', 'DefaultAction', 'VisibilityConfig', 'Rules', 'Tags')}
elif action == 'waf-get':
    summary = read(logical).get('Summary')
    if not summary:
        matches = [acl for acl in read('waf-list')['WebACLs'] if acl['Name'] == n]
        if len(matches) != 1:
            raise ValueError('Cannot locate existing Web ACL')
        summary = matches[0]
    result = {'Name': n, 'Scope': p['Scope'], 'Id': summary['Id']}
elif action == 'waf-update':
    previous = read(logical)
    result = {key: p[key] for key in ('Name', 'Scope', 'DefaultAction', 'VisibilityConfig', 'Rules')}
    result.update(Id=previous['WebACL']['Id'], LockToken=previous['LockToken'])
elif action == 'waf-tag':
    result = {'ResourceARN': arn(logical), 'Tags': tags(p)}
elif action == 'waf-logging':
    result = {'LoggingConfiguration': p}
elif action == 'bucket-create':
    result = {'Bucket': n, 'ObjectOwnership': 'BucketOwnerEnforced'}
    if region != 'us-east-1':
        result['CreateBucketConfiguration'] = {'LocationConstraint': region}
elif action == 'bucket-public':
    result = {'Bucket': n, 'PublicAccessBlockConfiguration': p['PublicAccessBlockConfiguration']}
elif action == 'bucket-encryption':
    result = {'Bucket': n, 'ServerSideEncryptionConfiguration': {'Rules': [{'ApplyServerSideEncryptionByDefault': rule['ServerSideEncryptionByDefault'], **({'BucketKeyEnabled': rule['BucketKeyEnabled']} if 'BucketKeyEnabled' in rule else {})} for rule in p['BucketEncryption']['ServerSideEncryptionConfiguration']]}}
elif action == 'bucket-versioning':
    result = {'Bucket': n, 'VersioningConfiguration': p['VersioningConfiguration']}
elif action == 'bucket-ownership':
    result = {'Bucket': n, 'OwnershipControls': p['OwnershipControls']}
elif action == 'bucket-tag':
    result = {'Bucket': n, 'Tagging': {'TagSet': tags(p)}}
elif action == 'bucket-policy':
    result = {'Bucket': p['Bucket'], 'Policy': json.dumps(p['PolicyDocument'])}
elif action == 'config-put':
    group = p['RecordingGroup']
    result = {'ConfigurationRecorder': {'name': n, 'roleARN': p['RoleARN'], 'recordingGroup': {key[0].lower() + key[1:]: value for key, value in group.items()}, 'recordingMode': {'recordingFrequency': p['RecordingMode']['RecordingFrequency']}}, 'Tags': tags(p)}
elif action == 'channel-put':
    result = {'DeliveryChannel': {'name': n, 's3BucketName': p['S3BucketName'], 'configSnapshotDeliveryProperties': {'deliveryFrequency': p['ConfigSnapshotDeliveryProperties']['DeliveryFrequency']}}}
elif action in ('lambda-create', 'lambda-update'):
    result = {key: value for key, value in p.items() if key not in ('Code', 'ReservedConcurrentExecutions', 'Tags')}
    if 'Environment' in result:
        result['Environment']['Variables'] = {key: str(value) for key, value in result['Environment']['Variables'].items()}
    if action == 'lambda-create':
        result['Tags'] = tagmap(p)
    with zipfile.ZipFile(work / 'function.zip', 'w', zipfile.ZIP_DEFLATED) as package:
        package.writestr('index.py', p['Code']['ZipFile'])
elif action == 'lambda-tag':
    result = {'Resource': arn(logical), 'Tags': tagmap(p)}
elif action == 'lambda-concurrency':
    result = {'FunctionName': n, 'ReservedConcurrentExecutions': p['ReservedConcurrentExecutions']}
elif action == 'lambda-invoke-config':
    result = p
elif action == 'lambda-permission':
    result = dict(p, StatementId=prefix + '-' + logical)
elif action == 'topic-create':
    result = {'Name': n, 'Tags': tags(p)}
elif action == 'topic-tag':
    result = {'ResourceArn': arn(logical), 'Tags': tags(p)}
elif action == 'topic-policy':
    result = {'TopicArn': p['Topics'][0], 'AttributeName': 'Policy', 'AttributeValue': json.dumps(p['PolicyDocument'])}
elif action == 'rule-put':
    result = {'Name': n, 'ScheduleExpression': p['ScheduleExpression'], 'State': p['State'], 'Tags': tags(p)}
elif action == 'rule-tag':
    result = {'ResourceARN': arn(logical), 'Tags': tags(p)}
elif action == 'rule-targets':
    result = {'Rule': n, 'Targets': p['Targets']}
elif action == 'targets-check':
    if read(logical)['FailedEntryCount']:
        raise ValueError('EventBridge rejected targets: ' + json.dumps(read(logical)['FailedEntries']))
    sys.exit()
elif action == 'alarm-put':
    result = p
elif action == 'alarm-tag':
    result = {'ResourceARN': arn(logical), 'Tags': tags(p)}
elif action == 'sg-create':
    result = {'GroupName': n, 'Description': p['GroupDescription'], 'VpcId': p['VpcId'], 'TagSpecifications': [{'ResourceType': 'security-group', 'Tags': tags(p)}]}
elif action == 'sg-find':
    result = {'Filters': [{'Name': 'group-name', 'Values': [n]}, {'Name': 'vpc-id', 'Values': [p['VpcId']]}]}
elif action == 'sg-check':
    groups = read(logical)['SecurityGroups']
    if len(groups) != 1 or groups[0]['IpPermissions']:
        raise ValueError('Existing group must have no inbound rules')
    for rule in groups[0]['IpPermissionsEgress']:
        if rule.get('UserIdGroupPairs') or rule.get('PrefixListIds'):
            raise ValueError('Existing group has additional outbound rules')
        cidrs = [r['CidrIp'] for r in rule.get('IpRanges', [])] + [r['CidrIpv6'] for r in rule.get('Ipv6Ranges', [])]
        default = rule['IpProtocol'] == '-1' and all(c in ('0.0.0.0/0', '::/0') for c in cidrs)
        desired = rule['IpProtocol'] == 'tcp' and rule.get('FromPort') == rule.get('ToPort') and rule.get('FromPort') in (80, 443) and cidrs == ['0.0.0.0/0']
        if not default and not desired:
            raise ValueError('Existing group has additional outbound rules')
    sys.exit()
elif action.startswith('sg-revoke-'):
    permission = {'IpProtocol': '-1'}
    permission.update({'IpRanges': [{'CidrIp': '0.0.0.0/0'}]} if action.endswith('4') else {'Ipv6Ranges': [{'CidrIpv6': '::/0'}]})
    result = {'GroupId': reference(logical), 'IpPermissions': [permission]}
elif action.startswith('sg-authorize-'):
    port = int(action.rsplit('-', 1)[1])
    rule = next(rule for rule in p['SecurityGroupEgress'] if rule['FromPort'] == port)
    result = {'GroupId': reference(logical), 'IpPermissions': [{'IpProtocol': rule['IpProtocol'], 'FromPort': rule['FromPort'], 'ToPort': rule['ToPort'], 'IpRanges': [{'CidrIp': rule['CidrIp']}]}], 'TagSpecifications': [{'ResourceType': 'security-group-rule', 'Tags': tags(p)}]}
elif action == 'sg-tag':
    result = {'Resources': [reference(logical)], 'Tags': tags(p)}
else:
    raise ValueError('Unsupported action: ' + action)
dump(result)

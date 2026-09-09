import base64
import io
import json
import os
from pathlib import Path
import sys
import zipfile

import botocore.session
from botocore import xform_name
from botocore.validate import validate_parameters

root = Path(os.environ['MOCK_ROOT'])
state_path = root / 'state.json'
state = json.loads(state_path.read_text()) if state_path.exists() else {}
args = sys.argv[1:]
service, operation = args[:2]
assert service != 'cloudformation', 'Direct command used CloudFormation'
if operation == 'wait':
    assert service == 'lambda' and args[2] in ('function-active-v2', 'function-updated-v2')
    sys.exit()
sdk_service = {'configservice': 'config', 's3api': 's3'}.get(service, service)
model = botocore.session.get_session().get_service_model(sdk_service)
method = next(name for name in model.operation_names if xform_name(name, '-') == operation)
shape = model.operation_model(method).input_shape
payload = {}
if '--cli-input-json' in args:
    payload = json.loads(Path(args[args.index('--cli-input-json') + 1].removeprefix('file://')).read_text())
index = 2
while index < len(args):
    flag = args[index]
    if flag == '--cli-input-json':
        index += 2
        continue
    if flag == '--zip-file':
        blob = Path(args[index + 1].removeprefix('fileb://')).read_bytes()
        if operation == 'create-function':
            payload['Code'] = {'ZipFile': blob}
        else:
            payload['ZipFile'] = blob
        index += 2
        continue
    key = next(k for k in shape.members if '--' + xform_name(k, '-') == flag)
    value = args[index + 1]
    payload[key] = [value] if shape.members[key].type_name == 'list' else value
    index += 2
if shape:
    validate_parameters(payload, shape)
record = json.loads(json.dumps(payload, default=lambda b: {'zip': base64.b64encode(b).decode()}))
with (root / 'calls.jsonl').open('a') as log:
    log.write(json.dumps({'service': service, 'operation': operation, 'payload': record}) + '\n')

def error(code, message='', status=254):
    print('An error occurred (' + code + ') when calling ' + method + ': ' + message, file=sys.stderr)
    sys.exit(status)

if os.environ.get('MOCK_FAIL') == service + ':' + operation:
    error('AccessDeniedException', 'Denied', 42)
region = os.environ['REGION']
account = '123456789012'
base = 'arn:aws:'
result = {}
key = service + ':' + operation
if key == 'sts:get-caller-identity':
    result = {'Account': account, 'Arn': base + 'iam::' + account + ':user/test', 'UserId': 'test'}
elif key == 'logs:create-log-group':
    groups = state.setdefault('logs', {})
    name = payload['logGroupName']
    if name in groups:
        error('ResourceAlreadyExistsException')
    groups[name] = payload
elif key == 'iam:create-role':
    roles = state.setdefault('roles', {})
    name = payload['RoleName']
    if name in roles:
        error('EntityAlreadyExists')
    roles[name] = payload
elif key == 'iam:create-instance-profile':
    profiles = state.setdefault('profiles', {})
    name = payload['InstanceProfileName']
    if name in profiles:
        error('EntityAlreadyExists')
    profiles[name] = {'InstanceProfileName': name, 'Roles': []}
elif key == 'iam:get-instance-profile':
    result = {'InstanceProfile': state['profiles'][payload['InstanceProfileName']]}
elif key == 'iam:add-role-to-instance-profile':
    state['profiles'][payload['InstanceProfileName']]['Roles'] = [{'RoleName': payload['RoleName']}]
elif key == 'logs:put-delivery-destination':
    result = {'deliveryDestination': {'arn': base + 'logs:' + region + ':' + account + ':delivery-destination:' + payload['name']}}
elif key == 'sqs:create-queue':
    queues = state.setdefault('queues', {})
    name = payload['QueueName']
    if name in queues and queues[name] != payload:
        error('QueueNameExists')
    queues[name] = payload
    result = {'QueueUrl': 'https://sqs.' + region + '.amazonaws.com/' + account + '/' + name}
elif key == 'sqs:get-queue-url':
    result = {'QueueUrl': 'https://sqs.' + region + '.amazonaws.com/' + account + '/' + payload['QueueName']}
elif key == 'iam:create-policy':
    policies = state.setdefault('policies', {})
    name = payload['PolicyName']
    if name in policies:
        error('EntityAlreadyExists')
    policies[name] = payload
elif key == 'iam:get-policy':
    result = {'Policy': {'DefaultVersionId': 'v1'}}
elif key == 'iam:get-policy-version':
    name = payload['PolicyArn'].split('/')[-1]
    result = {'PolicyVersion': {'Document': json.loads(state['policies'][name]['PolicyDocument'])}}
elif key == 'wafv2:create-web-acl':
    wafs = state.setdefault('wafs', {})
    name = payload['Name']
    if name in wafs:
        error('WAFDuplicateItemException')
    wafs[name] = {'Name': name, 'Id': '12345678-abcd-abcd-abcd-123456789012', 'ARN': base + 'wafv2:' + region + ':' + account + ':regional/webacl/' + name + '/12345678-abcd-abcd-abcd-123456789012'}
    result = {'Summary': wafs[name], 'NextLockToken': 'token'}
elif key == 'wafv2:list-web-acls':
    result = {'WebACLs': list(state.get('wafs', {}).values())}
elif key == 'wafv2:get-web-acl':
    result = {'WebACL': state['wafs'][payload['Name']], 'LockToken': '12345678-abcd-abcd-abcd-123456789012'}
elif key == 'wafv2:update-web-acl':
    result = {'NextLockToken': 'token'}
elif key == 's3api:create-bucket':
    buckets = state.setdefault('buckets', {})
    if payload['Bucket'] in buckets:
        error('BucketAlreadyOwnedByYou')
    buckets[payload['Bucket']] = payload
elif key == 'configservice:describe-configuration-recorders':
    if os.environ.get('MOCK_EXTERNAL_CONFIG'):
        result = {'ConfigurationRecorders': [{'name': 'external', 'roleARN': base + 'iam::' + account + ':role/external', 'arn': base + 'config:' + region + ':' + account + ':configuration-recorder/external/id'}]}
    else:
        result = {'ConfigurationRecorders': list(state.get('recorders', {}).values())}
elif key == 'configservice:put-configuration-recorder':
    recorder = payload['ConfigurationRecorder']
    recorder['arn'] = base + 'config:' + region + ':' + account + ':configuration-recorder/' + recorder['name'] + '/id'
    state.setdefault('recorders', {})[recorder['name']] = recorder
elif key == 'lambda:create-function':
    functions = state.setdefault('functions', {})
    name = payload['FunctionName']
    if name in functions:
        error('ResourceConflictException')
    functions[name] = record
    result = {'FunctionName': name, 'State': 'Active'}
elif key == 'lambda:add-permission':
    permissions = state.setdefault('permissions', {})
    name = payload['StatementId']
    if name in permissions:
        error('ResourceConflictException')
    permissions[name] = payload
elif key == 'lambda:remove-permission':
    del state['permissions'][payload['StatementId']]
elif key == 'events:put-targets':
    result = {'FailedEntryCount': 0, 'FailedEntries': []}
    if os.environ.get('MOCK_TARGET_FAILURE'):
        result = {'FailedEntryCount': 1, 'FailedEntries': [{'TargetId': 'Collector', 'ErrorCode': 'InternalException'}]}
elif key == 'sns:create-topic':
    result = {'TopicArn': base + 'sns:' + region + ':' + account + ':' + payload['Name']}
elif key == 'ec2:create-security-group':
    groups = state.setdefault('groups', {})
    name = payload['GroupName']
    if name in groups:
        error('InvalidGroup.Duplicate')
    identifier = 'sg-' + str(len(groups) + 1).zfill(17)
    groups[name] = {'GroupId': identifier, 'GroupName': name, 'VpcId': payload['VpcId'], 'IpPermissions': [], 'IpPermissionsEgress': [{'IpProtocol': '-1', 'IpRanges': [{'CidrIp': '0.0.0.0/0'}], 'Ipv6Ranges': []}]}
    result = {'GroupId': identifier}
elif key == 'ec2:describe-security-groups':
    filters = {item['Name']: item['Values'][0] for item in payload['Filters']}
    result = {'SecurityGroups': [g for g in state['groups'].values() if g['GroupName'] == filters['group-name'] and g['VpcId'] == filters['vpc-id']]}
elif key in ('ec2:revoke-security-group-egress', 'ec2:authorize-security-group-egress'):
    group = next(g for g in state['groups'].values() if g['GroupId'] == payload['GroupId'])
    rule = payload['IpPermissions'][0]
    if operation == 'revoke-security-group-egress':
        matches = [r for r in group['IpPermissionsEgress'] if all(r.get(k) == v for k, v in rule.items())]
        if not matches:
            error('InvalidPermission.NotFound')
        group['IpPermissionsEgress'].remove(matches[0])
    else:
        if rule in group['IpPermissionsEgress']:
            error('InvalidPermission.Duplicate')
        group['IpPermissionsEgress'].append(rule)
state_path.write_text(json.dumps(state))
print(json.dumps(result))

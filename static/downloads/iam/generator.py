#!/usr/bin/env python3
"""AWS CLI-backed role generator with one tagged application policy per role. Python 3, no packages."""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote

CATALOG = json.loads(Path(__file__).with_name('catalog.json').read_text())


class AwsError(RuntimeError):
    def __init__(self, message):
        super().__init__(message)
        match = re.search(r'\(([^)]+)\) when calling', message)
        self.code = match.group(1) if match else ''


def configured_region():
    region=os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION')
    if not region:
        result=subprocess.run(['aws','configure','get','region'],text=True,capture_output=True)
        if result.returncode:raise ValueError('No AWS region configured. Use aws configure or AWS_REGION.')
        region=result.stdout.strip()
    if not re.fullmatch(r'[a-z]{2}(?:-[a-z]+)+-\d',region):raise ValueError('Invalid AWS region configuration.')
    return region


def aws(service, operation, **payload):
    command = ['aws', service, operation, '--output', 'json', '--no-cli-pager']
    if payload:
        command += ['--cli-input-json', json.dumps(payload)]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise AwsError(result.stderr.strip() or f'{service} {operation} failed')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def optional(service, operation, **payload):
    try:
        return aws(service, operation, **payload)
    except AwsError as error:
        if error.code == 'NoSuchEntity':
            return None
        raise


def ask(label, env):
    if os.environ.get(env):
        return os.environ[env]
    if not sys.stdin.isatty():
        raise ValueError(f'Set {env}; interactive selection needs a terminal.')
    print(f'{label} ({env}): ', end='', file=sys.stderr, flush=True)
    value = input().strip()
    if not value:
        raise ValueError(f'{env} must not be empty.')
    return value


def select(label, choices, env):
    if os.environ.get(env):
        return os.environ[env]
    if not sys.stdin.isatty():
        raise ValueError(f'Set {env}; interactive selection needs a terminal.')
    print(f'\n{label}\n  0. Enter a value manually', file=sys.stderr)
    for index, (name, value) in enumerate(choices, 1):
        print(f'  {index}. {name}  {value}', file=sys.stderr)
    answer = ask('Number', '_IAM_SELECTION')
    if answer == '0':
        return ask(label, env)
    if not answer.isdigit() or not 1 <= int(answer) <= len(choices):
        raise ValueError('Invalid selection; nothing was changed.')
    return choices[int(answer) - 1][1]


def render(value, context):
    if isinstance(value, dict):
        return {render(k, context): render(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, context) for v in value]
    if not isinstance(value, str):
        return value
    def replace(match):
        key = match.group(1)
        if key not in context:
            raise ValueError(f'Missing template input: {key}')
        return context[key]
    return re.sub(r'\$\{([A-Z_]+)\}', replace, value)


def context():
    name = ask('Role name', 'ROLE_NAME')
    if not re.fullmatch(r'[\w+=,.@-]{1,64}', name, re.ASCII):
        raise ValueError('ROLE_NAME must be an IAM role name, 1–64 characters.')
    tags = json.loads(os.environ.get('TAGS_JSON', '{}'))
    if not isinstance(tags, dict):
        raise ValueError('TAGS_JSON must be a JSON object of string keys and values.')
    tags[os.environ.get('TAG_KEY', 'Project')] = os.environ.get('TAG_VALUE', 'quickstart')
    if len(tags) > 50 or any(not isinstance(k, str) or not isinstance(v, str) or not 1 <= len(k) <= 128 or len(v) > 256 or k.lower().startswith('aws:') or not re.fullmatch(r'[\w\s_.:/=+@-]+', k) or (v and not re.fullmatch(r'[\w\s_.:/=+@-]+', v)) for k, v in tags.items()):
        raise ValueError('Invalid IAM tags: use up to 50 string tags; aws: is reserved.')
    identity = aws('sts', 'get-caller-identity')
    return dict(ROLE_NAME=name, ACCOUNT_ID=identity['Account'], PARTITION=identity['Arn'].split(':')[1], REGION=configured_region(), TAGS=[dict(Key=k, Value=v) for k, v in tags.items()])


def inputs(spec, ctx):
    for item in spec:
        key, kind = item['env'], item.get('kind')
        value = os.environ.get(key)
        if not value:
            if not sys.stdin.isatty():
                raise ValueError(f'Set {key}; interactive selection needs a terminal.')
            if kind in ('eks', 'eks-name'):
                names = aws('eks', 'list-clusters').get('clusters', [])
                choices = [(name, name if kind == 'eks-name' else f'arn:{ctx["PARTITION"]}:eks:{ctx["REGION"]}:{ctx["ACCOUNT_ID"]}:cluster/{name}') for name in names]
                value = select(item['label'], choices, key)
            else:
                value = ask(item['label'], key)
        if any(c in value for c in '*?${}\n\r'):
            raise ValueError(f'{key} must be an exact value, without wildcards.')
        if kind == 'eks':
            prefix = f'arn:{ctx["PARTITION"]}:eks:{ctx["REGION"]}:{ctx["ACCOUNT_ID"]}:cluster/'
            if not value.startswith(prefix) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,99}', value[len(prefix):]):
                raise ValueError(f'{key} must be a cluster ARN in this account and REGION.')
        elif not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', value):
            raise ValueError(f'{key} must be an exact cluster, namespace or service-account name.')
        ctx[key] = value
    return ctx


def decode_document(value):
    return json.loads(unquote(value)) if isinstance(value, str) else value


def attach(arn, ctx):
    for attempt in range(6):
        try:
            aws('iam', 'attach-role-policy', RoleName=ctx['ROLE_NAME'], PolicyArn=arn)
            return
        except AwsError as error:
            if error.code != 'NoSuchEntity' or attempt == 5:
                raise
            time.sleep(2)


def bound_policy(ctx, existing_role):
    name = ctx['ROLE_NAME'] + '-permissions'
    arn = f'arn:{ctx["PARTITION"]}:iam::{ctx["ACCOUNT_ID"]}:policy/generator/{name}'
    description = f'Application permissions for IAM role {ctx["ROLE_NAME"]} (Generator).'
    existing = optional('iam', 'get-policy', PolicyArn=arn)
    if existing:
        if existing['Policy'].get('Description') != description:
            raise ValueError('The policy name is already in use by another policy; choose a new ROLE_NAME.')
        entities = aws('iam', 'list-entities-for-policy', PolicyArn=arn)
        if entities.get('PolicyUsers') or entities.get('PolicyGroups') or any(role['RoleName'] != ctx['ROLE_NAME'] for role in entities.get('PolicyRoles', [])):
            raise ValueError('The bound policy is shared with another identity; choose a new ROLE_NAME.')
    if existing_role:
        attached = aws('iam', 'list-attached-role-policies', RoleName=ctx['ROLE_NAME']).get('AttachedPolicies', [])
        other = [p['PolicyArn'] for p in attached if p['PolicyArn'].split(':')[4] != 'aws' and p['PolicyArn'] != arn]
        inline = aws('iam', 'list-role-policies', RoleName=ctx['ROLE_NAME']).get('PolicyNames', [])
        if other or inline:
            raise ValueError('Role already has other customer/inline policies. Choose a new ROLE_NAME or consolidate them before rerunning.')
    return name, arn, description, existing


def ensure_bound_policy(binding, ctx):
    name, arn, description, existing = binding
    if existing:
        # The console-edited document and all its versions belong to the user.
        aws('iam', 'tag-policy', PolicyArn=arn, Tags=ctx['TAGS'])
    else:
        aws('iam', 'create-policy', PolicyName=name, Path='/generator/', Description=description, PolicyDocument=json.dumps(CATALOG['emptyPolicy']), Tags=ctx['TAGS'])
    attach(arn, ctx)
    return arn


def ensure_profile(ctx):
    name = ctx['ROLE_NAME']
    profile = optional('iam', 'get-instance-profile', InstanceProfileName=name)
    if profile:
        existing = profile['InstanceProfile'].get('Roles', [])
        if existing and any(role['RoleName'] != name for role in existing):
            raise ValueError('Instance profile already contains another role.')
        aws('iam', 'tag-instance-profile', InstanceProfileName=name, Tags=ctx['TAGS'])
    else:
        aws('iam', 'create-instance-profile', InstanceProfileName=name, Tags=ctx['TAGS'])
        existing = []
    if not existing:
        aws('iam', 'add-role-to-instance-profile', InstanceProfileName=name, RoleName=name)


def create_role(recipe, ctx):
    resolved = inputs(recipe['inputs'], dict(ctx))
    if resolved.get('CLUSTER_NAME'):
        resolved['CLUSTER_ARN']=f'arn:{ctx["PARTITION"]}:eks:{ctx["REGION"]}:{ctx["ACCOUNT_ID"]}:cluster/{resolved["CLUSTER_NAME"]}'
    if recipe['source']:
        source = render(recipe['source'], resolved)
        resolved['SOURCE_ARN'] = source
        if not resolved['SOURCE_ARN'].startswith(':'.join(source.split(':')[:5])+':') or '?' in resolved['SOURCE_ARN']:
            raise ValueError('SOURCE_ARN must belong to this service, account and region.')
    trust = render(recipe['trust'], resolved)
    managed = render(recipe['managedPolicies'], ctx)
    if '--json' in sys.argv:
        print(json.dumps(dict(TrustPolicy=trust, ManagedPolicyArns=managed, CustomerManagedPolicy=dict(PolicyName=ctx['ROLE_NAME']+'-permissions', Path='/generator/', PolicyDocument=CATALOG['emptyPolicy'])), indent=2))
        return
    existing = optional('iam', 'get-role', RoleName=ctx['ROLE_NAME'])
    if existing:
        if decode_document(existing['Role']['AssumeRolePolicyDocument']) != trust:
            raise ValueError('Existing role has a different trust policy. Choose another ROLE_NAME; it was not changed.')
    binding = bound_policy(ctx, existing)
    if existing:
        role_arn = existing['Role']['Arn']
        aws('iam', 'tag-role', RoleName=ctx['ROLE_NAME'], Tags=ctx['TAGS'])
    else:
        role_arn = aws('iam', 'create-role', RoleName=ctx['ROLE_NAME'], AssumeRolePolicyDocument=json.dumps(trust), Tags=ctx['TAGS'])['Role']['Arn']
    for arn in managed: attach(arn, ctx)
    policy_arn = ensure_bound_policy(binding, ctx)
    if recipe['instanceProfile']: ensure_profile(ctx)
    print(json.dumps(dict(RoleArn=role_arn, PolicyArn=policy_arn), indent=2))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'role'
    if mode == 'menu': mode = 'role'
    if mode not in ('role', 'list', 'pod-association'):
        raise ValueError('Use role, list or pod-association. Permission recipes are copyable JSON on the Generator page.')
    ctx = context()
    if mode == 'role':
        recipe_id = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '--json' else select('Role preset', [(x['title'], x['id']) for x in CATALOG['roles']], 'IAM_RECIPE')
        recipe = next((r for r in CATALOG['roles'] if r['id'] == recipe_id), None)
        if not recipe: raise ValueError('Unknown role preset: '+recipe_id)
        create_role(recipe, ctx)
    elif mode == 'list':
        print(json.dumps(aws('iam', 'list-attached-role-policies', RoleName=ctx['ROLE_NAME']), indent=2))
    elif mode == 'pod-association':
        inputs([dict(env='CLUSTER_NAME',kind='eks-name',label='EKS cluster'),dict(env='NAMESPACE',label='Kubernetes namespace'),dict(env='SERVICE_ACCOUNT',label='Kubernetes service account')], ctx)
        role = aws('iam', 'get-role', RoleName=ctx['ROLE_NAME'])['Role']
        expected = render(next(r for r in CATALOG['roles'] if r['id'] == 'eks-pod')['trust'], {**ctx, 'CLUSTER_ARN': f'arn:{ctx["PARTITION"]}:eks:{ctx["REGION"]}:{ctx["ACCOUNT_ID"]}:cluster/{ctx["CLUSTER_NAME"]}'})
        if decode_document(role['AssumeRolePolicyDocument']) != expected:
            raise ValueError('Role trust does not match this cluster, namespace and service account.')
        existing = aws('eks', 'list-pod-identity-associations', clusterName=ctx['CLUSTER_NAME'], namespace=ctx['NAMESPACE'], serviceAccount=ctx['SERVICE_ACCOUNT']).get('associations', [])
        if existing:
            current = aws('eks', 'describe-pod-identity-association', clusterName=ctx['CLUSTER_NAME'], associationId=existing[0]['associationId'])['association']
            if current['roleArn'] != role['Arn']: raise ValueError('Service account already uses another role.')
            aws('eks', 'tag-resource', resourceArn=current['associationArn'], tags={t['Key']:t['Value'] for t in ctx['TAGS']})
            print(current['associationArn'])
        else:
            print(aws('eks', 'create-pod-identity-association', clusterName=ctx['CLUSTER_NAME'], namespace=ctx['NAMESPACE'], serviceAccount=ctx['SERVICE_ACCOUNT'], roleArn=role['Arn'], tags={t['Key']:t['Value'] for t in ctx['TAGS']})['association']['associationArn'])


if __name__ == '__main__':
    try:
        main()
    except (AwsError, ValueError, EOFError, KeyboardInterrupt, FileNotFoundError) as error:
        print(str(error) or 'Cancelled.', file=sys.stderr)
        sys.exit(1)

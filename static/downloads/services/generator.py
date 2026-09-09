#!/usr/bin/env python3
"""Create empty AWS resources through AWS CLI v2. No third-party Python packages."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import tempfile
import zipfile

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
    command = ['aws', service, operation, '--output', 'json', '--no-cli-pager', '--cli-binary-format', 'base64']
    with tempfile.TemporaryDirectory(prefix='aws-service-') as directory:
        if payload:
            request=Path(directory)/'request.json'
            request.write_text(json.dumps(payload))
            command += ['--cli-input-json', 'file://'+str(request)]
        result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode:
        raise AwsError(result.stderr.strip() or f'{service} {operation} failed')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def settings(kind):
    recipe = next((x for x in CATALOG['services'] if x['id'] == kind), None)
    if not recipe: raise ValueError('Choose: '+', '.join(x['id'] for x in CATALOG['services']))
    values = dict(recipe['defaults'])
    for item in CATALOG['common'] + recipe['env']:
        key = item['name']
        value = os.environ.get(key, item.get('default', ''))
        if item['required'] and not value:
            raise ValueError(f'Set {key}. Example: {item["example"]}')
        if item['type'] == 'integer':
            try: value = int(value)
            except (ValueError, TypeError): raise ValueError(f'{key} must be an integer.')
            if not item.get('min', value) <= value <= item.get('max', value):
                raise ValueError(f'{key} must be between {item["min"]} and {item["max"]}.')
        elif item['type'] == 'map':
            value = json.loads(value)
            if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k,v in value.items()):
                raise ValueError(f'{key} must be a JSON object of string keys and values.')
        if 'choices' in item and value not in item['choices']:
            raise ValueError(f'{key} must be one of {item["choices"]}.')
        if item.get('pattern') and not re.fullmatch(item['pattern'], value):
            raise ValueError(f'Invalid {key}. Example: {item["example"]}')
        values[key] = value
    tags = dict(values['TAGS_JSON'])
    tags[values['TAG_KEY']] = values['TAG_VALUE']
    if len(tags)>50 or any(not 1<=len(k)<=128 or len(v)>256 or k.lower().startswith('aws:') or not re.fullmatch(r'[\w\s_.:/=+@-]+',k) or (v and not re.fullmatch(r'[\w\s_.:/=+@-]+',v)) for k,v in tags.items()):
        raise ValueError('Use up to 50 valid string tags; aws: is reserved.')
    if kind=='sqs' and ('MonitoringRole' in tags or len(tags)>49):
        raise ValueError('SQS reserves MonitoringRole for DLQ discovery; supply at most 49 other tags.')
    values['REGION'] = configured_region()
    if kind=='sqs':values['QUEUE_TYPE']='fifo' if values['NAME'].endswith('.fifo') else 'standard'
    values['tags'] = tags
    if not re.fullmatch(r'[a-z]{2}(?:-[a-z]+)+-\d',values['REGION']): raise ValueError('Invalid REGION.')
    if values.get('KMS_KEY_ARN') and not re.fullmatch(r'arn:[^:]+:kms:'+re.escape(values['REGION'])+r':\d{12}:key/[^*?]+',values['KMS_KEY_ARN']):
        raise ValueError('KMS_KEY_ARN must be an exact key ARN in REGION.')
    return values


def tag_list(v, lower=False):
    return [{('key' if lower else 'Key'):k,('value' if lower else 'Value'):value} for k,value in v['tags'].items()]


def arn(v, service, resource):
    return f'arn:{v["partition"]}:{service}:{v["REGION"]}:{v["account"]}:{resource}'


def policy(*statements):
    return json.dumps(dict(Version='2012-10-17',Statement=list(statements)))


def tls_deny(action, resource):
    return dict(Sid='RequireTLS',Effect='Deny',Principal='*',Action=action,Resource=resource,Condition={'Bool':{'aws:SecureTransport':'false','aws:PrincipalIsAWSService':'false'}})


def absent(service, operation, missing, **payload):
    try: aws(service, operation, **payload)
    except AwsError as error:
        if error.code in missing: return
        raise
    raise ValueError('Resource already exists; choose a new NAME. Existing configuration was not changed.')


def wait_for(service, operation, check, **payload):
    for _ in range(60):
        value = aws(service, operation, **payload)
        if check(value): return value
        time.sleep(2)
    raise ValueError(f'{service} resource is still provisioning; inspect its status before continuing.')


def log_group(v, default):
    name = v.get('LOG_GROUP') or default
    if not re.fullmatch(r'[.\-_/#A-Za-z0-9]{1,512}',name): raise ValueError('Invalid LOG_GROUP.')
    request = dict(logGroupName=name,tags=v['tags'],deletionProtectionEnabled=True)
    if v.get('KMS_KEY_ARN'): request['kmsKeyId']=v['KMS_KEY_ARN']
    try: aws('logs','create-log-group',**request)
    except AwsError as error:
        if error.code!='ResourceAlreadyExistsException': raise
        groups=aws('logs','describe-log-groups',logGroupNamePrefix=name).get('logGroups',[])
        current=next((g for g in groups if g['logGroupName']==name),None)
        if not current or not current.get('deletionProtectionEnabled') or current.get('retentionInDays')!=v['LOG_RETENTION_DAYS'] or (v.get('KMS_KEY_ARN') and current.get('kmsKeyId')!=v['KMS_KEY_ARN']):
            raise ValueError('Existing LOG_GROUP must already have matching retention, encryption and deletion protection.')
        aws('logs','tag-resource',resourceArn=arn(v,'logs','log-group:'+name),tags=v['tags'])
        return name
    aws('logs','put-retention-policy',logGroupName=name,retentionInDays=v['LOG_RETENTION_DAYS'])
    return name


def execution_role(v, principal):
    role=aws('iam','get-role',RoleName=v['ROLE_NAME'])['Role']
    trust=role['AssumeRolePolicyDocument']
    if isinstance(trust,str):
        from urllib.parse import unquote
        trust=json.loads(unquote(trust))
    statements=trust.get('Statement',[])
    if isinstance(statements,dict):statements=[statements]
    def allows(statement):
        principal_value=statement.get('Principal',{})
        services=principal_value.get('Service',[]) if isinstance(principal_value,dict) else []
        return statement.get('Effect')=='Allow' and principal in ([services] if isinstance(services,str) else services)
    if not any(allows(statement) for statement in statements):
        raise ValueError(f'ROLE_NAME must trust {principal}.')
    return role['Arn']


def create_lambda(v):
    name=v['NAME']
    if bool(v['SUBNET_IDS'])!=bool(v['SECURITY_GROUP_IDS']): raise ValueError('Set both SUBNET_IDS and SECURITY_GROUP_IDS, or neither.')
    subnets=[x.strip() for x in v['SUBNET_IDS'].split(',') if x.strip()]
    groups=[x.strip() for x in v['SECURITY_GROUP_IDS'].split(',') if x.strip()]
    if subnets and (len(set(subnets))<2 or any(not re.fullmatch(r'subnet-[a-f0-9]+',x) for x in subnets) or any(not re.fullmatch(r'sg-[a-f0-9]+',x) for x in groups)):
        raise ValueError('Use at least two distinct VPC subnets and valid security group IDs.')
    if v['DLQ_ARN'] and not re.fullmatch(r'arn:[^:]+:(?:sqs|sns):'+re.escape(v['REGION'])+r':\d{12}:[A-Za-z0-9_-]+',v['DLQ_ARN']): raise ValueError('DLQ_ARN must be a standard SQS queue or SNS topic ARN in REGION.')
    if any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]+',key) for key in v['LAMBDA_ENV_JSON']): raise ValueError('Invalid Lambda environment variable name.')
    if v['ZIP_FILE']:
        code=Path(v['ZIP_FILE']).read_bytes()
        if not zipfile.is_zipfile(io.BytesIO(code)): raise ValueError('ZIP_FILE is not a ZIP archive.')
    else:
        if v['HANDLER']!='index.handler': raise ValueError('Set ZIP_FILE for a custom HANDLER.')
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as package:
            if v['RUNTIME'].startswith('nodejs'):package.writestr('index.mjs','export const handler = async () => { throw new Error("Deploy application code before invoking this function."); };\n')
            else:package.writestr('index.py','def handler(event, context):\n    raise RuntimeError("Deploy application code before invoking this function.")\n')
        code=output.getvalue()
    if len(code)>50*1024*1024: raise ValueError('ZIP_FILE exceeds the direct Lambda upload limit.')
    absent('lambda','get-function',{'ResourceNotFoundException'},FunctionName=name)
    role=execution_role(v,'lambda.amazonaws.com')
    if subnets:
        subnet_data=aws('ec2','describe-subnets',SubnetIds=subnets)['Subnets']
        security_data=aws('ec2','describe-security-groups',GroupIds=groups)['SecurityGroups']
        if len({x['AvailabilityZone'] for x in subnet_data})<2 or len({x['VpcId'] for x in subnet_data+security_data})!=1:
            raise ValueError('Choose subnets in at least two Availability Zones and security groups in the same VPC.')
    group=log_group(v,'/aws/lambda/'+name)
    request=dict(FunctionName=name,Runtime=v['RUNTIME'],Role=role,Handler=v['HANDLER'],Code={'ZipFile':base64.b64encode(code).decode()},Timeout=v['TIMEOUT_SECONDS'],MemorySize=v['MEMORY_MB'],Architectures=[v['ARCHITECTURE']],EphemeralStorage={'Size':v['EPHEMERAL_MB']},Tags=v['tags'],LoggingConfig={'LogFormat':'JSON','ApplicationLogLevel':'INFO','SystemLogLevel':'INFO','LogGroup':group},Environment={'Variables':v['LAMBDA_ENV_JSON']})
    if subnets:request['VpcConfig']=dict(SubnetIds=subnets,SecurityGroupIds=groups,Ipv6AllowedForDualStack=False)
    if v['DLQ_ARN']:request['DeadLetterConfig']={'TargetArn':v['DLQ_ARN']}
    if v['KMS_KEY_ARN']:request['KMSKeyArn']=v['KMS_KEY_ARN']
    for attempt in range(8):
        try: result=aws('lambda','create-function',**request);break
        except AwsError as error:
            if 'cannot be assumed by Lambda' not in str(error) or attempt==7:raise
            time.sleep(2)
    def active(data):
        if data.get('State')=='Failed':raise ValueError(data.get('StateReason','Lambda creation failed.'))
        return data.get('State')=='Active'
    wait_for('lambda','get-function-configuration',active,FunctionName=name)
    aws('lambda','put-function-concurrency',FunctionName=name,ReservedConcurrentExecutions=v['RESERVED_CONCURRENCY'])
    aws('lambda','put-function-recursion-config',FunctionName=name,RecursiveLoop='Terminate')
    aws('lambda','put-function-event-invoke-config',FunctionName=name,MaximumRetryAttempts=2,MaximumEventAgeInSeconds=3600)
    return {'FunctionArn':result['FunctionArn'],'LogGroup':group}


def create_s3(v):
    name=v['NAME']
    if '..' in name or re.fullmatch(r'\d+\.\d+\.\d+\.\d+',name) or name.startswith(('xn--','sthree-','amzn-s3-demo-')) or name.endswith(('-s3alias','--ol-s3','.mrap','--x-s3','--table-s3')):raise ValueError('Invalid S3 bucket name.')
    log=v['ACCESS_LOG_BUCKET'] or name[:40]+'-logs-'+hashlib.sha256((name+v['account']).encode()).hexdigest()[:10]
    if log==name or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',log):raise ValueError('ACCESS_LOG_BUCKET must be a different valid new bucket name.')
    for bucket in [name,log]:absent('s3api','head-bucket',{'404','NoSuchBucket','NotFound'},Bucket=bucket)
    def bucket_arn(bucket):return f'arn:{v["partition"]}:s3:::{bucket}'
    def create(bucket,log_destination=False):
        request=dict(Bucket=bucket,ObjectOwnership='BucketOwnerEnforced')
        if v['REGION']!='us-east-1':request['CreateBucketConfiguration']={'LocationConstraint':v['REGION']}
        aws('s3api','create-bucket',**request)
        aws('s3api','put-bucket-tagging',Bucket=bucket,Tagging={'TagSet':tag_list(v)})
        aws('s3api','put-public-access-block',Bucket=bucket,PublicAccessBlockConfiguration={key:True for key in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']})
        encryption={'SSEAlgorithm':'AES256'}
        if v['KMS_KEY_ARN'] and not log_destination:encryption={'SSEAlgorithm':'aws:kms','KMSMasterKeyID':v['KMS_KEY_ARN']}
        rule={'ApplyServerSideEncryptionByDefault':encryption}
        if encryption['SSEAlgorithm']=='aws:kms':rule['BucketKeyEnabled']=True
        aws('s3api','put-bucket-encryption',Bucket=bucket,ServerSideEncryptionConfiguration={'Rules':[rule]})
        aws('s3api','put-bucket-versioning',Bucket=bucket,VersioningConfiguration={'Status':'Enabled'})
        statements=[tls_deny('s3:*',[bucket_arn(bucket),bucket_arn(bucket)+'/*'])]
        statements.append(dict(Sid='BlockSSEC',Effect='Deny',Principal='*',Action='s3:PutObject',Resource=bucket_arn(bucket)+'/*',Condition={'Null':{'s3:x-amz-server-side-encryption-customer-algorithm':'false'}}))
        if log_destination:statements.append(dict(Sid='AccessLogDelivery',Effect='Allow',Principal={'Service':'logging.s3.amazonaws.com'},Action='s3:PutObject',Resource=bucket_arn(bucket)+'/access/'+name+'/*',Condition={'StringEquals':{'aws:SourceAccount':v['account']},'ArnLike':{'aws:SourceArn':bucket_arn(name)}}))
        aws('s3api','put-bucket-policy',Bucket=bucket,Policy=policy(*statements))
        rules=[dict(ID='AbortIncompleteUploads',Status='Enabled',Filter={'Prefix':''},AbortIncompleteMultipartUpload={'DaysAfterInitiation':v['MULTIPART_ABORT_DAYS']})]
        if log_destination:
            rules.append(dict(ID='ExpireAccessLogs',Status='Enabled',Filter={'Prefix':''},Expiration={'Days':v['ACCESS_LOG_RETENTION_DAYS']},NoncurrentVersionExpiration={'NoncurrentDays':v['ACCESS_LOG_RETENTION_DAYS']}))
        else:rules.append(dict(ID='RetainRecentVersions',Status='Enabled',Filter={'Prefix':''},NoncurrentVersionExpiration={'NoncurrentDays':v['NONCURRENT_RETENTION_DAYS'],'NewerNoncurrentVersions':5}))
        aws('s3api','put-bucket-lifecycle-configuration',Bucket=bucket,LifecycleConfiguration={'Rules':rules})
    create(log,True);create(name)
    aws('s3api','put-bucket-logging',Bucket=name,BucketLoggingStatus={'LoggingEnabled':{'TargetBucket':log,'TargetPrefix':'access/'+name+'/'}})
    return {'Bucket':name,'AccessLogBucket':log}


def create_sqs(v):
    fifo=v['QUEUE_TYPE']=='fifo'
    name=v['NAME'].removesuffix('.fifo')
    if not fifo and v['NAME'].endswith('.fifo'):raise ValueError('Set QUEUE_TYPE=fifo for .fifo names.')
    if not fifo and v['DLQ_NAME'].endswith('.fifo'):raise ValueError('Use a standard DLQ_NAME for a standard queue.')
    dlq=(v['DLQ_NAME'] or name+'-dlq').removesuffix('.fifo')
    if fifo:name+='.fifo';dlq+='.fifo'
    if name==dlq or not re.fullmatch(r'[A-Za-z0-9_-]{1,75}(?:\.fifo)?',dlq):raise ValueError('Use distinct valid NAME and DLQ_NAME values.')
    if v['DLQ_RETENTION_DAYS']<=v['QUEUE_RETENTION_DAYS']:raise ValueError('DLQ_RETENTION_DAYS must exceed QUEUE_RETENTION_DAYS.')
    for queue in [name,dlq]:absent('sqs','get-queue-url',{'AWS.SimpleQueueService.NonExistentQueue','QueueDoesNotExist'},QueueName=queue)
    source_arn=arn(v,'sqs',name);dlq_arn=arn(v,'sqs',dlq)
    def create(queue,dead=False):
        resource=dlq_arn if dead else source_arn
        attrs={'SqsManagedSseEnabled':'true','MessageRetentionPeriod':str((v['DLQ_RETENTION_DAYS'] if dead else v['QUEUE_RETENTION_DAYS'])*86400),'VisibilityTimeout':str(v['VISIBILITY_SECONDS']),'ReceiveMessageWaitTimeSeconds':str(v['WAIT_SECONDS']),'Policy':policy(tls_deny('sqs:*',resource))}
        if fifo:attrs.update(FifoQueue='true',ContentBasedDeduplication='false')
        if dead:attrs['RedriveAllowPolicy']=json.dumps({'redrivePermission':'byQueue','sourceQueueArns':[source_arn]})
        else:attrs['RedrivePolicy']=json.dumps({'deadLetterTargetArn':dlq_arn,'maxReceiveCount':v['MAX_RECEIVE_COUNT']})
        tags={**v['tags'],**({'MonitoringRole':'dlq'} if dead else {})}
        return aws('sqs','create-queue',QueueName=queue,Attributes=attrs,tags=tags)['QueueUrl']
    dead_url=create(dlq,True)
    time.sleep(1)
    url=create(name)
    return {'QueueUrl':url,'QueueArn':source_arn,'DLQUrl':dead_url,'DLQArn':dlq_arn}


def create_sns(v):
    resource=arn(v,'sns',v['NAME'])
    absent('sns','get-topic-attributes',{'NotFound'},TopicArn=resource)
    return aws('sns','create-topic',Name=v['NAME'],Attributes={'KmsMasterKeyId':v['KMS_KEY_ID'],'Policy':policy(tls_deny('sns:*',resource))},Tags=tag_list(v))


def create_eventbridge(v):
    request=dict(Name=v['NAME'],Tags=tag_list(v))
    if v['KMS_KEY_ARN']:request['KmsKeyIdentifier']=v['KMS_KEY_ARN']
    return aws('events','create-event-bus',**request)


def create_ecr(v):
    encryption={'encryptionType':'KMS','kmsKey':v['KMS_KEY_ARN']} if v['KMS_KEY_ARN'] else {'encryptionType':'AES256'}
    result=aws('ecr','create-repository',repositoryName=v['NAME'],imageTagMutability='IMMUTABLE',imageScanningConfiguration={'scanOnPush':True},encryptionConfiguration=encryption,tags=tag_list(v))
    lifecycle={'rules':[{'rulePriority':1,'description':'Expire old untagged images','selection':{'tagStatus':'untagged','countType':'sinceImagePushed','countUnit':'days','countNumber':v['UNTAGGED_RETENTION_DAYS']},'action':{'type':'expire'}}]}
    aws('ecr','put-lifecycle-policy',repositoryName=v['NAME'],lifecyclePolicyText=json.dumps(lifecycle))
    return result


def create_ecs(v):
    found=aws('ecs','describe-clusters',clusters=[v['NAME']]).get('clusters',[])
    if any(c.get('status')!='INACTIVE' for c in found):raise ValueError('ECS cluster already exists; choose a new NAME.')
    group=log_group(v,'/aws/ecs/'+v['NAME']+'/exec')
    config={'logging':'OVERRIDE','logConfiguration':{'cloudWatchLogGroupName':group,'cloudWatchEncryptionEnabled':bool(v['KMS_KEY_ARN'])}}
    if v['KMS_KEY_ARN']:config['kmsKeyId']=v['KMS_KEY_ARN']
    return aws('ecs','create-cluster',clusterName=v['NAME'],tags=tag_list(v,True),settings=[{'name':'containerInsights','value':'enhanced'}],configuration={'executeCommandConfiguration':config},capacityProviders=['FARGATE','FARGATE_SPOT'],defaultCapacityProviderStrategy=[{'capacityProvider':'FARGATE','weight':1,'base':1}])


def create_logs(v):
    return {'LogGroup':log_group(v,v['NAME'])}


def create_secret(v):
    request=dict(Name=v['NAME'],Tags=tag_list(v))
    if v['KMS_KEY_ARN']:request['KmsKeyId']=v['KMS_KEY_ARN']
    return aws('secretsmanager','create-secret',**request)


def create_appconfig(v):
    existing=aws('appconfig','list-applications').get('Items',[])
    if any(x['Name']==v['NAME'] for x in existing):raise ValueError('AppConfig application already exists; choose a new NAME.')
    app=aws('appconfig','create-application',Name=v['NAME'],Tags=v['tags'])['Id']
    environment=aws('appconfig','create-environment',ApplicationId=app,Name=v['APPCONFIG_ENVIRONMENT'],Tags=v['tags'])['Id']
    profile=aws('appconfig','create-configuration-profile',ApplicationId=app,Name=v['CONFIG_PROFILE'],LocationUri='hosted',Type='AWS.Freeform',Validators=[{'Type':'JSON_SCHEMA','Content':'{"type":"object"}'}],Tags=v['tags'])['Id']
    strategy=aws('appconfig','create-deployment-strategy',Name=v['NAME']+'-gradual',DeploymentDurationInMinutes=v['DEPLOYMENT_MINUTES'],FinalBakeTimeInMinutes=v['BAKE_MINUTES'],GrowthFactor=v['GROWTH_PERCENT'],GrowthType='LINEAR',ReplicateTo='NONE',Tags=v['tags'])['Id']
    return dict(ApplicationId=app,EnvironmentId=environment,ConfigurationProfileId=profile,DeploymentStrategyId=strategy)


def create_states(v):
    resource=arn(v,'states','stateMachine:'+v['NAME'])
    absent('stepfunctions','describe-state-machine',{'StateMachineDoesNotExist'},stateMachineArn=resource)
    role=execution_role(v,'states.amazonaws.com')
    group=log_group(v,'/aws/vendedlogs/states/'+v['NAME'])
    definition={'StartAt':'ConfigureWorkflow','States':{'ConfigureWorkflow':{'Type':'Fail','Error':'NotConfigured','Cause':'Replace this placeholder with your workflow.'}}}
    encryption={'type':'CUSTOMER_MANAGED_KMS_KEY','kmsKeyId':v['KMS_KEY_ARN']} if v['KMS_KEY_ARN'] else {'type':'AWS_OWNED_KEY'}
    return aws('stepfunctions','create-state-machine',name=v['NAME'],definition=json.dumps(definition),roleArn=role,type=v['STATE_MACHINE_TYPE'],tags=tag_list(v,True),loggingConfiguration={'level':'ERROR','includeExecutionData':False,'destinations':[{'cloudWatchLogsLogGroup':{'logGroupArn':arn(v,'logs','log-group:'+group)+':*'}}]},encryptionConfiguration=encryption)


def create_athena(v):
    return aws('athena','create-work-group',Name=v['NAME'],Configuration={'EnforceWorkGroupConfiguration':True,'ManagedQueryResultsConfiguration':{'Enabled':True},'PublishCloudWatchMetricsEnabled':True,'BytesScannedCutoffPerQuery':1073741824,'RequesterPaysEnabled':False},Tags=tag_list(v))


def create_kinesis(v):
    name=v['NAME']
    aws('kinesis','create-stream',StreamName=name,StreamModeDetails={'StreamMode':'ON_DEMAND'},Tags=v['tags'])
    active=lambda data:data['StreamDescriptionSummary']['StreamStatus']=='ACTIVE'
    wait_for('kinesis','describe-stream-summary',active,StreamName=name)
    aws('kinesis','start-stream-encryption',StreamName=name,EncryptionType='KMS',KeyId=v['KMS_KEY_ID'])
    wait_for('kinesis','describe-stream-summary',lambda data:active(data) and data['StreamDescriptionSummary'].get('EncryptionType')=='KMS',StreamName=name)
    if v['STREAM_RETENTION_HOURS']>24:
        aws('kinesis','increase-stream-retention-period',StreamName=name,RetentionPeriodHours=v['STREAM_RETENTION_HOURS'])
        wait_for('kinesis','describe-stream-summary',active,StreamName=name)
    resource=arn(v,'kinesis','stream/'+name)
    aws('kinesis','put-resource-policy',ResourceARN=resource,Policy=policy(tls_deny('kinesis:*',resource)))
    return {'StreamArn':resource}


def create_security(v):
    detectors=aws('guardduty','list-detectors').get('DetectorIds',[])
    analyzers=aws('accessanalyzer','list-analyzers').get('analyzers',[])
    if len(detectors)>1:raise ValueError('Expected at most one GuardDuty detector in REGION.')
    collision=next((a for a in analyzers if a['name']==v['NAME'] and a['type']!='ACCOUNT'),None)
    if collision:raise ValueError('NAME belongs to a different analyzer type; choose another NAME.')
    analyzer=next((a for a in analyzers if a['type']=='ACCOUNT'),None)
    if analyzer and analyzer['status'] not in ('ACTIVE','CREATING'):
        raise ValueError(f'Existing account access analyzer is {analyzer["status"]}; inspect it before continuing.')
    result={}
    if detectors:
        detector=detectors[0]
        aws('guardduty','update-detector',DetectorId=detector,Enable=True,FindingPublishingFrequency=v['FINDING_FREQUENCY'])
        aws('guardduty','tag-resource',ResourceArn=arn(v,'guardduty','detector/'+detector),Tags=v['tags'])
    else:
        created=aws('guardduty','create-detector',Enable=True,FindingPublishingFrequency=v['FINDING_FREQUENCY'],Tags=v['tags'])
        detector=created['DetectorId']
        if created.get('UnprocessedDataSources'):result['UnprocessedGuardDutyDataSources']=created['UnprocessedDataSources']
    if analyzer:
        analyzer_arn=analyzer['arn']
        aws('accessanalyzer','tag-resource',resourceArn=analyzer_arn,tags=v['tags'])
    else:
        analyzer_arn=aws('accessanalyzer','create-analyzer',analyzerName=v['NAME'],type='ACCOUNT',tags=v['tags'])['arn']
    result.update(Region=v['REGION'],DetectorId=detector,DetectorArn=arn(v,'guardduty','detector/'+detector),AnalyzerArn=analyzer_arn,AnalyzerType='ACCOUNT')
    return result


BUILDERS={name:globals()['create_'+name] for name in ['lambda','s3','sqs','sns','eventbridge','ecr','ecs','logs','secret','appconfig','states','athena','kinesis','security']}


def main():
    if len(sys.argv)!=2:raise ValueError('Supply a service: '+', '.join(BUILDERS))
    kind=sys.argv[1]
    values=settings(kind)
    identity=aws('sts','get-caller-identity')
    values.update(account=identity['Account'],partition=identity['Arn'].split(':')[1])
    print(json.dumps(BUILDERS[kind](values),indent=2))


if __name__=='__main__':
    try:main()
    except (AwsError,ValueError,OSError,KeyboardInterrupt) as error:
        print(str(error) or 'Cancelled.',file=sys.stderr)
        sys.exit(1)

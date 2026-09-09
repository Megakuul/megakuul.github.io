"""Validate resource creation payloads against AWS models and security invariants."""
import base64
import importlib.util
import io
import json
import os
import subprocess
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile
import botocore.session
from botocore.validate import validate_parameters

spec=importlib.util.spec_from_file_location('services',Path(__file__).resolve().parents[1]/'static/downloads/services/generator.py')
gen=importlib.util.module_from_spec(spec);spec.loader.exec_module(gen)
SESSION=botocore.session.get_session()

class FakeAWS:
    def __init__(self):self.calls=[];self.existing=False;self.deny=False;self.public=True;self.detectors=[];self.analyzers=[];self.fail_op=None;self.unprocessed={}
    def __call__(self,service,op,**p):
        model=SESSION.get_service_model({'s3api':'s3'}.get(service,service))
        name=next(n for n in model.operation_names if n.lower()==op.replace('-','').lower())
        validate_parameters(p,model.operation_model(name).input_shape)
        self.calls.append((service,op,p))
        if op==self.fail_op:raise gen.AwsError('An error occurred (AccessDeniedException) when calling operation: denied')
        if op=='list-detectors':return {'DetectorIds':self.detectors}
        if op=='list-analyzers':return {'analyzers':self.analyzers}
        if op=='create-detector':
            self.detectors=['a'*32]
            return {'DetectorId':self.detectors[0],'UnprocessedDataSources':self.unprocessed}
        if op=='create-analyzer':
            analyzer={'name':p['analyzerName'],'type':p['type'],'status':'CREATING','arn':'arn:aws:access-analyzer:eu-central-1:111122223333:analyzer/'+p['analyzerName']}
            self.analyzers.append(analyzer)
            return {'arn':analyzer['arn']}
        def missing(code):
            if self.deny:code='AccessDenied'
            if not self.existing:raise gen.AwsError(f'An error occurred ({code}) when calling operation: missing')
            return {}
        if op=='get-function':return missing('ResourceNotFoundException')
        if op=='head-bucket':return {} if p.get('ExpectedBucketOwner') else missing('404')
        if op=='get-queue-url':return missing('AWS.SimpleQueueService.NonExistentQueue')
        if op=='get-topic-attributes':return missing('NotFound')
        if op=='describe-state-machine':return missing('StateMachineDoesNotExist')
        if op=='get-role':return {'Role':{'Arn':'arn:aws:iam::111122223333:role/worker','AssumeRolePolicyDocument':{'Statement':[{'Effect':'Allow','Principal':{'Service':['lambda.amazonaws.com','states.amazonaws.com']},'Action':'sts:AssumeRole'}]}}}
        if op=='create-function':return {'FunctionArn':'arn:aws:lambda:eu-central-1:111122223333:function/app'}
        if op=='get-function-configuration':return {'State':'Active'}
        if op=='create-queue':return {'QueueUrl':'https://sqs.eu-central-1.amazonaws.com/111122223333/'+p['QueueName']}
        if op=='describe-clusters':return {'clusters':[{'status':'ACTIVE'}] if self.existing else []}
        if op=='list-applications':return {'Items':[]}
        if service=='appconfig' and op.startswith('create-'):return {'Id':'abcd123'}
        if op=='get-public-access-block':return {'PublicAccessBlockConfiguration':{k:self.public for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']}}
        if op=='describe-stream-summary':return {'StreamDescriptionSummary':{'StreamStatus':'ACTIVE','EncryptionType':'KMS'}}
        if op=='describe-subnets':return {'Subnets':[{'AvailabilityZone':'eu-central-1'+az,'VpcId':'vpc-123'} for az in ['a','b']]}
        if op=='describe-security-groups':return {'SecurityGroups':[{'VpcId':'vpc-123'}]}
        return {}

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.fake=FakeAWS()
        for mock in [patch.object(gen,'aws',self.fake),patch.object(gen.time,'sleep'),patch.dict(os.environ,{'AWS_REGION':'eu-central-1','NAME':'test-service','ROLE_NAME':'worker','OUTPUT_S3_URI':'s3://test-results/queries/','TAG_KEY':'Project','TAG_VALUE':'app','TAGS_JSON':'{"Owner":"me"}'},clear=True)]:
            mock.start();self.addCleanup(mock.stop)
    def create(self,kind):
        v=gen.settings(kind);v.update(account='111122223333',partition='aws');return gen.BUILDERS[kind](v)
    def payload(self,op):return next(p for _,o,p in self.fake.calls if o==op)
    def test_all_services_valid_aws_shapes_and_tagged_resources(self):
        for recipe in gen.CATALOG['services']:
            with self.subTest(service=recipe['id']):
                self.fake.calls=[];self.create(recipe['id'])
                for service,op,p in self.fake.calls:
                    if op.startswith('create-'):
                        tags=p.get('Tags',p.get('tags'))
                        if op=='create-bucket':
                            tags=next(x['Tagging']['TagSet'] for _,o,x in self.fake.calls if o=='put-bucket-tagging' and x['Bucket']==p['Bucket'])
                        if isinstance(tags,list):tags={t.get('Key',t.get('key')):t.get('Value',t.get('value')) for t in tags}
                        self.assertIsNotNone(tags,(service,op));self.assertEqual(tags['Project'],'app');self.assertEqual(tags['Owner'],'me')
                for _,op,p in self.fake.calls:
                    if op=='create-log-group':self.assertTrue(p['deletionProtectionEnabled'])
                    if op=='put-retention-policy':self.assertEqual(p['retentionInDays'],30)
    def test_security_enables_both_and_reuses_existing_resources_on_repeat(self):
        first=self.create('security');second=self.create('security')
        self.assertEqual(first,second)
        self.assertEqual(len([op for _,op,_ in self.fake.calls if op=='create-detector']),1)
        self.assertEqual(len([op for _,op,_ in self.fake.calls if op=='create-analyzer']),1)
        create=self.payload('create-detector');update=self.payload('update-detector')
        self.assertTrue(create['Enable']);self.assertTrue(update['Enable'])
        self.assertEqual(create['FindingPublishingFrequency'],'FIFTEEN_MINUTES')
        self.assertNotIn('Features',update);self.assertNotIn('DataSources',update)
        self.assertEqual(self.payload('create-analyzer')['type'],'ACCOUNT')
        tags=[(service,p) for service,op,p in self.fake.calls if op=='tag-resource']
        self.assertEqual({service for service,_ in tags},{'guardduty','accessanalyzer'})
        for _,p in tags:self.assertEqual(p.get('tags',p.get('Tags')),{'Owner':'me','Project':'app'})
        self.assertEqual(first['Region'],'eu-central-1')
    def test_security_reuses_other_name_and_honors_frequency(self):
        self.fake.detectors=['b'*32]
        self.fake.analyzers=[{'name':'existing-analyzer','type':'ACCOUNT','status':'ACTIVE','arn':'arn:aws:access-analyzer:eu-central-1:111122223333:analyzer/existing-analyzer'}]
        with patch.dict(os.environ,FINDING_FREQUENCY='ONE_HOUR'):result=self.create('security')
        self.assertTrue(result['AnalyzerArn'].endswith('/existing-analyzer'))
        self.assertEqual(self.payload('update-detector')['FindingPublishingFrequency'],'FIFTEEN_MINUTES')
        self.assertFalse(any(op.startswith('create-') for _,op,_ in self.fake.calls))
    def test_security_rejects_wrong_analyzer_scope_or_failed_analyzer_before_writes(self):
        for kind,status in [('ORGANIZATION','ACTIVE'),('ACCOUNT_UNUSED_ACCESS','ACTIVE'),('ACCOUNT','FAILED'),('ACCOUNT','DISABLED')]:
            self.fake.calls=[];self.fake.analyzers=[{'name':'test-service','type':kind,'status':status,'arn':'unused'}]
            with self.subTest(kind=kind,status=status),self.assertRaises(ValueError):self.create('security')
            self.assertFalse(any(op.startswith(('create','update','tag')) for _,op,_ in self.fake.calls))
    def test_security_failure_is_not_swallowed_and_partial_run_can_resume(self):
        self.fake.fail_op='create-analyzer'
        with self.assertRaises(gen.AwsError):self.create('security')
        self.fake.fail_op=None
        self.create('security')
        self.assertEqual(len([op for _,op,_ in self.fake.calls if op=='create-detector']),1)
        self.assertEqual(len(self.fake.analyzers),1)
        self.fake.calls=[];self.fake.fail_op='list-analyzers'
        with self.assertRaises(gen.AwsError):self.create('security')
        self.assertFalse(any(op.startswith(('create','update','tag')) for _,op,_ in self.fake.calls))
    def test_security_surfaces_unprocessed_guardduty_sources(self):
        self.fake.unprocessed={'MalwareProtection':{'ServiceRole':'missing'}}
        self.assertEqual(self.create('security')['UnprocessedGuardDutyDataSources'],self.fake.unprocessed)
    def test_old_tuning_variables_cannot_override_safe_defaults(self):
        with patch.dict(os.environ,FINDING_FREQUENCY='INVALID',LOG_RETENTION_DAYS='0',RUNTIME='bad',MEMORY_MB='9999',REGION='bad',LAMBDA_ROLE='wrong'):
            self.create('security');self.create('lambda')
        self.assertEqual(self.payload('create-detector')['FindingPublishingFrequency'],'FIFTEEN_MINUTES')
        self.assertEqual(self.payload('put-retention-policy')['retentionInDays'],30)
        self.assertEqual(self.payload('create-function')['MemorySize'],256)
        self.assertTrue(self.payload('create-function')['Role'].endswith('/worker'))
    def test_lambda_placeholder_and_limits(self):
        self.create('lambda');p=self.payload('create-function')
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(p['Code']['ZipFile']))) as package:self.assertIn('throw new Error',package.read('index.mjs').decode())
        self.assertEqual(p['Role'],'arn:aws:iam::111122223333:role/worker');self.assertEqual(p['LoggingConfig']['LogFormat'],'JSON')
        self.assertEqual(self.payload('put-function-concurrency')['ReservedConcurrentExecutions'],5)
        self.assertEqual(self.payload('put-function-recursion-config')['RecursiveLoop'],'Terminate')
    def test_s3_private_versioned_logged_encrypted(self):
        self.create('s3')
        for _,op,p in self.fake.calls:
            if op=='create-bucket':self.assertEqual(p['ObjectOwnership'],'BucketOwnerEnforced')
            if op=='put-public-access-block':self.assertTrue(all(p['PublicAccessBlockConfiguration'].values()))
            if op=='put-bucket-versioning':self.assertEqual(p['VersioningConfiguration']['Status'],'Enabled')
            if op=='put-bucket-policy':self.assertIn('RequireTLS',p['Policy'])
        self.assertIn('LoggingEnabled',self.payload('put-bucket-logging')['BucketLoggingStatus'])
    def test_sqs_redrive_scoped_and_retention_longer(self):
        self.create('sqs');queues=[p for _,o,p in self.fake.calls if o=='create-queue'];dead,source=queues
        self.assertEqual(dead['tags']['MonitoringRole'],'dlq')
        self.assertEqual(json.loads(dead['Attributes']['RedriveAllowPolicy'])['sourceQueueArns'],['arn:aws:sqs:eu-central-1:111122223333:test-service'])
        self.assertGreater(int(dead['Attributes']['MessageRetentionPeriod']),int(source['Attributes']['MessageRetentionPeriod']))
        self.assertEqual(source['Attributes']['SqsManagedSseEnabled'],'true')
    def test_existing_resources_and_access_denied_never_mutated(self):
        for existing,deny in [(True,False),(False,True)]:
            for kind in ['lambda','s3','sqs','sns','states']:
                self.fake.calls=[];self.fake.existing=existing;self.fake.deny=deny
                with self.assertRaises((gen.AwsError,ValueError)):self.create(kind)
                self.assertFalse(any(o.startswith(('create','put','tag','update')) for _,o,_ in self.fake.calls))
    def test_validation_prevents_writes(self):
        for kind,values in [('lambda',{'NAME':'bad name'}),('sqs',{'TAGS_JSON':'{"MonitoringRole":"x"}'}),('s3',{'NAME':'1.2.3.4'}),('logs',{'NAME':'bad name'}),('lambda',{'ROLE_NAME':''})]:
            self.fake.calls=[]
            with self.subTest(kind=kind,values=values),patch.dict(os.environ,values),self.assertRaises(ValueError):self.create(kind)
            self.assertFalse(any(o.startswith(('create','put','tag','update')) for _,o,_ in self.fake.calls))
    def test_fifo_type_is_inferred_from_name(self):
        with patch.dict(os.environ,NAME='jobs.fifo'):self.create('sqs')
        self.assertTrue(all(p['QueueName'].endswith('.fifo') for _,op,p in self.fake.calls if op=='create-queue'))
    def test_cli_payload_uses_private_temporary_file_for_large_zip(self):
        # setUp patches aws; use the function loaded from a fresh module.
        fresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(fresh)
        request_path=[]
        def run(command,**kwargs):
            self.assertLess(sum(len(x) for x in command),4096)
            request=Path(command[command.index('--cli-input-json')+1].removeprefix('file://'))
            request_path.append(request)
            self.assertEqual(json.loads(request.read_text())['Code']['ZipFile'],'a'*200000)
            self.assertEqual(request.parent.stat().st_mode & 0o077,0)
            return subprocess.CompletedProcess(command,0,'{}','')
        with patch.object(fresh.subprocess,'run',side_effect=run):fresh.aws('lambda','create-function',Code={'ZipFile':'a'*200000})
        self.assertFalse(request_path[0].exists())
    def test_athena_uses_encrypted_managed_results_without_a_bucket_input(self):
        self.create('athena')
        config=self.payload('create-work-group')['Configuration']
        self.assertEqual(config['ManagedQueryResultsConfiguration'],{'Enabled':True})
        self.assertNotIn('ResultConfiguration',config)
        self.assertEqual(config['BytesScannedCutoffPerQuery'],1073741824)
    def test_region_uses_aws_precedence_and_profile_fallback(self):
        with patch.dict(os.environ,AWS_REGION='us-east-2',AWS_DEFAULT_REGION='us-west-2',REGION='invalid'):
            self.assertEqual(gen.configured_region(),'us-east-2')
        with patch.dict(os.environ,AWS_REGION='',AWS_DEFAULT_REGION='us-west-2'):
            self.assertEqual(gen.configured_region(),'us-west-2')
        with patch.dict(os.environ,{'AWS_PROFILE':'sandbox'},clear=True),patch.object(gen.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'ap-southeast-2\n','')) as run:
            self.assertEqual(gen.configured_region(),'ap-southeast-2')
            self.assertEqual(run.call_args.args[0],['aws','configure','get','region'])
        with patch.dict(os.environ,{},clear=True),patch.object(gen.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','')),self.assertRaises(ValueError):gen.configured_region()

if __name__=='__main__':unittest.main()

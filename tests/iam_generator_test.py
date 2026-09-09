"""Role lifecycle tests; botocore validates CLI payloads when available."""
import copy
import fnmatch
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('iam_generator', ROOT/'static/downloads/iam/generator.py')
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)
try:
    import botocore.session
    from botocore.validate import validate_parameters
    SESSION = botocore.session.get_session()
except ImportError:
    SESSION = None


class FakeAWS:
    def __init__(self):
        self.calls=[]; self.roles={}; self.policies={}; self.profiles={}; self.attached={}; self.inline={}; self.deny=None; self.policy_users=[]

    def __call__(self, service, op, **payload):
        if SESSION:
            model=SESSION.get_service_model(service)
            name=next(n for n in model.operation_names if n.lower()==op.replace('-','').lower())
            validate_parameters(payload, model.operation_model(name).input_shape)
        self.calls.append((service,op,copy.deepcopy(payload)))
        if self.deny==op: raise gen.AwsError(f'An error occurred (AccessDenied) when calling {op}: denied')
        def missing(): raise gen.AwsError('An error occurred (NoSuchEntity) when calling operation: missing')
        if service=='sts': return dict(Account='111122223333',Arn='arn:aws:iam::111122223333:user/operator')
        if service!='iam': raise AssertionError((service,op,payload))
        name=payload.get('RoleName')
        if op=='get-role': return {'Role':self.roles[name]} if name in self.roles else missing()
        if op=='create-role':
            self.roles[name]=dict(RoleName=name,Arn=f'arn:aws:iam::111122223333:role/{name}',AssumeRolePolicyDocument=json.loads(payload['AssumeRolePolicyDocument']))
            return {'Role':self.roles[name]}
        if op=='get-policy':
            arn=payload['PolicyArn']
            return {'Policy':dict(DefaultVersionId='v1',Description=self.policies[arn]['Description'])} if arn in self.policies else missing()
        if op=='create-policy':
            arn=f'arn:aws:iam::111122223333:policy{payload["Path"]}{payload["PolicyName"]}'
            self.policies[arn]={**payload,'Document':json.loads(payload['PolicyDocument'])}
            return {'Policy':{'Arn':arn}}
        if op=='attach-role-policy':self.attached.setdefault(name,set()).add(payload['PolicyArn']);return {}
        if op=='list-attached-role-policies':return {'AttachedPolicies':[dict(PolicyArn=a) for a in self.attached.get(name,[])]}
        if op=='list-role-policies':return {'PolicyNames':self.inline.get(name,[])}
        if op=='list-entities-for-policy':return {'PolicyRoles':[dict(RoleName=n) for n,arns in self.attached.items() if payload['PolicyArn'] in arns], 'PolicyUsers':self.policy_users}
        if op=='get-instance-profile':return {'InstanceProfile':{'Roles':self.profiles[payload['InstanceProfileName']]}} if payload['InstanceProfileName'] in self.profiles else missing()
        if op=='create-instance-profile':self.profiles[payload['InstanceProfileName']]=[];return {}
        if op=='add-role-to-instance-profile':self.profiles[payload['InstanceProfileName']]=[{'RoleName':name}];return {}
        if op=='tag-policy':self.policies[payload['PolicyArn']]['Tags']=payload['Tags'];return {}
        if op.startswith('tag-'):return {}
        raise AssertionError((service,op,payload))


class RoleTests(unittest.TestCase):
    def setUp(self):
        self.fake=FakeAWS()
        self.env=patch.dict(os.environ,dict(ROLE_NAME='worker',AWS_REGION='eu-central-1',TAG_KEY='Project',TAG_VALUE='app',TAGS_JSON='{"Environment":"test"}',CLUSTER_NAME='app',CLUSTER_ARN='arn:aws:eks:eu-central-1:111122223333:cluster/app',NAMESPACE='app',SERVICE_ACCOUNT='worker'),clear=True)
        self.env.start();self.addCleanup(self.env.stop)
        self.aws=patch.object(gen,'aws',self.fake);self.aws.start();self.addCleanup(self.aws.stop)
        self.output=patch('sys.stdout',new_callable=io.StringIO);self.output.start();self.addCleanup(self.output.stop)

    def make_role(self, id='lambda'):
        gen.create_role(next(r for r in gen.CATALOG['roles'] if r['id']==id),gen.context())

    def assert_no_writes(self):
        self.assertFalse(any(op.startswith(('create','update','tag','attach','delete','put')) for _,op,_ in self.fake.calls))

    def test_every_role_has_exactly_one_empty_tagged_customer_policy_and_required_managed_policies(self):
        for recipe in gen.CATALOG['roles']:
            with self.subTest(role=recipe['id']),patch.dict(os.environ,ROLE_NAME=recipe['id']):
                self.make_role(recipe['id']);self.make_role(recipe['id'])
                bound=[a for a in self.fake.attached[recipe['id']] if a.split(':')[4]!='aws']
                self.assertEqual(bound,[f'arn:aws:iam::111122223333:policy/generator/{recipe["id"]}-permissions'])
                self.assertEqual(self.fake.policies[bound[0]]['Document'],gen.CATALOG['emptyPolicy'])
                self.assertEqual(len(self.fake.attached[recipe['id']]),len(recipe['managedPolicies'])+1)
        self.assertEqual(len(self.fake.policies),len(gen.CATALOG['roles']))
        self.assertEqual(len([x for x in self.fake.calls if x[1]=='create-policy']),len(gen.CATALOG['roles']))
        for _,op,payload in self.fake.calls:
            if op in ('create-role','create-policy','create-instance-profile'):
                self.assertEqual(payload['Tags'],[{'Key':'Environment','Value':'test'},{'Key':'Project','Value':'app'}])
        self.assertNotIn('cloudformation',{x[0] for x in self.fake.calls})
        self.assertIn('arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',self.fake.attached['lambda'])
        self.assertIn('eks-node',self.fake.profiles)

    def test_empty_policy_cannot_allow_or_deny_runtime_actions(self):
        document=gen.CATALOG['emptyPolicy']
        self.assertTrue(document['Statement'])
        for statement in document['Statement']:
            self.assertEqual(statement['Effect'],'Deny')
            for action in ['logs:PutLogEvents','ec2:CreateNetworkInterface','s3:GetObject','future:AnyNewAction']:
                matches=not fnmatch.fnmatchcase(action,statement['NotAction'])
                self.assertFalse(matches,action)

    def test_rerun_preserves_console_edits_and_refreshes_tags(self):
        self.make_role();arn=next(iter(self.fake.policies))
        edited={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'sqs:SendMessage','Resource':'arn:aws:sqs:eu-central-1:111122223333:orders'}]}
        self.fake.policies[arn]['Document']=copy.deepcopy(edited)
        self.fake.calls=[]
        with patch.dict(os.environ,TAG_VALUE='updated'):self.make_role()
        self.assertEqual(self.fake.policies[arn]['Document'],edited)
        self.assertIn({'Key':'Project','Value':'updated'},self.fake.policies[arn]['Tags'])
        self.assertFalse(any(op in ('create-policy','create-policy-version','delete-policy-version','put-role-policy') for _,op,_ in self.fake.calls))

    def test_two_roles_get_different_policies(self):
        self.make_role()
        with patch.dict(os.environ,ROLE_NAME='second-worker'):self.make_role()
        self.assertEqual(len(self.fake.policies),2)

    def test_rejects_shared_policy_without_changes(self):
        self.make_role();arn=next(iter(self.fake.policies))
        self.fake.attached['another-role']={arn};self.fake.calls=[]
        with self.assertRaisesRegex(ValueError,'shared'):self.make_role()
        self.assert_no_writes()

    def test_rejects_policy_attached_to_user_without_changes(self):
        self.make_role();self.fake.policy_users=[{'UserName':'someone'}];self.fake.calls=[]
        with self.assertRaisesRegex(ValueError,'shared'):self.make_role()
        self.assert_no_writes()

    def test_rejects_other_customer_or_inline_policies_without_detaching(self):
        for inline in (False,True):
            with self.subTest(inline=inline):
                self.fake.__init__()
                self.make_role()
                if inline:self.fake.inline['worker']=['existing-inline']
                else:self.fake.attached['worker'].add('arn:aws:iam::111122223333:policy/existing')
                self.fake.calls=[]
                with self.assertRaisesRegex(ValueError,'other customer/inline'):self.make_role()
                self.assert_no_writes()

    def test_conflicting_trust_is_not_replaced(self):
        self.make_role();self.fake.calls=[]
        with self.assertRaisesRegex(ValueError,'different trust'):self.make_role('ecs-task')
        self.assert_no_writes()

    def test_name_collision_is_not_adopted(self):
        self.make_role();next(iter(self.fake.policies.values()))['Description']='Unrelated policy';self.fake.calls=[]
        with self.assertRaisesRegex(ValueError,'already in use'):self.make_role()
        self.assert_no_writes()

    def test_permission_denied_is_not_treated_as_missing(self):
        self.fake.deny='get-policy'
        with self.assertRaises(gen.AwsError):self.make_role()
        self.assert_no_writes()

    def test_removed_policy_modes_cannot_attach_or_create(self):
        for mode in ('policy','attach'):
            with patch.object(gen.sys,'argv',['generator.py',mode]),self.assertRaisesRegex(ValueError,'copyable JSON'):gen.main()
        self.assertEqual(self.fake.calls,[])

    def test_role_preview_performs_no_writes(self):
        with patch.object(gen.sys,'argv',['generator.py','role','lambda','--json']):gen.main()
        self.assert_no_writes()

    def test_role_menu_still_works(self):
        with patch.object(gen.sys.stdin,'isatty',return_value=True),patch('builtins.input',return_value='1'):
            self.assertEqual(gen.select('roles',[('Lambda','lambda')],'IAM_RECIPE'),'lambda')

    def test_invalid_tags_rejected_before_aws(self):
        for settings in [{'TAG_KEY':'aws:owner'},{'TAGS_JSON':'[]'},{'TAGS_JSON':'{"Owner":123}'}]:
            with patch.dict(os.environ,settings),self.assertRaises(ValueError):gen.context()
        self.assertEqual(self.fake.calls,[])

if __name__=='__main__':unittest.main()

import base64,io,json,os,subprocess,sys,tempfile,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RECIPES=json.loads(subprocess.check_output(['node','tests/native-powertools-data.mjs'],cwd=ROOT,text=True))
class NativeTests(unittest.TestCase):
 def run_recipe(self,recipe,cli=True,extra=None):
  with tempfile.TemporaryDirectory() as d:
   work=Path(d);aws=work/'aws';aws.write_text('#!'+sys.executable+'\n'+(ROOT/'tests/fixtures/native_aws.py').read_text());aws.chmod(0o755)
   env={**os.environ,'MOCK_ROOT':d,'PATH':d+':'+os.environ['PATH'],'AWS_REGION':'eu-central-1','NAME':'test-app','ROLE_NAME':'shared-role','TAG_KEY':'Team / Project','TAG_VALUE':'app = blue','CLUSTER_NAME':'cluster','NAMESPACE':'app','SERVICE_ACCOUNT':'worker','VPC_ID':'vpc-0123456789abcdef0','SG_NAMES':'app,worker',**(extra or {})}
   if recipe.get('templateFile'):
    (work/'download.yaml').write_text(recipe['yaml'])
    curl=work/'curl';curl.write_text('#!'+sys.executable+'\n'+(ROOT/'tests/fixtures/native_curl.py').read_text());curl.chmod(0o755)
    env['MOCK_TEMPLATE_FILE']=recipe['templateFile']
   result=subprocess.run(['bash','-c',(recipe.get('cliCommand') or recipe['command']) if cli else recipe['command']],env=env,cwd=d,text=True,capture_output=True,timeout=90)
   calls=[json.loads(line) for line in (work/'calls.jsonl').read_text().splitlines()] if (work/'calls.jsonl').exists() else []
   return result,calls
 def test_every_command_is_self_contained_and_shell_valid(self):
  for r in RECIPES:
   for key in ['command','cliCommand']:
    if not r.get(key):continue
    if key=='command' and r.get('templateFile'):self.assertTrue(r[key].startswith('curl -fsSL https://megakuul.ch/worldskills/powertools/templates/'));self.assertLess(len(r[key]),1000);self.assertNotIn('bash -c',r[key])
    self.assertNotIn('\n',r[key]);self.assertNotIn('python',r[key].lower());self.assertNotIn('read -p',r[key]);self.assertIn('TAG_KEY:?',r[key]);self.assertIn('TAG_VALUE:?',r[key]);self.assertEqual(subprocess.run(['bash','-n','-c',r[key]],capture_output=True).returncode,0,r['id'])
 def test_all_direct_commands_use_valid_aws_requests(self):
  for r in RECIPES:
   with self.subTest(recipe=r['id']):
    result,calls=self.run_recipe(r);self.assertEqual(result.returncode,0,result.stderr);self.assertFalse(any(c['service']=='cloudformation' for c in calls))
    for c in calls:
     p=c['payload']
     if c['operation']=='create-log-group':self.assertTrue(p['deletionProtectionEnabled']);self.assertEqual(p['tags']['Team / Project'],'app = blue')
     if c['operation']=='create-bucket':self.assertIn({'Key':'Team / Project','Value':'app = blue'},p['CreateBucketConfiguration']['Tags'])
     self.assertNotEqual(c['operation'],'put-bucket-tagging')
     if c['operation']=='put-retention-policy':self.assertEqual(p['retentionInDays'],30)
     if c['operation']=='create-function':
      with zipfile.ZipFile(io.BytesIO(base64.b64decode(p['Code']['ZipFile']['zip']))) as z:self.assertIn('exports.handler',z.read('index.js').decode())
 def test_cfn_submits_exact_displayed_template_without_waiting(self):
  for r in [r for r in RECIPES if r.get('templateFile')]:
   with self.subTest(recipe=r['id']):
    result,calls=self.run_recipe(r,False);self.assertEqual(result.returncode,0,result.stderr)
    create=next(c for c in calls if c['service']=='cloudformation');self.assertEqual(create['operation'],'create-stack');self.assertEqual(create['template'],r['document']);self.assertEqual(create['templateText'],r['yaml']);self.assertEqual(create['payload']['TemplateBody'],'file://'+r['templateFile']);self.assertEqual(create['payload']['Tags'],[{'Key':'Team / Project','Value':'app = blue'}])
 def test_failed_download_never_submits_a_stack(self):
  result,calls=self.run_recipe(next(r for r in RECIPES if r['id']=='logging-setup'),False,{'MOCK_CURL_FAIL':'1'});self.assertEqual(result.returncode,22);self.assertEqual(calls,[])
 def test_role_and_bound_policy_use_shared_role_name_and_creation_tags(self):
  for recipe in [r for r in RECIPES if r['id'].startswith('iam-role-')]:
   result,calls=self.run_recipe(recipe);self.assertEqual(result.returncode,0,result.stderr)
   role=next(c['payload'] for c in calls if c['operation']=='create-role');self.assertEqual(role['RoleName'],'shared-role')
   policies=[c['payload'] for c in calls if c['operation']=='create-policy'];self.assertEqual(len(policies),1);self.assertEqual(policies[0]['PolicyName'],'shared-role-permissions')
   self.assertTrue(any(c['operation']=='attach-role-policy' and c['payload']['RoleName']=='shared-role' and c['payload']['PolicyArn'].endswith('/shared-role-permissions') for c in calls))
   for c in calls:
    if c['operation'] in ['create-role','create-policy','create-instance-profile']:self.assertIn({'Key':'Team / Project','Value':'app = blue'},c['payload']['Tags'])
   self.assertFalse(any(c['operation'] in ['tag-policy','tag-instance-profile','tag-role'] or c['service']=='cloudformation' for c in calls))
 def test_logging_profile_and_config_recorder_are_tagged_at_creation(self):
  for recipe_id,operation in [('logging-setup','create-instance-profile'),('config-setup','put-configuration-recorder')]:
   result,calls=self.run_recipe(next(r for r in RECIPES if r['id']==recipe_id));self.assertEqual(result.returncode,0,result.stderr)
   payload=next(c['payload'] for c in calls if c['operation']==operation);self.assertIn({'Key':'Team / Project','Value':'app = blue'},payload['Tags'])
   self.assertFalse(any(c['operation'] in ['tag-instance-profile','tag-resource'] or c['service']=='cloudformation' for c in calls))
 def test_existing_eks_is_configured_directly(self):
  command=subprocess.check_output(['node','--input-type=module','-e',"import {eksCommand} from './src/routes/worldskills/powertools/operation-templates.mjs';process.stdout.write(eksCommand());"],cwd=ROOT,text=True)
  result,calls=self.run_recipe({'cliCommand':command});self.assertEqual(result.returncode,0,result.stderr);self.assertTrue(any(c['operation']=='update-cluster-config' for c in calls));self.assertFalse(any(c['operation']=='tag-resource' for c in calls));self.assertFalse(any(c['service'] in ['lambda','cloudformation'] for c in calls))
 def test_eks_only_retags_existing_groups_and_stops_on_access_denied(self):
  command=subprocess.check_output(['node','--input-type=module','-e',"import {eksCommand} from './src/routes/worldskills/powertools/operation-templates.mjs';process.stdout.write(eksCommand());"],cwd=ROOT,text=True)
  result,calls=self.run_recipe({'command':command},extra={'MOCK_EXISTING':'1'});self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(sum(c['operation']=='tag-resource' for c in calls),1);self.assertTrue(any(c['operation']=='put-log-group-deletion-protection' for c in calls))
  result,calls=self.run_recipe({'command':command},extra={'MOCK_FAIL':'logs:create-log-group'});self.assertNotEqual(result.returncode,0);self.assertFalse(any(c['operation']=='update-cluster-config' for c in calls))
 def test_s3_creation_tags_preserve_region_configuration(self):
  for region in ['us-east-1','eu-central-1']:
   result,calls=self.run_recipe(next(r for r in RECIPES if r['id']=='service-s3'),extra={'AWS_REGION':region});self.assertEqual(result.returncode,0,result.stderr)
   buckets=[c['payload'] for c in calls if c['operation']=='create-bucket'];self.assertEqual(len(buckets),2)
   for bucket in buckets:
    config=bucket['CreateBucketConfiguration'];self.assertIn({'Key':'Team / Project','Value':'app = blue'},config['Tags']);self.assertEqual(config.get('LocationConstraint'),None if region=='us-east-1' else region)
   self.assertFalse(any(c['operation']=='put-bucket-tagging' for c in calls))
 def test_missing_tags_fail_before_aws(self):
  for key in ['TAG_KEY','TAG_VALUE']:
   for cli in [True,False]:
    result,calls=self.run_recipe(next(r for r in RECIPES if r['id']=='service-lambda'),cli,{key:''});self.assertNotEqual(result.returncode,0);self.assertEqual(calls,[])
 def test_dlq_accepts_future_sources_without_binding_an_iam_role(self):
  result,calls=self.run_recipe(next(r for r in RECIPES if r['id']=='dlq-setup'));self.assertEqual(result.returncode,0,result.stderr)
  q=next(c['payload'] for c in calls if c['operation']=='create-queue');self.assertEqual(json.loads(q['Attributes']['RedriveAllowPolicy']),{'redrivePermission':'allowAll'});self.assertFalse(any(c['operation']=='attach-role-policy' for c in calls))
 def test_permission_failure_stops_before_later_resources(self):
  result,calls=self.run_recipe(next(r for r in RECIPES if r['id']=='service-lambda'),extra={'MOCK_FAIL':'logs:put-retention-policy'});self.assertEqual(result.returncode,42);self.assertFalse(any(c['operation']=='create-function' for c in calls))
 def test_security_reuses_existing_detector_and_analyzer(self):
  result,calls=self.run_recipe(next(r for r in RECIPES if r['id']=='service-security'),extra={'MOCK_EXISTING':'1'});self.assertEqual(result.returncode,0,result.stderr);self.assertTrue(any(c['operation']=='update-detector' for c in calls));self.assertFalse(any(c['operation'] in ['create-detector','create-analyzer'] for c in calls))
if __name__=='__main__':unittest.main()

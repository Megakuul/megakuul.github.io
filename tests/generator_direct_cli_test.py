import base64
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class DirectCliTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.commands = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', '''
import * as g from './src/routes/worldskills/generator/generators.mjs';
import {directDeploymentCommand} from './src/routes/worldskills/generator/direct-cli.mjs';
import {readFileSync} from 'node:fs';
const renderer=readFileSync('src/routes/worldskills/generator/snippets/direct-render.py','utf8');
const collector=readFileSync('src/routes/worldskills/generator/snippets/health-monitor.py','utf8');
const kinds={'security-groups':g.securityGroupsTemplate,logging:g.loggingTemplate,waf:g.wafTemplate,dlq:g.dlqTemplate,config:g.configTemplate,alarms:()=>g.alarmsTemplate(collector)};
console.log(JSON.stringify(Object.fromEntries(Object.entries(kinds).map(([kind,build])=>[kind,directDeploymentCommand(build(),kind,renderer)]))));
'''], cwd=ROOT, text=True))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='generator-cli-test-')
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        mock = self.work / 'aws'
        mock.write_text('#!' + sys.executable + '\n' + (ROOT / 'tests/fixtures/generator_aws.py').read_text())
        mock.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.work) + ':' + os.environ['PATH'], 'MOCK_ROOT': str(self.work), 'AWS_REGION': 'eu-central-1', 'TAG_KEY': 'Team / Project', 'TAG_VALUE': 'analytics = blue', 'VPC_ID': 'vpc-0123456789abcdef0', 'SG_NAMES': 'app-web,my worker,analytics/db', 'PYTHONDONTWRITEBYTECODE': '1'}

    def run_command(self, kind, **env):
        command = self.commands[kind]
        self.assertNotIn('\n', command)
        self.assertIn(' && ', command)
        return subprocess.run(['bash', '-c', command], env={**self.env, **env}, text=True, capture_output=True, timeout=90)

    def calls(self):
        path = self.work / 'calls.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_all_six_commands_use_valid_sdk_requests_and_support_repeat_runs(self):
        for kind in self.commands:
            with self.subTest(kind=kind):
                for _ in range(2):
                    result = self.run_command(kind)
                    self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertTrue(all(call['service'] != 'cloudformation' for call in calls))
        logs = [call['payload'] for call in calls if call['operation'] == 'create-log-group']
        self.assertTrue(all(p['deletionProtectionEnabled'] for p in logs))
        self.assertTrue(all(p['tags'] == {'Team / Project': 'analytics = blue'} for p in logs))
        functions = [call['payload'] for call in calls if call['operation'] == 'create-function']
        self.assertTrue(functions)
        for function in functions:
            with zipfile.ZipFile(io.BytesIO(base64.b64decode(function['Code']['ZipFile']['zip']))) as package:
                self.assertEqual(package.read('index.py').decode(), (ROOT / 'src/routes/worldskills/generator/snippets/health-monitor.py').read_text())
        groups = json.loads((self.work / 'state.json').read_text())['groups']
        self.assertEqual(set(groups), {'app-web', 'my worker', 'analytics/db'})
        for group in groups.values():
            self.assertEqual(group['IpPermissions'], [])
            self.assertEqual(sorted(r['FromPort'] for r in group['IpPermissionsEgress']), [80, 443])
        wafs = [call['payload'] for call in calls if call['operation'] == 'create-web-acl']
        for waf in wafs:
            self.assertEqual(waf['DefaultAction'], {'Allow': {}})
            self.assertTrue(all(rule['OverrideAction'] == {'Count': {}} for rule in waf['Rules'][:2]))
        alarms = [call['payload'] for call in calls if call['operation'] == 'put-metric-alarm']
        self.assertEqual({p['MetricName'] for p in alarms}, {'DLQDepth', 'WorstLambdaErrorRate'})

    def test_config_us_east_1_bucket_creation_and_repeat_run(self):
        for _ in range(2):
            result = self.run_command('config', AWS_REGION='us-east-1')
            self.assertEqual(result.returncode, 0, result.stderr)
        buckets = [c['payload'] for c in self.calls() if c['operation'] == 'create-bucket']
        self.assertTrue(all('CreateBucketConfiguration' not in bucket for bucket in buckets))
        self.assertTrue(any(c['operation'] == 'start-configuration-recorder' for c in self.calls()))

    def test_access_denied_stops_before_later_steps(self):
        result = self.run_command('logging', MOCK_FAIL='logs:put-retention-policy')
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertIn('AccessDeniedException', result.stderr)
        self.assertEqual(self.calls()[-1]['operation'], 'put-retention-policy')
        self.assertFalse(any(c['service'] == 'iam' for c in self.calls()))

    def test_existing_external_config_preserves_its_role_and_bucket(self):
        result = self.run_command('config', MOCK_EXTERNAL_CONFIG='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c['operation'] for c in self.calls()], ['get-caller-identity', 'describe-configuration-recorders', 'tag-resource', 'start-configuration-recorder', 'describe-configuration-recorder-status'])

    def test_dlq_needs_no_source_or_role_and_ignores_old_knobs(self):
        result=self.run_command('dlq',SOURCE_QUEUE_ARN='arn:aws:sqs:eu-central-1:123456789012:source',LAMBDA_ROLE='wrong',ROLE_NAME='shared-role')
        self.assertEqual(result.returncode,0,result.stderr)
        queue=next(c['payload'] for c in self.calls() if c['operation']=='create-queue')
        self.assertEqual(json.loads(queue['Attributes']['RedriveAllowPolicy']),{'redrivePermission':'allowAll'})
        self.assertEqual(queue['Attributes']['MessageRetentionPeriod'],'1209600')
        self.assertFalse(any(c['operation'] in ['attach-role-policy','create-policy'] for c in self.calls()))
    def test_eventbridge_partial_failure_is_not_success(self):
        result = self.run_command('alarms', MOCK_TARGET_FAILURE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('EventBridge rejected targets', result.stderr)
        self.assertFalse(any(c['operation'] == 'put-metric-alarm' for c in self.calls()))


if __name__ == '__main__':
    unittest.main()

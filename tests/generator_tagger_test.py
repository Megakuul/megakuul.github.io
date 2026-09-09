import json
import os
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

import boto3
from botocore.stub import Stubber

ROOT = Path(__file__).resolve().parents[1]
CODE = subprocess.check_output(
    ['node', '--input-type=module', '-e', 'import {taggerCode} from "./src/routes/worldskills/generator/resource-tags.mjs"; process.stdout.write(taggerCode);'],
    cwd=ROOT, text=True,
)


class TaggerTest(unittest.TestCase):
    def setUp(self):
        self.responses = []
        response = types.SimpleNamespace(SUCCESS='SUCCESS', FAILED='FAILED', send=lambda *args, **kwargs: self.responses.append((args, kwargs)))
        with patch.dict(sys.modules, {'cfnresponse': response}):
            self.namespace = {}
            exec(CODE, self.namespace)
        self.clients = {}
        self.stubs = {}
        for service in ['iam', 'config', 'wafv2']:
            self.clients[service] = boto3.client(service, region_name='eu-central-1', aws_access_key_id='test', aws_secret_access_key='test')
            self.stubs[service] = Stubber(self.clients[service])
            self.stubs[service].activate()
        self.patch_client = patch.object(self.namespace['boto3'], 'client', side_effect=lambda service, **_: self.clients[service])
        self.patch_client.start()
        self.addCleanup(self.patch_client.stop)
        self.tags = [{'Key': 'Project', 'Value': 'analytics'}]

    def tearDown(self):
        for stub in self.stubs.values():
            stub.assert_no_pending_responses()
            stub.deactivate()

    def invoke(self, targets, request='Create'):
        event = {'RequestType': request, 'LogicalResourceId': 'ResourceTags', 'ResourceProperties': {'TagKey': 'Project', 'TagValue': 'analytics', 'Targets': targets}}
        if request != 'Create':
            event['PhysicalResourceId'] = 'stable-id'
        self.namespace['handler'](event, None)
        return self.responses[-1]

    def test_tags_policy_profile_recorder_and_waf_with_actual_sdk_shapes(self):
        policy = 'arn:aws:iam::123456789012:policy/test'
        recorder = 'arn:aws:config:eu-central-1:123456789012:configuration-recorder/test/1234'
        waf = 'arn:aws:wafv2:eu-central-1:123456789012:regional/webacl/test/1234'
        self.stubs['iam'].add_response('tag_policy', {}, {'PolicyArn': policy, 'Tags': self.tags})
        self.stubs['iam'].add_response('tag_instance_profile', {}, {'InstanceProfileName': 'test', 'Tags': self.tags})
        self.stubs['config'].add_response('describe_configuration_recorders', {'ConfigurationRecorders': [{'name': 'test', 'arn': recorder}]}, {'ConfigurationRecorderNames': ['test']})
        self.stubs['config'].add_response('tag_resource', {}, {'ResourceArn': recorder, 'Tags': self.tags})
        self.stubs['wafv2'].add_response('tag_resource', {}, {'ResourceARN': waf, 'Tags': self.tags})
        args, _ = self.invoke([{'Kind': 'Policy', 'Id': policy}, {'Kind': 'InstanceProfile', 'Id': 'test'}, {'Kind': 'Recorder', 'Id': 'test'}, {'Kind': 'WebACL', 'Id': waf}])
        self.assertEqual(args[2], 'SUCCESS')
        self.assertEqual(args[4], 'ResourceTags')

    def test_update_reapplies_tags_and_preserves_physical_id(self):
        self.stubs['iam'].add_response('tag_instance_profile', {}, {'InstanceProfileName': 'test', 'Tags': self.tags})
        args, _ = self.invoke([{'Kind': 'InstanceProfile', 'Id': 'test'}], 'Update')
        self.assertEqual(args[2], 'SUCCESS')
        self.assertEqual(args[4], 'stable-id')

    def test_delete_keeps_tags_on_retained_resources_without_api_calls(self):
        args, _ = self.invoke([{'Kind': 'InstanceProfile', 'Id': 'test'}], 'Delete')
        self.assertEqual(args[2], 'SUCCESS')
        self.assertEqual(args[4], 'stable-id')

    def test_tagging_denied_fails_the_stack(self):
        self.stubs['iam'].add_client_error('tag_instance_profile', service_error_code='AccessDenied', expected_params={'InstanceProfileName': 'test', 'Tags': self.tags})
        args, kwargs = self.invoke([{'Kind': 'InstanceProfile', 'Id': 'test'}])
        self.assertEqual(args[2], 'FAILED')
        self.assertIn('AccessDenied', kwargs['reason'])

    def test_missing_recorder_arn_fails_the_stack(self):
        self.stubs['config'].add_response('describe_configuration_recorders', {'ConfigurationRecorders': [{'name': 'test'}]}, {'ConfigurationRecorderNames': ['test']})
        args, _ = self.invoke([{'Kind': 'Recorder', 'Id': 'test'}])
        self.assertEqual(args[2], 'FAILED')


if __name__ == '__main__':
    unittest.main()

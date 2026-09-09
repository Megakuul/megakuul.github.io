import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  deploymentCommand,
  securityGroupsTemplate,
} from '../src/routes/worldskills/generator/generators.mjs';

function run(t, names, scenario = 'new') {
  const dir = mkdtempSync(join(tmpdir(), 'sg-generator-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, 'aws'),
    `#!/usr/bin/env python3
import json,os,pathlib,sys
root=pathlib.Path(os.environ['SG_CAPTURE']); args=sys.argv[1:]
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\\n')
assert args[:2] in (['cloudformation','create-stack'],['cloudformation','update-stack'])
file=args[args.index('--template-body')+1].removeprefix('file://')
(root/'template').write_bytes(pathlib.Path(file).read_bytes())
(root/'path').write_text(file)
if os.environ['SG_SCENARIO']=='denied':
    print('An error occurred (AccessDenied)',file=sys.stderr); sys.exit(42)
if os.environ['SG_SCENARIO']=='update' and args[1]=='create-stack':
    print('An error occurred (AlreadyExistsException)',file=sys.stderr); sys.exit(254)
print('arn:aws:cloudformation:eu-central-1:123456789012:stack/quickstart-security-groups/id')
`,
    { mode: 0o755 },
  );
  const template = securityGroupsTemplate();
  const command = deploymentCommand(template, 'security-groups');
  assert.equal(command.includes('\n'), false);
  const result = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AWS_REGION: 'eu-central-1',
      NAME: '',
      PATH: dir + ':' + process.env.PATH,
      SG_CAPTURE: dir,
      SG_SCENARIO: scenario,
      SG_NAMES: names,
      VPC_ID: 'vpc-1234567890abcdef0',
      TAG_KEY: 'Project',
      TAG_VALUE: 'analytics / dev',
    },
  });
  const calls = existsSync(join(dir, 'calls'))
    ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse)
    : [];
  if (calls.length) {
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'template'), 'utf8')), template);
    assert.equal(existsSync(readFileSync(join(dir, 'path'), 'utf8')), false);
    for (const call of calls) {
      assert.ok(call.includes('CAPABILITY_AUTO_EXPAND'));
      const params = Object.fromEntries(
        JSON.parse(call[call.indexOf('--parameters') + 1]).map(p => [
          p.ParameterKey,
          p.ParameterValue,
        ]),
      );
      assert.deepEqual(params, {
        VpcId: 'vpc-1234567890abcdef0',
        GroupNames: names
          .split(',')
          .map(s => s.trim())
          .join(','),
        TagKey: 'Project',
        TagValue: 'analytics / dev',
      });
      assert.deepEqual(JSON.parse(call[call.indexOf('--tags') + 1]), [
        { Key: 'Project', Value: 'analytics / dev' },
      ]);
    }
  }
  return { result, calls };
}

test('security group template has no ingress and only outbound IPv4 TCP 80 and 443', () => {
  const template = securityGroupsTemplate();
  const [identifier, collection, fragment] = template.Resources['Fn::ForEach::SecurityGroups'];
  assert.equal(identifier, 'GroupName');
  assert.deepEqual(collection, { Ref: 'GroupNames' });
  const group = fragment['SecurityGroup&{GroupName}'];
  assert.equal(group.Type, 'AWS::EC2::SecurityGroup');
  assert.deepEqual(group.Properties.VpcId, { Ref: 'VpcId' });
  assert.deepEqual(group.Properties.GroupName, { Ref: 'GroupName' });
  assert.deepEqual(group.Properties.SecurityGroupIngress, []);
  assert.deepEqual(group.Properties.SecurityGroupEgress, [
    { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, CidrIp: '0.0.0.0/0' },
    { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' },
  ]);
  assert.deepEqual(group.Properties.Tags, [{ Key: { Ref: 'TagKey' }, Value: { Ref: 'TagValue' } }]);
  assert.equal(template.Transform, 'AWS::LanguageExtensions');
  assert.equal(template.Parameters.VpcId.Type, 'AWS::EC2::VPC::Id');
});

for (const scenario of ['new', 'update', 'denied']) {
  test('bulk security groups submit without waiting: ' + scenario, t => {
    const { result, calls } = run(t, 'app-web, my worker,analytics/db,batch[1]', scenario);
    assert.equal(result.status, scenario === 'denied' ? 42 : 0, result.stderr);
    assert.deepEqual(
      calls.map(c => c[1]),
      scenario === 'update' ? ['create-stack', 'update-stack'] : ['create-stack'],
    );
  });
}
for (const names of [
  '',
  'app,,worker',
  'app,APP',
  'app-web,app_web',
  'sg-test',
  'app`id`',
  'a'.repeat(256),
]) {
  test(
    'invalid or colliding names rejected before AWS: ' + JSON.stringify(names.slice(0, 40)),
    t => {
      const { result, calls } = run(t, names);
      assert.notEqual(result.status, 0);
      assert.deepEqual(calls, []);
      assert.match(result.stderr, /Supply|Invalid|unique/);
    },
  );
}

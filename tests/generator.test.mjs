import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  deploymentCommand,
  alarmsTemplate,
  configTemplate,
  loggingTemplate,
  wafTemplate,
  dlqTemplate,
} from '../src/routes/worldskills/generator/generators.mjs';

function runDeployment(
  t,
  template,
  kind,
  fail = false,
  existing = false,
  scenario = 'new',
  tagKey = 'Team / Project',
  tagValue = 'Analytics: blue=green+1@example',
) {
  const work = mkdtempSync(join(tmpdir(), 'generator-test-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  writeFileSync(
    join(work, 'aws'),
    `#!/usr/bin/env python3
import json,os,pathlib,sys
args=sys.argv[1:]; root=pathlib.Path(os.environ['GENERATOR_CAPTURE'])
with (root/'calls.jsonl').open('a') as f: f.write(json.dumps(args)+'\\n')
if args[:2]==['cloudformation','describe-stack-resource']:
    print('quickstart-config')
elif args[0]=='cloudformation':
    assert args[1] in ('create-stack','update-stack'), 'Unexpected waiting/status call'
    file=args[args.index('--template-body')+1].removeprefix('file://')
    (root/'template.json').write_bytes(pathlib.Path(file).read_bytes())
    (root/'template-path').write_text(file)
    if os.environ.get('GENERATOR_FAIL')=='yes':
        print('An error occurred (AccessDenied) when calling the CreateStack operation',file=sys.stderr)
        sys.exit(42)
    scenario=os.environ['GENERATOR_SCENARIO']
    if args[1]=='create-stack' and scenario!='new':
        print('An error occurred (AlreadyExistsException) when calling the CreateStack operation: Stack already exists',file=sys.stderr)
        sys.exit(254)
    if args[1]=='update-stack' and scenario in ('unchanged','update-denied'):
        print('An error occurred (ValidationError): No updates are to be performed.' if scenario=='unchanged' else 'An error occurred (AccessDenied): Denied',file=sys.stderr)
        sys.exit(254)
    print('arn:aws:cloudformation:eu-central-1:123456789012:stack/test/id')
elif args[:2]==['configservice','describe-configuration-recorders']:
    print('arn:aws:config:eu-central-1:123456789012:configuration-recorder/existing-recorder/id' if args[args.index('--query')+1].endswith('.arn') else 'quickstart-config' if os.environ.get('GENERATOR_EXISTING')=='owned' else 'existing-recorder' if os.environ.get('GENERATOR_EXISTING')=='yes' else 'None')
else: print('[]')
`,
    { mode: 0o755 },
  );
  const command = deploymentCommand(template, kind);
  assert.equal(command.includes('\n'), false);
  const result = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AWS_REGION: 'eu-central-1',
      NAME: '',
      PATH: work + ':' + process.env.PATH,
      GENERATOR_CAPTURE: work,
      GENERATOR_FAIL: fail ? 'yes' : 'no',
      GENERATOR_EXISTING: existing === 'owned' ? 'owned' : existing ? 'yes' : 'no',
      GENERATOR_SCENARIO: scenario,
      TAG_KEY: tagKey,
      TAG_VALUE: tagValue,
    },
  });
  assert.equal(result.status, fail ? 42 : scenario === 'update-denied' ? 254 : 0, result.stderr);
  if (fail || scenario === 'update-denied') assert.match(result.stderr, /AccessDenied/);
  if (existing && existing !== 'owned') {
    assert.equal(existsSync(join(work, 'template.json')), false);
    const calls = readFileSync(join(work, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(
      calls.map(args => args[1]),
      [
        'describe-configuration-recorders',
        'describe-configuration-recorders',
        'tag-resource',
        'start-configuration-recorder',
        'describe-configuration-recorder-status',
      ],
    );
    assert.equal(calls[3].at(-1), 'existing-recorder');
    assert.deepEqual(JSON.parse(calls[2][calls[2].indexOf('--tags') + 1]), [
      { Key: tagKey, Value: tagValue },
    ]);
    assert.equal(
      calls[2][calls[2].indexOf('--resource-arn') + 1],
      'arn:aws:config:eu-central-1:123456789012:configuration-recorder/existing-recorder/id',
    );
    return calls;
  }
  assert.deepEqual(JSON.parse(readFileSync(join(work, 'template.json'))), template);
  assert.equal(
    existsSync(readFileSync(join(work, 'template-path'), 'utf8')),
    false,
    'temporary template cleaned up',
  );
  const calls = readFileSync(join(work, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  if (kind === 'config') {
    assert.equal(calls.shift()[1], 'describe-configuration-recorders');
    if (existing === 'owned')
      assert.deepEqual(
        calls.splice(0, 5).map(args => args[1]),
        [
          'describe-configuration-recorders',
          'tag-resource',
          'start-configuration-recorder',
          'describe-configuration-recorder-status',
          'describe-stack-resource',
        ],
      );
  }
  assert.deepEqual(
    calls.map(args => args[1]),
    scenario === 'new' ? ['create-stack'] : ['create-stack', 'update-stack'],
  );
  for (const call of calls) {
    assert.equal(call[call.indexOf('--region') + 1], 'eu-central-1');
    assert.equal(call[call.indexOf('--stack-name') + 1], 'quickstart-' + kind);
    assert.equal(call[call.indexOf('--query') + 1], 'StackId');
    const parameters = Object.fromEntries(
      JSON.parse(call[call.indexOf('--parameters') + 1]).map(p => [
        p.ParameterKey,
        p.ParameterValue,
      ]),
    );
    assert.equal(parameters.TagKey, tagKey);
    assert.equal(parameters.TagValue, tagValue);
    assert.deepEqual(JSON.parse(call[call.indexOf('--tags') + 1]), [
      { Key: tagKey, Value: tagValue },
    ]);
    assert.ok(call.includes('CAPABILITY_IAM'));
  }
  assert.equal(existsSync(readFileSync(join(work, 'template-path'), 'utf8') + '.err'), false);
  if (scenario === 'unchanged') assert.match(result.stdout, /No changes: quickstart-/);
  else if (!fail && scenario !== 'update-denied')
    assert.match(result.stdout, /arn:aws:cloudformation:/);
  return calls;
}

for (const [kind, build] of [
  ['logging', loggingTemplate],
  ['waf', wafTemplate],
  ['dlq', dlqTemplate],
  ['config', configTemplate],
  [
    'alarms',
    () =>
      alarmsTemplate(
        readFileSync(
          new URL(
            '../src/routes/worldskills/generator/snippets/health-monitor.py',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
  ],
]) {
  test(kind + ' command submits the exact displayed template without waiting', t => {
    const template = build();
    assert.ok(Buffer.byteLength(JSON.stringify(template)) < 51200);
    const calls = runDeployment(t, template, kind);
    const params = Object.fromEntries(
      JSON.parse(calls[0][calls[0].indexOf('--parameters') + 1]).map(p => [
        p.ParameterKey,
        p.ParameterValue,
      ]),
    );
    if (kind === 'waf') assert.equal(params.ManagedRuleMode, 'COUNT');
    if (kind === 'dlq') assert.equal(params.SourceQueueArn, undefined);
  });
}

for (const scenario of ['update', 'unchanged', 'update-denied']) {
  test('deployment handles existing stacks: ' + scenario, t => {
    runDeployment(t, dlqTemplate(), 'dlq', false, false, scenario);
  });
}

test('deployment propagates failure and quotes shell metacharacters literally', t => {
  const template = dlqTemplate();
  template.Description =
    'An apostrophe \' and $HOME, `printf escaped`, $(printf escaped), "quotes", and a newline\n';
  runDeployment(t, template, 'dlq', true);
});

test('logging setup retains logs and limits writers to destination groups', () => {
  const { Resources: resources } = loggingTemplate();
  const groups = Object.values(resources).filter(r => r.Type === 'AWS::Logs::LogGroup');
  const roles = Object.values(resources).filter(r => r.Type === 'AWS::IAM::Role');
  assert.equal(groups.length, 25);
  assert.equal(roles.length, 9);
  for (const group of groups) {
    assert.equal(group.Properties.DeletionProtectionEnabled, true);
    assert.equal(group.DeletionPolicy, 'Retain');
    assert.equal(group.UpdateReplacePolicy, 'Retain');
    assert.deepEqual(group.Properties.RetentionInDays, { Ref: 'RetentionDays' });
  }
  for (const role of roles) {
    for (const statement of role.Properties.Policies[0].PolicyDocument.Statement) {
      const actions = [statement.Action].flat();
      if (actions.includes('logs:PutLogEvents')) assert.notEqual(statement.Resource, '*');
      assert.ok(
        !actions.some(action => action === 'iam:*' || action === '*' || action.startsWith('s3:')),
      );
    }
  }
  assert.deepEqual(
    resources.VpcFlowLogsRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition
      .StringEquals['aws:SourceAccount'],
    { Ref: 'AWS::AccountId' },
  );
  const resourcePolicy = JSON.parse(
    resources.ServiceLogPolicy.Properties.PolicyDocument['Fn::Sub'],
  );
  assert.ok(
    resourcePolicy.Statement.every(s =>
      s.Resource.every(r => typeof r === 'string' && r.endsWith(':log-stream:*')),
    ),
  );
  assert.equal(
    Object.values(resources).filter(r => r.Type === 'AWS::Logs::DeliveryDestination').length,
    5,
  );
  assert.ok(
    !Object.values(resources).some(r => r.Type === 'AWS::ApiGateway::Account'),
    'does not replace the regional API Gateway account role',
  );
});

test('WAF only enforces a high source-IP rate by default; managed checks observe', () => {
  const template = wafTemplate();
  const acl = template.Resources.WebACL.Properties;
  assert.equal(template.Resources.WafLogs.Properties.DeletionProtectionEnabled, true);
  assert.deepEqual(template.Resources.WafLogs.Properties.RetentionInDays, { Ref: 'RetentionDays' });
  assert.equal(template.Resources.WafLogs.DeletionPolicy, 'Retain');
  assert.equal(template.Resources.WafLogs.UpdateReplacePolicy, 'Retain');
  assert.equal(acl.Scope, 'REGIONAL');
  assert.deepEqual(acl.DefaultAction, { Allow: {} });
  assert.equal(template.Parameters.ManagedRuleMode.Default, 'COUNT');
  assert.equal(template.Parameters.RateLimit.Default, 100000);
  const rate = acl.Rules.find(r => r.Name === 'HighRatePerIP');
  assert.deepEqual(rate.Action, { Block: {} });
  assert.equal(rate.Statement.RateBasedStatement.EvaluationWindowSec, 300);
  assert.equal(rate.Statement.RateBasedStatement.AggregateKeyType, 'IP');
  const managed = acl.Rules.filter(r => r.Statement.ManagedRuleGroupStatement);
  assert.equal(managed.length, 2);
  for (const rule of managed)
    assert.deepEqual(rule.OverrideAction['Fn::If'], [
      'BlockManagedRules',
      { None: {} },
      { Count: {} },
    ]);
  assert.equal(acl.VisibilityConfig.SampledRequestsEnabled, false);
  assert.ok(
    !Object.values(template.Resources).some(r => r.Type === 'AWS::WAFv2::WebACLAssociation'),
  );
});

test('DLQ supports async Lambda and standard SQS with scoped send permissions', () => {
  const template = dlqTemplate();
  const queue = template.Resources.DeadLetterQueue;
  assert.equal(queue.Properties.MessageRetentionPeriod, 14 * 24 * 3600);
  assert.equal(queue.Properties.SqsManagedSseEnabled, true);
  assert.ok(!queue.Properties.FifoQueue);
  assert.equal(queue.DeletionPolicy, 'Retain');
  assert.deepEqual(queue.Properties.RedriveAllowPolicy, { redrivePermission: 'allowAll' });
  assert.equal(template.Resources.LambdaSendPolicy, undefined);
  const send = JSON.parse(template.Outputs.LambdaSendPolicyJSON.Value['Fn::Sub']);
  assert.equal(send.Statement[0].Action, 'sqs:SendMessage');
  assert.equal(send.Statement[0].Resource, '${DeadLetterQueue.Arn}');
  assert.match(template.Outputs.SourceQueueRedrivePolicy.Description, /source queue DLQ/);
});

test('Config starts an existing recorder without replacing its settings or delivery channel', t => {
  runDeployment(t, configTemplate(), 'config', false, true);
});

test('Config updates its own existing stack so roles and buckets also receive tags', t => {
  runDeployment(t, configTemplate(), 'config', false, 'owned', 'update');
});

test('Config creates continuous recording with scoped delivery and a private retained bucket', () => {
  const { Resources: resources } = configTemplate();
  assert.equal(resources.ConfigurationRecorder.Properties.RecordingGroup.AllSupported, true);
  assert.equal(
    resources.ConfigurationRecorder.Properties.RecordingMode.RecordingFrequency,
    'CONTINUOUS',
  );
  assert.ok(resources.DeliveryChannel.DependsOn.includes('ConfigurationRecorder'));
  assert.ok(resources.DeliveryChannel.DependsOn.includes('ConfigBucketPolicy'));
  assert.equal(resources.ConfigBucket.DeletionPolicy, 'Retain');
  assert.ok(
    Object.values(resources.ConfigBucket.Properties.PublicAccessBlockConfiguration).every(
      value => value === true,
    ),
  );
  const role = resources.ConfigRole.Properties;
  assert.match(role.ManagedPolicyArns[0]['Fn::Sub'], /service-role\/AWS_ConfigRole$/);
  assert.deepEqual(
    role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['aws:SourceAccount'],
    { Ref: 'AWS::AccountId' },
  );
  assert.ok(
    role.Policies[0].PolicyDocument.Statement.every(statement => statement.Resource !== '*'),
  );
});

test('dynamic alarms use separate regional metrics, notifications and protected collector logs', () => {
  const code = readFileSync(
    new URL('../src/routes/worldskills/generator/snippets/health-monitor.py', import.meta.url),
    'utf8',
  );
  const template = alarmsTemplate(code);
  const resources = template.Resources;
  assert.equal(resources.Collector.Properties.Code.ZipFile, code);
  assert.equal(Object.values(resources).filter(r => r.Type === 'AWS::CloudWatch::Alarm').length, 2);
  assert.equal(resources.DLQDepthAlarm.Properties.MetricName, 'DLQDepth');
  assert.equal(resources.LambdaErrorRateAlarm.Properties.MetricName, 'WorstLambdaErrorRate');
  assert.equal(resources.Poll.Properties.ScheduleExpression, 'rate(5 minutes)');
  assert.equal(resources.CollectorLogs.Properties.DeletionProtectionEnabled, true);
  assert.deepEqual(resources.CollectorLogs.Properties.RetentionInDays, { Ref: 'RetentionDays' });
  assert.equal(resources.CollectorLogs.DeletionPolicy, 'Retain');
  for (const id of ['DLQDepthAlarm', 'LambdaErrorRateAlarm']) {
    assert.equal(resources[id].Properties.TreatMissingData, 'breaching');
    assert.equal(resources[id].Properties.AlarmActions.length, 1);
  }
  assert.ok(
    dlqTemplate().Resources.DeadLetterQueue.Properties.Tags.some(
      tag => tag.Key === 'MonitoringRole' && tag.Value === 'dlq',
    ),
  );
  const statements = resources.CollectorRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.ok(
    statements.every(
      statement =>
        ![statement.Action]
          .flat()
          .some(action => /sqs:(Receive|Delete|Send)|lambda:Invoke|iam:/.test(action)),
    ),
  );
});

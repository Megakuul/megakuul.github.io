import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { collectorCode } from '../src/routes/worldskills/powertools/runtime-code.mjs';
import { iamGroups } from '../src/routes/worldskills/powertools/iam-commands.mjs';
import { recipes } from './native-powertools-data.mjs';
const env = {
  PARTITION: 'aws',
  AWS_REGION: 'eu-central-1',
  ACCOUNT_ID: '111122223333',
  MONITOR: 'test',
  MIN_INVOCATIONS: '1',
};
const arn = name => `arn:aws:sqs:${env.AWS_REGION}:${env.ACCOUNT_ID}:${name}`;
function runtime(code, respond = () => ({})) {
  const calls = [];
  const sdk = new Proxy(
    {},
    {
      get(_, name) {
        return String(name).endsWith('Client')
          ? class {
              async send(command) {
                calls.push(command);
                return respond(command.name, command.input);
              }
            }
          : class {
              constructor(input) {
                this.name = String(name).replace(/Command$/, '');
                this.input = input;
              }
            };
      },
    },
  );
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: () => sdk,
    process: { env },
    console: { log() {}, error() {} },
    Date,
  });
  return { handler: exports.handler, calls };
}
function metricResponse(input, partial = false) {
  return {
    MetricDataResults: input.MetricDataQueries.map(q => ({
      Id: q.Id,
      StatusCode: partial ? 'PartialData' : 'Complete',
      Timestamps: [new Date('2026-09-09T12:00:00Z')],
      Values: [q.Id.endsWith('e') ? 2 : 10],
    })),
  };
}
test('all creation cards expose required tag inputs and no helper installers', () => {
  for (const r of recipes) {
    if (r.env)
      for (const name of ['TAG_KEY', 'TAG_VALUE'])
        assert.equal(r.env.find(v => v.name === name)?.required, true, r.id);
    for (const key of ['command', 'cliCommand'])
      assert.doesNotMatch(r[key] ?? '', /python|boto3|read -p/i);
  }
});
test('flat JSON policies and exactly one customer managed policy per role remain', () => {
  const groups = iamGroups();
  assert.equal(
    groups.flatMap(g => g.recipes).filter(r => r.id.startsWith('iam-access-')).length,
    60,
  );
  for (const r of groups.find(g => g.id === 'iam-roles').recipes) {
    const policies = Object.values(r.resourceTemplate.Resources).filter(
      r => r.Type === 'AWS::IAM::ManagedPolicy',
    );
    assert.equal(policies.length, 1);
    assert.deepEqual(policies[0].Properties.Roles, [{ Ref: 'Role' }]);
  }
});
test('collector publishes empty inventory explicitly', async () => {
  const r = runtime(collectorCode);
  const result = await r.handler();
  assert.equal(result.depth, 0);
  assert.equal(result.lambdaCount, 0);
  assert.equal(r.calls.filter(c => c.name === 'PutMetricData').length, 1);
  const namespace = r.calls.find(c => c.name === 'PutMetricData').input.Namespace;
  assert.equal(namespace, 'Powertools/Health');
  const resources = recipes.find(r => r.id === 'alarms-setup').document.Resources;
  for (const resource of Object.values(resources))
    if (resource.Type === 'AWS::CloudWatch::Alarm')
      assert.equal(resource.Properties.Namespace, namespace);
  const statements = resources.CollectorRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.equal(
    statements.find(s => s.Action === 'cloudwatch:PutMetricData').Condition.StringEquals[
      'cloudwatch:namespace'
    ],
    namespace,
  );
});
test('collector discovers DLQs from redrive and tags; ordinary queue load is excluded', async () => {
  const r = runtime(collectorCode, (op, p) => {
    if (op === 'ListQueues')
      return p.NextToken
        ? { QueueUrls: ['tagged'] }
        : { QueueUrls: ['source', 'dlq', 'ordinary'], NextToken: 'next' };
    if (op === 'GetQueueAttributes')
      return {
        Attributes: {
          QueueArn: arn(p.QueueUrl),
          ApproximateNumberOfMessagesVisible: p.QueueUrl === 'ordinary' ? '999' : '3',
          ApproximateNumberOfMessagesNotVisible: '1',
          ApproximateNumberOfMessagesDelayed: '2',
          ...(p.QueueUrl === 'source'
            ? { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: arn('dlq') }) }
            : {}),
        },
      };
    if (op === 'ListQueueTags')
      return { Tags: p.QueueUrl === 'tagged' ? { MonitoringRole: 'dlq' } : {} };
    return {};
  });
  const result = await r.handler();
  assert.equal(result.dlqCount, 2);
  assert.equal(result.depth, 12);
});
test('collector deduplicates Lambda versions and publishes worst per-minute error percentage', async () => {
  const r = runtime(collectorCode, (op, p) =>
    op === 'ListFunctions'
      ? { Functions: [{ FunctionName: 'worker' }, { FunctionName: 'worker', Version: '1' }] }
      : op === 'GetMetricData'
        ? metricResponse(p)
        : {},
  );
  const result = await r.handler();
  assert.equal(result.lambdaCount, 1);
  assert.equal(result.worstErrorRate, 20);
  const queries = r.calls.find(c => c.name === 'GetMetricData').input.MetricDataQueries;
  assert.equal(queries.length, 2);
});
for (const failure of ['permission', 'missing-target', 'partial-metrics'])
  test(`collector never publishes healthy metrics after ${failure}`, async () => {
    const r = runtime(collectorCode, (op, p) => {
      if (op === 'ListFunctions') {
        if (failure === 'permission') throw Error('AccessDenied');
        return {
          Functions: [
            {
              FunctionName: 'worker',
              ...(failure === 'missing-target'
                ? { DeadLetterConfig: { TargetArn: arn('missing') } }
                : {}),
            },
          ],
        };
      }
      if (op === 'GetMetricData') return metricResponse(p, true);
      return {};
    });
    await assert.rejects(r.handler());
    assert.equal(r.calls.filter(c => c.name === 'PutMetricData').length, 0);
  });
test('powertools never deploy custom resources or deployment-helper Lambdas', () => {
  for (const recipe of recipes) {
    for (const [id, resource] of Object.entries(recipe.resourceTemplate.Resources)) {
      assert.doesNotMatch(resource.Type ?? '', /Custom::|AWS::CloudFormation::CustomResource/);
      if (resource.Type === 'AWS::Lambda::Function')
        assert.ok(
          (recipe.id === 'service-lambda' && id === 'Function') ||
            (recipe.id === 'alarms-setup' && id === 'Collector'),
          recipe.id + ':' + id,
        );
    }
  }
});
test('WAF uses native tags and has no deployment follow-up', () => {
  const waf = recipes.find(r => r.id === 'waf-setup');
  assert.equal('tagCommand' in waf, false);
  const acl = Object.values(waf.document.Resources).find(r => r.Type === 'AWS::WAFv2::WebACL');
  assert.deepEqual(acl.Properties.Tags, [{ Key: { Ref: 'TagKey' }, Value: { Ref: 'TagValue' } }]);
});

test('every creation recipe defaults to a downloaded template with an emergency CLI alternative', () => {
  assert.equal(recipes.length, 37);
  assert.equal(recipes.filter(r => r.cfnTagNote).length, 18);
  for (const recipe of recipes) {
    assert.equal('tagCommand' in recipe, false);
    assert.match(
      recipe.command,
      /^curl -fsSL https:\/\/megakuul.ch\/worldskills\/powertools\/templates\//,
    );
    assert.ok(
      recipe.command.includes(`-o ${recipe.templateFile} && aws cloudformation create-stack `),
    );
    assert.doesNotMatch(recipe.cliCommand, /cloudformation|curl /);
    assert.equal(recipe.document, recipe.resourceTemplate);
    assert.ok(Buffer.byteLength(recipe.yaml) <= 51200, recipe.id);
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loggingTemplate,
  wafTemplate,
  dlqTemplate,
  configTemplate,
  alarmsTemplate,
  recipeCommand,
} from '../src/routes/worldskills/generator/generators.mjs';

const root = new URL('../src/routes/worldskills/generator/', import.meta.url);
const recipes = JSON.parse(readFileSync(new URL('recipes.json', root)));
const tags = [{ Key: { Ref: 'TagKey' }, Value: { Ref: 'TagValue' } }];
const untaggable = new Set([
  'AWS::Logs::ResourcePolicy',
  'AWS::WAFv2::LoggingConfiguration',
  'AWS::SQS::QueuePolicy',
  'AWS::S3::BucketPolicy',
  'AWS::Config::DeliveryChannel',
  'AWS::Lambda::EventInvokeConfig',
  'AWS::Lambda::Permission',
  'AWS::SNS::TopicPolicy',
  'Custom::ResourceTags',
]);
for (const build of [
  loggingTemplate,
  wafTemplate,
  dlqTemplate,
  configTemplate,
  () => alarmsTemplate(readFileSync(new URL('snippets/health-monitor.py', root), 'utf8')),
]) {
  test('all taggable resources covered: ' + (build.name || 'alarms'), () => {
    const template = build();
    const targets = template.Resources.ResourceTags?.Properties.Targets ?? [];
    for (const [id, resource] of Object.entries(template.Resources)) {
      if (untaggable.has(resource.Type)) {
        assert.equal(resource.Properties?.Tags, undefined, resource.Type);
      } else if (
        [
          'AWS::IAM::InstanceProfile',
          'AWS::IAM::ManagedPolicy',
          'AWS::Config::ConfigurationRecorder',
        ].includes(resource.Type)
      ) {
        assert.equal(resource.Properties.Tags, undefined, resource.Type);
        assert.ok(
          targets.some(t => t.Id.Ref === id),
          id,
        );
      } else {
        assert.ok(
          resource.Properties.Tags.some(t => JSON.stringify(t) === JSON.stringify(tags[0])),
          id,
        );
      }
    }
    assert.equal(template.Parameters.TagKey.Default, 'Project');
    assert.equal(template.Parameters.TagValue.Default, 'quickstart');
    const keyPattern = new RegExp('^' + template.Parameters.TagKey.AllowedPattern + '$');
    for (const key of ['aws:owner', 'AWS:owner', 'MonitoringRole'])
      assert.equal(keyPattern.test(key), false);
    if (template.Resources.DeadLetterQueue)
      assert.ok(
        template.Resources.DeadLetterQueue.Properties.Tags.some(
          t => t.Key === 'MonitoringRole' && t.Value === 'dlq',
        ),
      );
    if (template.Resources.ResourceTagger) {
      assert.equal(
        template.Resources.ResourceTaggerLogs.Properties.DeletionProtectionEnabled,
        true,
      );
      assert.equal(template.Resources.ResourceTaggerLogs.DeletionPolicy, 'Retain');
      const statements =
        template.Resources.ResourceTaggerRole.Properties.Policies[0].PolicyDocument.Statement;
      for (const statement of statements) {
        assert.notEqual(statement.Resource, '*');
        for (const action of [statement.Action].flat())
          assert.match(
            action,
            /^(iam:TagPolicy|iam:TagInstanceProfile|config:TagResource|config:DescribeConfigurationRecorders|wafv2:TagResource|logs:CreateLogStream|logs:PutLogEvents)$/,
          );
      }
    }
  });
}

test('IAM creation commands preserve displayed policies and custom environment tags', t => {
  const work = mkdtempSync(join(tmpdir(), 'iam-tag-test-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  writeFileSync(
    join(work, 'aws'),
    '#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n',
    { mode: 0o755 },
  );
  for (const recipe of recipes.flatMap(group => group.recipes)) {
    const command = recipeCommand(recipe.command, recipe.policy);
    if (!/^aws iam create-(role|policy) /.test(recipe.command)) {
      assert.equal(command.includes('--tags'), false);
      continue;
    }
    assert.equal(command.includes('\n'), false);
    for (const value of [
      'analytics / blue=green+1@example',
      '',
      '"quoted", $HOME, $(printf escaped), `printf escaped`, \\',
    ]) {
      const result = spawnSync('bash', ['-c', command], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: work + ':' + process.env.PATH,
          TAG_KEY: 'Team / Project',
          TAG_VALUE: value,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const args = JSON.parse(result.stdout);
      assert.deepEqual(JSON.parse(args[args.indexOf('--tags') + 1]), [
        { Key: 'Team / Project', Value: value },
      ]);
      const flag =
        args[1] === 'create-role' ? '--assume-role-policy-document' : '--policy-document';
      assert.deepEqual(JSON.parse(args[args.indexOf(flag) + 1]), recipe.policy);
    }
  }
  const command = recipeCommand('aws iam create-role --role-name test');
  for (const key of ['aws:owner', 'AWS:owner', 'MonitoringRole']) {
    const result = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      env: { ...process.env, PATH: work + ':' + process.env.PATH, TAG_KEY: key },
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

// Bundle the server-only generators without starting SvelteKit or a file watcher.
const bundled = buildSync({
  entryPoints: ['src/lib/server/powertools/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.yaml': 'text' },
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const recipes = compiled.exports.powertoolsGroups().flatMap(group => group.recipes);

test('every generated log group has a retained rotating KMS key in both CFN modes', () => {
  let count = 0;
  for (const recipe of recipes) {
    for (const template of [recipe.resourceTemplate, recipe.serviceOnly?.document].filter(
      Boolean,
    )) {
      for (const group of Object.values(template.Resources).filter(
        r => r.Type === 'AWS::Logs::LogGroup',
      )) {
        const key = template.Resources[group.Properties.KmsKeyId['Fn::GetAtt'][0]];
        assert.equal(key.Type, 'AWS::KMS::Key', recipe.id);
        assert.equal(key.Properties.EnableKeyRotation, true, recipe.id);
        assert.equal(key.DeletionPolicy, 'Retain', recipe.id);
        assert.equal(key.UpdateReplacePolicy, 'Retain', recipe.id);
        assert.ok(group.Properties.RetentionInDays > 0, recipe.id);
        const statement = key.Properties.KeyPolicy.Statement.find(
          s => s.Sid === 'ScopedLogEncryption',
        );
        assert.ok(statement.Condition.ArnLike['kms:EncryptionContext:aws:logs:arn'].length);
        // Keys must not depend on groups (including transitively through the REST API).
        assert.doesNotMatch(
          JSON.stringify(key),
          /\$\{Api\}|\"Ref\":\"(?:TaskLogs|ExecLogs|InsightsLogs|ActionLogs)\"/,
        );
        count++;
      }
    }
  }
  assert.ok(count > 60);
});

test('ECS Action Logs connect the cluster to its encrypted destination', () => {
  const { Resources: r } = recipes.find(p => p.id === 'service-ecs').resourceTemplate;
  assert.equal(r.ActionLogSource.Properties.LogType, 'EcsActionLogs');
  assert.deepEqual(r.ActionLogSource.Properties.ResourceArn, { 'Fn::GetAtt': ['Cluster', 'Arn'] });
  assert.deepEqual(r.ActionLogDelivery.Properties.DeliverySourceName, { Ref: 'ActionLogSource' });
  assert.deepEqual(r.ActionLogDelivery.Properties.DeliveryDestinationArn, {
    'Fn::GetAtt': ['ActionLogDestination', 'Arn'],
  });
  assert.equal(r.ActionLogDelivery.DependsOn, 'ActionLogsPolicy');
  assert.equal(
    r.Cluster.Properties.Configuration.ExecuteCommandConfiguration.LogConfiguration
      .CloudWatchEncryptionEnabled,
    true,
  );
});

test('ECS session and storage keys are configured with scoped Fargate grants', () => {
  const { Resources: r } = recipes.find(p => p.id === 'service-ecs').resourceTemplate;
  const config = r.Cluster.Properties.Configuration;
  assert.deepEqual(config.ExecuteCommandConfiguration.KmsKeyId, {
    'Fn::GetAtt': ['ExecKey', 'Arn'],
  });
  assert.deepEqual(config.ManagedStorageConfiguration, {
    KmsKeyId: { 'Fn::GetAtt': ['StorageKey', 'Arn'] },
    FargateEphemeralStorageKmsKeyId: { 'Fn::GetAtt': ['StorageKey', 'Arn'] },
  });
  for (const id of ['ExecKey', 'StorageKey']) {
    assert.equal(r[id].Properties.EnableKeyRotation, true);
    assert.equal(r[id].DeletionPolicy, 'Retain');
  }
  const grant = r.StorageKey.Properties.KeyPolicy.Statement.find(
    s => s.Action === 'kms:CreateGrant',
  );
  assert.equal(grant.Principal.Service, 'fargate.amazonaws.com');
  assert.deepEqual(grant.Condition.StringEquals['kms:EncryptionContext:aws:ecs:clusterName'], {
    Ref: 'Name',
  });
  assert.deepEqual(grant.Condition['ForAllValues:StringEquals']['kms:GrantOperations'], [
    'Decrypt',
  ]);
  for (const [id, action] of [
    ['EcsExecTaskAccess', 'kms:Decrypt'],
    ['EcsExecOperatorAccess', 'kms:GenerateDataKey'],
  ]) {
    const permission = r[id].Properties.PolicyDocument.Statement.find(s => s.Action === action);
    assert.deepEqual(permission.Resource, { 'Fn::GetAtt': ['ExecKey', 'Arn'] });
  }
  const serviceOnly = recipes.find(p => p.id === 'service-ecs').serviceOnly.document;
  assert.ok(serviceOnly.Resources.ExecKey);
  assert.ok(serviceOnly.Resources.StorageKey);
  assert.equal(serviceOnly.Resources.EcsExecOperatorAccess, undefined);
});

const mockAws = String.raw`
aws() {
  local service="$1" operation="$2" payload='{}'
  shift 2
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --cli-input-json ]; then payload="$2"; shift; fi
    shift
  done
  jq -cn --arg service "$service" --arg operation "$operation" --argjson payload "$payload" '{service:$service,operation:$operation,payload:$payload}' >&2
  case "$service/$operation" in
    sts/get-caller-identity) printf '%s' '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:role/test"}' ;;
    kms/create-key) printf '%s' '{"KeyMetadata":{"KeyId":"test-key","Arn":"arn:aws:kms:eu-west-1:123456789012:key/test-key"}}' ;;
    logs/put-delivery-destination) printf '%s' '{"deliveryDestination":{"arn":"arn:aws:logs:eu-west-1:123456789012:delivery-destination:audit-ecs"}}' ;;
    *) printf '%s' '{}' ;;
  esac
}
`;

for (const id of ['service-ecs', 'service-logs', 'logging-setup']) {
  test(`${id}: native CLI preserves encryption and logging wiring`, () => {
    const recipe = recipes.find(r => r.id === id);
    const result = spawnSync('bash', ['-c', mockAws + '\n' + recipe.cliCommand], {
      timeout: 15000,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        NAME: 'audit',
        TAG_KEY: 'Project',
        TAG_VALUE: 'audit',
        ECR_REPOSITORY: 'audit',
        AWS_REGION: 'eu-west-1',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = result.stderr
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    const logs = calls.filter(c => c.operation === 'create-log-group');
    assert.ok(logs.length);
    for (const call of logs)
      assert.equal(call.payload.kmsKeyId, 'arn:aws:kms:eu-west-1:123456789012:key/test-key');
    const keyIndex = calls.findIndex(c => c.operation === 'create-key');
    assert.ok(keyIndex < calls.findIndex(c => c.operation === 'create-log-group'));
    const key = JSON.parse(calls[keyIndex].payload.Policy);
    const contexts = key.Statement[1].Condition.ArnLike['kms:EncryptionContext:aws:logs:arn'];
    for (const log of logs)
      assert.ok(
        contexts.includes(
          `arn:aws:logs:eu-west-1:123456789012:log-group:${log.payload.logGroupName}`,
        ),
      );
    assert.ok(calls.some(c => c.operation === 'enable-key-rotation'));
    if (id === 'service-ecs') {
      const clusterConfig = calls.find(c => c.operation === 'create-cluster').payload.configuration;
      assert.equal(
        clusterConfig.executeCommandConfiguration.kmsKeyId,
        'arn:aws:kms:eu-west-1:123456789012:key/test-key',
      );
      assert.deepEqual(clusterConfig.managedStorageConfiguration, {
        kmsKeyId: 'arn:aws:kms:eu-west-1:123456789012:key/test-key',
        fargateEphemeralStorageKmsKeyId: 'arn:aws:kms:eu-west-1:123456789012:key/test-key',
      });
      assert.equal(
        calls.find(c => c.operation === 'put-delivery-source').payload.logType,
        'EcsActionLogs',
      );
      assert.equal(
        calls.find(c => c.operation === 'create-delivery').payload.deliverySourceName,
        'audit-ecs',
      );
      assert.equal(
        calls.find(c => c.operation === 'create-delivery').payload.deliveryDestinationArn,
        'arn:aws:logs:eu-west-1:123456789012:delivery-destination:audit-ecs',
      );
      assert.equal(
        calls.find(c => c.operation === 'create-cluster').payload.configuration
          .executeCommandConfiguration.logConfiguration.cloudWatchEncryptionEnabled,
        true,
      );
    }
  });
}

test('all native and direct commands have valid Bash syntax', () => {
  for (const recipe of recipes.filter(r => r.cliCommand || r.command)) {
    const result = spawnSync('bash', ['-n', '-c', recipe.cliCommand || recipe.command], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, `${recipe.id}: ${result.stderr}`);
  }
});

function runAccountSetup(state = {}) {
  const command = recipes.find(r => r.id === 'ecs-account-setup').command;
  return spawnSync(
    'bash',
    [
      '-c',
      `
    aws() {
      case "$1 $2" in
        'guardduty list-detectors') printf '%s\\n' "$TEST_DETECTOR_ID" ;;
        'guardduty get-detector') printf '%s\\n' "$TEST_DETECTOR" ;;
        'guardduty update-detector')
          while [ "$1" != '--features' ]; do shift; done
          printf '%s\\n' "$2" >&2 ;;
        'ecs put-account-setting-default')
          printf '%s\\n' "$*" >&2
          [ "$TEST_FAIL_ECS" != true ] ;;
        'ecs list-account-settings') : ;;
        *) return 99 ;;
      esac
    }
    ${command}
  `,
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        REGION: 'eu-west-1',
        TEST_DETECTOR_ID: 'detector123',
        TEST_FAIL_ECS: 'false',
        TEST_DETECTOR: JSON.stringify({
          Status: 'ENABLED',
          Features: [
            {
              Name: 'RUNTIME_MONITORING',
              Status: 'DISABLED',
              AdditionalConfiguration: [
                { Name: 'EC2_AGENT_MANAGEMENT', Status: 'ENABLED', UpdatedAt: 'ignored' },
                { Name: 'EKS_ADDON_MANAGEMENT', Status: 'DISABLED' },
                { Name: 'ECS_FARGATE_AGENT_MANAGEMENT', Status: 'DISABLED' },
              ],
            },
          ],
        }),
        ...state,
      },
    },
  );
}

test('ECS account defaults enable enhanced Insights, trunking and Fargate monitoring', () => {
  const result = runAccountSetup();
  assert.equal(result.status, 0, result.stderr);
  const [feature] = JSON.parse(result.stderr.split('\n')[0]);
  assert.deepEqual(feature, {
    Name: 'RUNTIME_MONITORING',
    Status: 'ENABLED',
    AdditionalConfiguration: [
      { Name: 'EC2_AGENT_MANAGEMENT', Status: 'ENABLED' },
      { Name: 'EKS_ADDON_MANAGEMENT', Status: 'DISABLED' },
      { Name: 'ECS_FARGATE_AGENT_MANAGEMENT', Status: 'ENABLED' },
    ],
  });
  assert.match(
    result.stderr,
    /put-account-setting-default --region eu-west-1 --name containerInsights --value enhanced/,
  );
  assert.match(
    result.stderr,
    /put-account-setting-default --region eu-west-1 --name awsvpcTrunking --value enabled/,
  );
  assert.doesNotMatch(result.stderr, /guardDutyActivate|tagResourceAuthorization/);
});

test('ECS account preflight rejects missing/disabled GuardDuty and legacy EKS without writes', () => {
  for (const state of [
    { TEST_DETECTOR_ID: 'None' },
    { TEST_DETECTOR: '{"Status":"DISABLED"}' },
    {
      TEST_DETECTOR:
        '{"Status":"ENABLED","Features":[{"Name":"EKS_RUNTIME_MONITORING","Status":"ENABLED"}]}',
    },
  ]) {
    const result = runAccountSetup(state);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /put-account-setting-default|"Name":"RUNTIME_MONITORING"/);
  }
});

test('ECS account setup supports a detector with no runtime settings and stops on AWS failure', () => {
  const fresh = runAccountSetup({ TEST_DETECTOR: '{"Status":"ENABLED"}' });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stderr.split('\n')[0])[0].AdditionalConfiguration, [
    { Name: 'ECS_FARGATE_AGENT_MANAGEMENT', Status: 'ENABLED' },
  ]);
  const failed = runAccountSetup({ TEST_FAIL_ECS: 'true' });
  assert.notEqual(failed.status, 0);
  assert.doesNotMatch(failed.stderr, /--name awsvpcTrunking/);
});

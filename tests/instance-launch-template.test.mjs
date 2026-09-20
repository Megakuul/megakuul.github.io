import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parse } from 'yaml';

const recipe = parse(
  readFileSync(
    new URL('../src/lib/server/powertools/definitions/setup.yaml', import.meta.url),
    'utf8',
  ),
)[0].recipes.find(r => r.id === 'instance-launch-template');
const source = {
  ImageId: 'ami-old',
  InstanceType: 't4g.micro',
  EbsOptimized: true,
  IamInstanceProfile: { Arn: 'arn:aws:iam::123456789012:instance-profile/app' },
  UserData: 'ZWNobyBvbGQ=',
  Monitoring: { Enabled: false },
  MetadataOptions: { HttpTokens: 'optional', HttpPutResponseHopLimit: 2 },
  Placement: { AvailabilityZone: 'eu-west-1a', Tenancy: 'default' },
  BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { SnapshotId: 'snap-old' } }],
  SecurityGroupIds: ['sg-old'],
  KeyName: 'old-key',
  NetworkInterfaces: [
    {
      NetworkInterfaceId: 'eni-old',
      SubnetId: 'subnet-old',
      Groups: ['sg-old'],
      PrivateIpAddress: '10.0.0.4',
    },
  ],
};

function run(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'instance-template-test-'));
  try {
    writeFileSync(join(dir, 'source.json'), JSON.stringify(source));
    writeFileSync(
      join(dir, 'aws'),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_DIR + '/calls.jsonl', JSON.stringify(args) + '\\n');
if (args[1] === process.env.FAIL_OPERATION) process.exit(17);
const emit = data => process.stdout.write(JSON.stringify(data));
switch (args[1]) {
  case 'describe-instances': emit({Reservations:[{Instances:[{RootDeviceType:process.env.ROOT_TYPE || 'ebs',State:{Name:'running'}}]}]}); break;
  case 'get-launch-template-data': process.stdout.write(fs.readFileSync(process.env.MOCK_DIR + '/source.json')); break;
  case 'create-image': process.stdout.write('ami-new\\n'); break;
  case 'wait': break;
  case 'create-launch-template':
    fs.copyFileSync(args[args.indexOf('--launch-template-data') + 1].slice(7), process.env.MOCK_DIR + '/result.json');
    emit({LaunchTemplateId:'lt-new',Version:1}); break;
  default: process.exit(99);
}
`,
      { mode: 0o755 },
    );
    const result = spawnSync('bash', ['-c', recipe.command], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        MOCK_DIR: dir,
        INSTANCE_ID: 'i-source',
        NAME: 'app-v1',
        TAG_KEY: 'Project',
        TAG_VALUE: 'a value with "quotes"',
        NO_REBOOT: 'false',
        COPY_USER_DATA: 'false',
        ...overrides,
      },
    });
    let calls = [],
      data;
    try {
      calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    } catch {}
    try {
      data = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
    } catch {}
    return { ...result, calls, data };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('capture uses the new AMI and preserves architecture/profile without old network or disks', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    r.calls.map(c => c[1]),
    [
      'describe-instances',
      'get-launch-template-data',
      'create-image',
      'wait',
      'create-launch-template',
    ],
  );
  assert.equal(r.data.ImageId, 'ami-new');
  assert.equal(r.data.InstanceType, 't4g.micro');
  assert.deepEqual(r.data.IamInstanceProfile, source.IamInstanceProfile);
  for (const key of ['Placement', 'BlockDeviceMappings', 'SecurityGroupIds', 'KeyName', 'UserData'])
    assert.equal(r.data[key], undefined);
  assert.deepEqual(r.data.NetworkInterfaces, [
    { DeviceIndex: 0, AssociatePublicIpAddress: false, DeleteOnTermination: true },
  ]);
  assert.equal(r.data.MetadataOptions.HttpTokens, 'required');
  assert.equal(r.data.MetadataOptions.HttpPutResponseHopLimit, 2);
  assert.equal(r.data.Monitoring.Enabled, true);
  const image = r.calls[2];
  assert.ok(image.includes('--reboot'));
  assert.deepEqual(
    JSON.parse(image[image.indexOf('--tag-specifications') + 1]).map(t => t.ResourceType),
    ['image', 'snapshot'],
  );
  assert.equal(r.data.TagSpecifications[0].Tags[0].Value, 'a value with "quotes"');
});

test('no-reboot and original user data are explicit options', () => {
  const r = run({ NO_REBOOT: 'true', COPY_USER_DATA: 'true' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls[2].includes('--no-reboot'));
  assert.equal(r.data.UserData, source.UserData);
});

test('invalid flags fail before AWS calls; unsupported root fails before image creation', () => {
  for (const input of [{ NO_REBOOT: 'typo' }, { COPY_USER_DATA: 'typo' }]) {
    const r = run(input);
    assert.notEqual(r.status, 0);
    assert.equal(r.calls.length, 0);
  }
  const r = run({ ROOT_TYPE: 'instance-store' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(
    r.calls.map(c => c[1]),
    ['describe-instances'],
  );
});

test('AWS failures stop the recipe, and waiter failures report the recoverable AMI ID', () => {
  for (const operation of [
    'get-launch-template-data',
    'create-image',
    'wait',
    'create-launch-template',
  ]) {
    const r = run({ FAIL_OPERATION: operation });
    assert.notEqual(r.status, 0);
    assert.equal(r.calls.at(-1)[1], operation);
    if (operation === 'wait') {
      assert.match(r.stdout, /AMI_ID=ami-new/);
      assert.equal(r.data, undefined);
    }
  }
});

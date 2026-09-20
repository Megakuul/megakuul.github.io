// Run after npm run build: inspect the actual downloadable templates.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

function template(name) {
  return parse(
    readFileSync(
      new URL(`../build/worldskills/powertools/templates/${name}.yaml`, import.meta.url),
      'utf8',
    ),
    { logLevel: 'silent' },
  );
}

test('downloaded launch template is independent of any VPC or ASG', () => {
  const t = template('asg');
  const data = t.Resources.LaunchTemplate.Properties.LaunchTemplateData;
  assert.ok(
    !Object.values(t.Resources).some(r =>
      /AWS::EC2::(VPC|Subnet|SecurityGroup|Instance)$|AWS::AutoScaling::|AWS::ElasticLoadBalancingV2::/.test(
        r.Type,
      ),
    ),
  );
  assert.equal(data.SecurityGroupIds, undefined);
  assert.equal(data.NetworkInterfaces[0].Groups, undefined);
  assert.equal(data.NetworkInterfaces[0].SubnetId, undefined);
  assert.equal(data.NetworkInterfaces[0].AssociatePublicIpAddress, false);
  assert.doesNotMatch(data.UserData['Fn::Base64'], /cfn-signal|nginx/);
  assert.ok(t.Resources.AppLogs.Properties.KmsKeyId);
  assert.ok(t.Outputs.LaunchTemplateVersion);
});

test('both compute downloads select a matching AMI and instance type', () => {
  for (const name of ['asg', 'ec2']) {
    const t = template(name);
    const data = t.Resources.LaunchTemplate.Properties.LaunchTemplateData;
    assert.deepEqual(t.Parameters.Architecture.AllowedValues, ['x86_64', 'arm64']);
    assert.deepEqual(data.InstanceType, ['IsArm64', 't4g.micro', 't3.micro']);
    assert.match(data.ImageId, /\$\{Architecture\}/);
    assert.equal(data.BlockDeviceMappings[0].Ebs.Encrypted, true);
    assert.equal(data.MetadataOptions.HttpTokens, 'required');
  }
  const ec2 = template('ec2');
  assert.ok(ec2.Resources.InstanceGroup);
  assert.match(
    ec2.Resources.LaunchTemplate.Properties.LaunchTemplateData.UserData['Fn::Base64'],
    /--resource Instance/,
  );
});

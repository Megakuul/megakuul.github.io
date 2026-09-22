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
  assert.doesNotMatch(
    ec2.Resources.LaunchTemplate.Properties.LaunchTemplateData.UserData['Fn::Base64'],
    /nginx|cfn-signal|Ready<\/body>/,
  );
});

test('EC2 uses the supplied network and only opens the requested SSH CIDR', () => {
  const ec2 = template('ec2');
  const resources = ec2.Resources;
  assert.ok(
    !Object.values(resources).some(r =>
      /^AWS::EC2::(VPC|Subnet|Route|RouteTable|NatGateway|InternetGateway|EIP|VPCEndpoint|FlowLog|VPCGatewayAttachment|SubnetRouteTableAssociation)$/.test(
        r.Type,
      ),
    ),
  );
  assert.equal(ec2.Parameters.VpcId.Type, 'AWS::EC2::VPC::Id');
  assert.equal(ec2.Parameters.SubnetId.Type, 'AWS::EC2::Subnet::Id');
  assert.equal(resources.InstanceGroup.Properties.VpcId, 'VpcId');
  assert.deepEqual(resources.InstanceGroup.Properties.SecurityGroupIngress, [
    { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIp: 'SshCidr' },
  ]);
  const data = resources.LaunchTemplate.Properties.LaunchTemplateData;
  assert.equal(resources.SshKey.Type, 'AWS::EC2::KeyPair');
  assert.equal(resources.SshKey.Properties.PublicKeyMaterial, 'PublicKeyMaterial');
  assert.equal(data.KeyName, 'SshKey');
  assert.equal(data.NetworkInterfaces[0].SubnetId, 'SubnetId');
  assert.deepEqual(data.NetworkInterfaces[0].Groups, ['InstanceGroup']);
  assert.equal(resources.Instance.DependsOn, undefined);
  assert.equal(resources.Instance.CreationPolicy, undefined);
  assert.ok(ec2.Rules.SubnetInVpc);
});

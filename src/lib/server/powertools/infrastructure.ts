import type { CloudFormationTemplate, ToolDefinition } from '$lib/powertools/types';
import { regionalWaf } from './security';

const ref = (Ref: string) => ({ Ref });
const sub = (value: string) => ({ 'Fn::Sub': value });
const att = (id: string, key = 'Arn') => ({ 'Fn::GetAtt': [id, key] });
const tags = [{ Key: ref('TagKey'), Value: ref('TagValue') }];
const namedTags = [{ Key: 'Name', Value: ref('Name') }, ...tags];
const retain = { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' };
const resource = (Type: string, Properties: object, extra: object = {}) => ({
  Type,
  ...extra,
  Properties,
});
const policy = (...Statement: object[]) => ({ Version: '2012-10-17', Statement });
const allow = (Action: string | string[], Resource: any) => ({ Effect: 'Allow', Action, Resource });
const logs = (suffix: string) =>
  resource(
    'AWS::Logs::LogGroup',
    {
      LogGroupName: sub('/powertools/${AWS::StackName}/' + suffix),
      RetentionInDays: 30,
      DeletionProtectionEnabled: true,
      Tags: tags,
    },
    retain,
  );
const bucket = (extra: object = {}) =>
  resource(
    'AWS::S3::Bucket',
    {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      VersioningConfiguration: { Status: 'Enabled' },
      LifecycleConfiguration: {
        Rules: [
          {
            Id: 'Cleanup',
            Status: 'Enabled',
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            NoncurrentVersionExpiration: { NoncurrentDays: 90 },
          },
        ],
      },
      Tags: tags,
      ...extra,
    },
    retain,
  );
const tls = (id: string) => ({
  Effect: 'Deny',
  Principal: '*',
  Action: 's3:*',
  Resource: [att(id), sub('${' + id + '.Arn}/*')],
  Condition: { Bool: { 'aws:SecureTransport': 'false', 'aws:PrincipalIsAWSService': 'false' } },
});
const role = (service: string, statements: object[], extra: object = {}) =>
  resource('AWS::IAM::Role', {
    AssumeRolePolicyDocument: policy({
      Effect: 'Allow',
      Principal: { Service: service },
      Action: 'sts:AssumeRole',
    }),
    Policies: [{ PolicyName: 'ScopedAccess', PolicyDocument: policy(...statements) }],
    Tags: tags,
    ...extra,
  });
function base(
  id: string,
  title: string,
  hint: string,
): ToolDefinition & { template: CloudFormationTemplate } {
  return {
    id: `service-${id}`,
    title,
    templateName: id,
    cli: false,
    env: [
      { name: 'NAME', example: `my-${id}`, required: true, hint },
      { name: 'TAG_KEY', example: 'Project', required: true },
      { name: 'TAG_VALUE', example: 'worldskills', required: true },
    ],
    template: {
      AWSTemplateFormatVersion: '2010-09-09',
      Description: hint,
      Parameters: {
        Name: { Type: 'String', AllowedPattern: '[a-z][a-z0-9-]{0,23}' },
        TagKey: {
          Type: 'String',
          Default: 'Project',
          AllowedPattern: '(?!Name$)(?!aws:).+',
          Description: 'Custom tag key; Name is applied separately.',
        },
        TagValue: { Type: 'String', Default: 'worldskills' },
      },
      Resources: {},
      Outputs: {},
    },
  };
}
function network(t: CloudFormationTemplate) {
  const r = t.Resources;
  r.Vpc = resource('AWS::EC2::VPC', {
    CidrBlock: '10.60.0.0/16',
    EnableDnsSupport: true,
    EnableDnsHostnames: true,
    Tags: namedTags,
  });
  r.Gateway = resource('AWS::EC2::InternetGateway', { Tags: tags });
  r.GatewayAttachment = resource('AWS::EC2::VPCGatewayAttachment', {
    VpcId: ref('Vpc'),
    InternetGatewayId: ref('Gateway'),
  });
  r.PublicSubnet = resource('AWS::EC2::Subnet', {
    VpcId: ref('Vpc'),
    CidrBlock: '10.60.0.0/24',
    AvailabilityZone: { 'Fn::Select': [0, { 'Fn::GetAZs': '' }] },
    MapPublicIpOnLaunch: false,
    Tags: tags,
  });
  r.PublicRoutes = resource('AWS::EC2::RouteTable', { VpcId: ref('Vpc'), Tags: tags });
  r.PublicAssociation = resource('AWS::EC2::SubnetRouteTableAssociation', {
    SubnetId: ref('PublicSubnet'),
    RouteTableId: ref('PublicRoutes'),
  });
  r.InternetRoute = resource(
    'AWS::EC2::Route',
    {
      RouteTableId: ref('PublicRoutes'),
      DestinationCidrBlock: '0.0.0.0/0',
      GatewayId: ref('Gateway'),
    },
    { DependsOn: 'GatewayAttachment' },
  );
  r.NatAddress = resource('AWS::EC2::EIP', { Domain: 'vpc', Tags: tags });
  r.Nat = resource(
    'AWS::EC2::NatGateway',
    { AllocationId: att('NatAddress', 'AllocationId'), SubnetId: ref('PublicSubnet'), Tags: tags },
    { DependsOn: 'InternetRoute' },
  );
  r.PrivateRoutes = resource('AWS::EC2::RouteTable', { VpcId: ref('Vpc'), Tags: tags });
  r.NatRoute = resource('AWS::EC2::Route', {
    RouteTableId: ref('PrivateRoutes'),
    DestinationCidrBlock: '0.0.0.0/0',
    NatGatewayId: ref('Nat'),
  });
  for (const i of [1, 2]) {
    r[`Subnet${i}`] = resource('AWS::EC2::Subnet', {
      VpcId: ref('Vpc'),
      CidrBlock: `10.60.${i + 9}.0/24`,
      AvailabilityZone: { 'Fn::Select': [i - 1, { 'Fn::GetAZs': '' }] },
      MapPublicIpOnLaunch: false,
      Tags: tags,
    });
    r[`Association${i}`] = resource('AWS::EC2::SubnetRouteTableAssociation', {
      SubnetId: ref(`Subnet${i}`),
      RouteTableId: ref('PrivateRoutes'),
    });
  }
  for (const service of ['s3', 'dynamodb'])
    r[`${service}Endpoint`] = resource('AWS::EC2::VPCEndpoint', {
      VpcId: ref('Vpc'),
      VpcEndpointType: 'Gateway',
      ServiceName: sub('com.amazonaws.${AWS::Region}.' + service),
      RouteTableIds: [ref('PrivateRoutes')],
      Tags: tags,
    });
  r.FlowLogs = logs('vpc');
  r.FlowRole = role('vpc-flow-logs.amazonaws.com', [
    allow(
      ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
      att('FlowLogs'),
    ),
    allow('logs:DescribeLogGroups', '*'),
  ]);
  r.FlowRole.Properties!.AssumeRolePolicyDocument.Statement[0].Condition = {
    StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
    ArnLike: {
      'aws:SourceArn': sub(
        'arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:vpc-flow-log/*',
      ),
    },
  };
  r.FlowLog = resource('AWS::EC2::FlowLog', {
    ResourceType: 'VPC',
    ResourceId: ref('Vpc'),
    TrafficType: 'ALL',
    LogDestinationType: 'cloud-watch-logs',
    LogGroupName: ref('FlowLogs'),
    DeliverLogsPermissionArn: att('FlowRole'),
    MaxAggregationInterval: 60,
    Tags: tags,
  });
  t.Outputs!.VpcId = { Value: ref('Vpc') };
}
function compute(asg: boolean) {
  const p = base(
    asg ? 'asg' : 'ec2',
    asg ? 'Launch Template + ASG' : 'EC2',
    asg
      ? 'Private AL2023 instances across two AZs; internal ALB, CPU autoscaling (2–4), SSM and logs. One NAT gateway. Attach the output client security group to authorized VPC clients.'
      : 'Private AL2023 t3.micro; encrypted gp3, IMDSv2, SSM, logs and status alarm. Creates a VPC and one NAT gateway; no inbound access.',
  );
  const t = p.template,
    r = t.Resources;
  network(t);
  r.AppLogs = logs('ec2');
  r.InstanceRole = role(
    'ec2.amazonaws.com',
    [
      allow(
        ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        att('AppLogs'),
      ),
      allow('logs:DescribeLogGroups', '*'),
    ],
    {
      ManagedPolicyArns: [
        sub('arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore'),
      ],
    },
  );
  r.InstanceProfile = resource('AWS::IAM::InstanceProfile', { Roles: [ref('InstanceRole')] });
  r.InstanceGroup = resource('AWS::EC2::SecurityGroup', {
    VpcId: ref('Vpc'),
    GroupDescription: 'Private compute; SSM administration, no SSH',
    SecurityGroupIngress: [],
    SecurityGroupEgress: [80, 443].map(port => ({
      IpProtocol: 'tcp',
      FromPort: port,
      ToPort: port,
      CidrIp: '0.0.0.0/0',
    })),
    Tags: tags,
  });
  const signalResource = asg ? 'AutoScalingGroup' : 'Instance';
  const agent = {
    logs: {
      logs_collected: {
        files: {
          collect_list: [
            {
              file_path: '/var/log/cloud-init-output.log',
              log_group_name: '${AppLogs}',
              log_stream_name: '{instance_id}/system',
            },
            {
              file_path: '/var/log/nginx/access.log',
              log_group_name: '${AppLogs}',
              log_stream_name: '{instance_id}/access',
            },
            {
              file_path: '/var/log/nginx/error.log',
              log_group_name: '${AppLogs}',
              log_stream_name: '{instance_id}/error',
            },
          ],
        },
      },
    },
  };
  r.LaunchTemplate = resource('AWS::EC2::LaunchTemplate', {
    LaunchTemplateName: sub('${AWS::StackName}-launch'),
    TagSpecifications: [{ ResourceType: 'launch-template', Tags: namedTags }],
    LaunchTemplateData: {
      ImageId:
        '{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}',
      InstanceType: 't3.micro',
      IamInstanceProfile: { Arn: att('InstanceProfile') },
      Monitoring: { Enabled: true },
      EbsOptimized: true,
      MetadataOptions: {
        HttpTokens: 'required',
        HttpEndpoint: 'enabled',
        HttpPutResponseHopLimit: 1,
        InstanceMetadataTags: 'disabled',
      },
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/xvda',
          Ebs: { VolumeType: 'gp3', VolumeSize: 12, Encrypted: true, DeleteOnTermination: true },
        },
      ],
      NetworkInterfaces: [
        {
          DeviceIndex: 0,
          AssociatePublicIpAddress: false,
          Groups: [ref('InstanceGroup')],
          DeleteOnTermination: true,
          ...(!asg ? { SubnetId: ref('Subnet1') } : {}),
        },
      ],
      TagSpecifications: ['instance', 'volume', 'network-interface'].map(ResourceType => ({
        ResourceType,
        Tags: namedTags,
      })),
      UserData: {
        'Fn::Base64': sub(`#!/bin/bash
set -euo pipefail
dnf install -y aws-cfn-bootstrap
trap '/opt/aws/bin/cfn-signal -e $? --stack \${AWS::StackName} --resource ${signalResource} --region \${AWS::Region}' EXIT
dnf install -y nginx amazon-cloudwatch-agent
printf '%s\\n' '<!doctype html><html><body>Ready</body></html>' > /usr/share/nginx/html/index.html
cat > /opt/aws/amazon-cloudwatch-agent/etc/powertools.json <<'JSON'
${JSON.stringify(agent)}
JSON
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/powertools.json
systemctl enable --now amazon-ssm-agent nginx
curl -fsS http://127.0.0.1/ >/dev/null
`),
      },
    },
  });
  const launch = {
    LaunchTemplateId: ref('LaunchTemplate'),
    Version: att('LaunchTemplate', 'LatestVersionNumber'),
  };
  if (!asg) {
    r.Instance = resource(
      'AWS::EC2::Instance',
      { LaunchTemplate: launch, DisableApiTermination: true, Tags: namedTags },
      {
        DependsOn: ['NatRoute', 'Association1', 'PublicAssociation'],
        CreationPolicy: { ResourceSignal: { Count: 1, Timeout: 'PT15M' } },
      },
    );
    r.StatusAlarm = resource('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/EC2',
      MetricName: 'StatusCheckFailed',
      Dimensions: [{ Name: 'InstanceId', Value: ref('Instance') }],
      Statistic: 'Maximum',
      Period: 60,
      EvaluationPeriods: 2,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'missing',
      Tags: tags,
    });
    t.Outputs!.InstanceId = { Value: ref('Instance') };
    t.Outputs!.Connect = {
      Value: sub('aws ssm start-session --region ${AWS::Region} --target ${Instance}'),
    };
  } else {
    r.ClientGroup = resource('AWS::EC2::SecurityGroup', {
      VpcId: ref('Vpc'),
      GroupDescription: 'Attach to authorized clients of the internal ALB',
      SecurityGroupIngress: [],
      SecurityGroupEgress: [
        { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, CidrIp: '10.60.0.0/16' },
      ],
      Tags: tags,
    });
    r.AlbGroup = resource('AWS::EC2::SecurityGroup', {
      VpcId: ref('Vpc'),
      GroupDescription: 'Internal ALB accepts authorized client security group only',
      SecurityGroupIngress: [
        { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, SourceSecurityGroupId: ref('ClientGroup') },
      ],
      SecurityGroupEgress: [
        {
          IpProtocol: 'tcp',
          FromPort: 80,
          ToPort: 80,
          DestinationSecurityGroupId: ref('InstanceGroup'),
        },
      ],
      Tags: tags,
    });
    r.ApplicationIngress = resource('AWS::EC2::SecurityGroupIngress', {
      GroupId: ref('InstanceGroup'),
      IpProtocol: 'tcp',
      FromPort: 80,
      ToPort: 80,
      SourceSecurityGroupId: ref('AlbGroup'),
    });
    r.AccessLogs = bucket({
      LifecycleConfiguration: {
        Rules: [
          {
            Id: 'Logs',
            Status: 'Enabled',
            ExpirationInDays: 30,
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    });
    r.AccessLogsPolicy = resource('AWS::S3::BucketPolicy', {
      Bucket: ref('AccessLogs'),
      PolicyDocument: policy(tls('AccessLogs'), {
        Effect: 'Allow',
        Principal: { Service: 'logdelivery.elasticloadbalancing.amazonaws.com' },
        Action: 's3:PutObject',
        Resource: sub('${AccessLogs.Arn}/alb/AWSLogs/${AWS::AccountId}/*'),
      }),
    });
    r.LoadBalancer = resource(
      'AWS::ElasticLoadBalancingV2::LoadBalancer',
      {
        Scheme: 'internal',
        Type: 'application',
        Subnets: [ref('Subnet1'), ref('Subnet2')],
        SecurityGroups: [ref('AlbGroup')],
        Tags: tags,
        LoadBalancerAttributes: [
          { Key: 'deletion_protection.enabled', Value: 'true' },
          { Key: 'access_logs.s3.enabled', Value: 'true' },
          { Key: 'access_logs.s3.bucket', Value: ref('AccessLogs') },
          { Key: 'access_logs.s3.prefix', Value: 'alb' },
          { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' },
        ],
      },
      { DependsOn: 'AccessLogsPolicy' },
    );
    r.TargetGroup = resource('AWS::ElasticLoadBalancingV2::TargetGroup', {
      VpcId: ref('Vpc'),
      Protocol: 'HTTP',
      Port: 80,
      TargetType: 'instance',
      HealthCheckPath: '/',
      Tags: tags,
    });
    r.Listener = resource('AWS::ElasticLoadBalancingV2::Listener', {
      LoadBalancerArn: ref('LoadBalancer'),
      Port: 80,
      Protocol: 'HTTP',
      DefaultActions: [{ Type: 'forward', TargetGroupArn: ref('TargetGroup') }],
    });
    regionalWaf(t, ref('LoadBalancer'));
    r.AutoScalingGroup = resource(
      'AWS::AutoScaling::AutoScalingGroup',
      {
        MinSize: '2',
        MaxSize: '4',
        DesiredCapacity: '2',
        VPCZoneIdentifier: [ref('Subnet1'), ref('Subnet2')],
        LaunchTemplate: launch,
        TargetGroupARNs: [ref('TargetGroup')],
        HealthCheckType: 'ELB',
        HealthCheckGracePeriod: 180,
        DefaultInstanceWarmup: 180,
        MetricsCollection: [{ Granularity: '1Minute' }],
        Tags: namedTags.map(t => ({ ...t, PropagateAtLaunch: true })),
      },
      {
        DependsOn: [
          'NatRoute',
          'Association1',
          'Association2',
          'PublicAssociation',
          'Listener',
          'ApplicationIngress',
        ],
        CreationPolicy: { ResourceSignal: { Count: 2, Timeout: 'PT15M' } },
        UpdatePolicy: {
          AutoScalingRollingUpdate: {
            MinInstancesInService: 2,
            MaxBatchSize: 1,
            PauseTime: 'PT15M',
            WaitOnResourceSignals: true,
          },
        },
      },
    );
    r.CpuScaling = resource('AWS::AutoScaling::ScalingPolicy', {
      AutoScalingGroupName: ref('AutoScalingGroup'),
      PolicyType: 'TargetTrackingScaling',
      TargetTrackingConfiguration: {
        PredefinedMetricSpecification: { PredefinedMetricType: 'ASGAverageCPUUtilization' },
        TargetValue: 60,
        DisableScaleIn: false,
      },
    });
    r.UnhealthyAlarm = resource('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/ApplicationELB',
      MetricName: 'UnHealthyHostCount',
      Dimensions: [
        { Name: 'LoadBalancer', Value: att('LoadBalancer', 'LoadBalancerFullName') },
        { Name: 'TargetGroup', Value: att('TargetGroup', 'TargetGroupFullName') },
      ],
      Statistic: 'Maximum',
      Period: 60,
      EvaluationPeriods: 2,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'missing',
      Tags: tags,
    });
    t.Outputs!.AutoScalingGroup = { Value: ref('AutoScalingGroup') };
    t.Outputs!.ClientSecurityGroup = { Value: ref('ClientGroup') };
    t.Outputs!.ApplicationUrl = { Value: sub('http://${LoadBalancer.DNSName}') };
  }
  t.Outputs!.LaunchTemplateId = { Value: ref('LaunchTemplate') };
  t.Outputs!.Logs = { Value: ref('AppLogs') };
  return p;
}
function cloudfront() {
  const p = base(
    'cloudfront',
    'CloudFront',
    'Deploys in us-east-1: private S3 origin, OAC, HTTPS, WAF, access logs, alarms and lifecycle rules. Upload index.html to the output bucket. Uses the default CloudFront certificate.',
  );
  const t = p.template,
    r = t.Resources;
  r.AccessLogs = bucket({
    OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerPreferred' }] },
    AccessControl: 'LogDeliveryWrite',
    LifecycleConfiguration: {
      Rules: [
        {
          Id: 'Logs',
          Status: 'Enabled',
          ExpirationInDays: 30,
          NoncurrentVersionExpiration: { NoncurrentDays: 30 },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
        },
      ],
    },
  });
  r.Bucket = bucket({
    LoggingConfiguration: { DestinationBucketName: ref('AccessLogs'), LogFilePrefix: 's3/' },
  });
  r.AccessLogsPolicy = resource('AWS::S3::BucketPolicy', {
    Bucket: ref('AccessLogs'),
    PolicyDocument: policy(tls('AccessLogs'), {
      Effect: 'Allow',
      Principal: { Service: 'logging.s3.amazonaws.com' },
      Action: 's3:PutObject',
      Resource: sub('${AccessLogs.Arn}/s3/*'),
      Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') } },
    }),
  });
  r.Bucket.DependsOn = 'AccessLogsPolicy';
  r.OriginAccess = resource('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: {
      Name: sub('${AWS::StackName}-oac'),
      OriginAccessControlOriginType: 's3',
      SigningBehavior: 'always',
      SigningProtocol: 'sigv4',
    },
  });
  r.WebACL = resource('AWS::WAFv2::WebACL', {
    Scope: 'CLOUDFRONT',
    DefaultAction: { Allow: {} },
    VisibilityConfig: {
      CloudWatchMetricsEnabled: true,
      SampledRequestsEnabled: false,
      MetricName: 'CloudFront',
    },
    Tags: tags,
    Rules: [
      ...[
        'AWSManagedRulesAmazonIpReputationList',
        'AWSManagedRulesCommonRuleSet',
        'AWSManagedRulesKnownBadInputsRuleSet',
        'AWSManagedRulesSQLiRuleSet',
      ].map((name, i) => ({
        Name: name,
        Priority: i,
        Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name: name } },
        OverrideAction: { None: {} },
        VisibilityConfig: {
          CloudWatchMetricsEnabled: true,
          SampledRequestsEnabled: false,
          MetricName: name,
        },
      })),
      {
        Name: 'RateLimit',
        Priority: 10,
        Statement: {
          RateBasedStatement: { Limit: 10000, EvaluationWindowSec: 300, AggregateKeyType: 'IP' },
        },
        Action: { Block: {} },
        VisibilityConfig: {
          CloudWatchMetricsEnabled: true,
          SampledRequestsEnabled: false,
          MetricName: 'RateLimit',
        },
      },
    ],
  });
  r.WafLogs = logs('waf');
  r.WafLogs.Properties!.LogGroupName = sub('aws-waf-logs-${AWS::StackName}');
  r.WafLogging = resource('AWS::WAFv2::LoggingConfiguration', {
    ResourceArn: att('WebACL'),
    LogDestinationConfigs: [
      sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WafLogs}'),
    ],
    RedactedFields: [
      { SingleHeader: { Name: 'authorization' } },
      { SingleHeader: { Name: 'cookie' } },
      { QueryString: {} },
    ],
  });
  r.Distribution = resource('AWS::CloudFront::Distribution', {
    Tags: namedTags,
    DistributionConfig: {
      Enabled: true,
      DefaultRootObject: 'index.html',
      HttpVersion: 'http2and3',
      IPV6Enabled: true,
      PriceClass: 'PriceClass_100',
      WebACLId: att('WebACL'),
      Logging: {
        Bucket: att('AccessLogs', 'DomainName'),
        Prefix: 'cloudfront/',
        IncludeCookies: false,
      },
      Origins: [
        {
          Id: 'bucket',
          DomainName: att('Bucket', 'RegionalDomainName'),
          OriginAccessControlId: ref('OriginAccess'),
          S3OriginConfig: { OriginAccessIdentity: '' },
        },
      ],
      DefaultCacheBehavior: {
        TargetOriginId: 'bucket',
        ViewerProtocolPolicy: 'redirect-to-https',
        Compress: true,
        AllowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        CachedMethods: ['GET', 'HEAD'],
        CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
        ResponseHeadersPolicyId: '67f7725c-6f97-4210-82d7-5512b31e9d03',
      },
      ViewerCertificate: { CloudFrontDefaultCertificate: true },
    },
  });
  r.BucketPolicy = resource('AWS::S3::BucketPolicy', {
    Bucket: ref('Bucket'),
    PolicyDocument: policy(tls('Bucket'), {
      Effect: 'Allow',
      Principal: { Service: 'cloudfront.amazonaws.com' },
      Action: 's3:GetObject',
      Resource: sub('${Bucket.Arn}/*'),
      Condition: {
        StringEquals: {
          'AWS:SourceArn': sub(
            'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}',
          ),
        },
      },
    }),
  });
  for (const [metric, threshold] of [
    ['5xxErrorRate', 1],
    ['4xxErrorRate', 10],
  ] as const)
    r[`Errors${metric[0]}`] = resource('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/CloudFront',
      MetricName: metric,
      Dimensions: [
        { Name: 'DistributionId', Value: ref('Distribution') },
        { Name: 'Region', Value: 'Global' },
      ],
      Statistic: 'Average',
      Period: 300,
      EvaluationPeriods: 2,
      Threshold: threshold,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      Tags: tags,
    });
  for (const [id, statements] of [
    [
      'ReadAccess',
      [
        allow('s3:ListBucket', att('Bucket')),
        allow(['s3:GetObject', 's3:GetObjectVersion'], sub('${Bucket.Arn}/*')),
      ],
    ],
    [
      'WriteAccess',
      [
        allow('s3:ListBucket', att('Bucket')),
        allow(
          ['s3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
          sub('${Bucket.Arn}/*'),
        ),
        allow(
          'cloudfront:CreateInvalidation',
          sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}'),
        ),
      ],
    ],
  ] as [string, object[]][]) {
    r[id] = resource('AWS::IAM::ManagedPolicy', { PolicyDocument: policy(...statements) }, retain);
    t.Outputs![id] = { Value: ref(id) };
  }
  t.Outputs!.BucketName = { Value: ref('Bucket') };
  t.Outputs!.DistributionId = { Value: ref('Distribution') };
  t.Outputs!.Url = { Value: sub('https://${Distribution.DomainName}') };
  t.Outputs!.AccessLogBucket = { Value: ref('AccessLogs') };
  return p;
}

function rds() {
  const p = base(
    'rds',
    'RDS PostgreSQL',
    'Private Multi-AZ PostgreSQL; 14-day backups, encryption, deletion protection, logs and monitoring. Master secret rotates automatically. Attach the output client security group to VPC clients; TCP 5432, not the Aurora Data API.',
  );
  const t = p.template,
    r = t.Resources;
  t.Parameters.Name.AllowedPattern = '(?!.*--)[a-z][a-z0-9-]{0,22}[a-z0-9]';
  r.Vpc = resource('AWS::EC2::VPC', {
    CidrBlock: '10.61.0.0/16',
    EnableDnsSupport: true,
    EnableDnsHostnames: true,
    Tags: namedTags,
  });
  for (const i of [0, 1])
    r[`Subnet${i}`] = resource('AWS::EC2::Subnet', {
      VpcId: ref('Vpc'),
      CidrBlock: `10.61.${i}.0/24`,
      AvailabilityZone: { 'Fn::Select': [i, { 'Fn::GetAZs': '' }] },
      MapPublicIpOnLaunch: false,
      Tags: tags,
    });
  r.ClientGroup = resource('AWS::EC2::SecurityGroup', {
    VpcId: ref('Vpc'),
    GroupDescription: 'Attach to authorized database clients',
    SecurityGroupIngress: [],
    SecurityGroupEgress: [
      { IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, CidrIp: '10.61.0.0/16' },
    ],
    Tags: tags,
  });
  r.DatabaseGroup = resource('AWS::EC2::SecurityGroup', {
    VpcId: ref('Vpc'),
    GroupDescription: 'PostgreSQL from authorized clients only',
    SecurityGroupIngress: [
      {
        IpProtocol: 'tcp',
        FromPort: 5432,
        ToPort: 5432,
        SourceSecurityGroupId: ref('ClientGroup'),
      },
    ],
    SecurityGroupEgress: [
      { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '10.61.0.0/16' },
    ],
    Tags: tags,
  });
  r.SubnetGroup = resource('AWS::RDS::DBSubnetGroup', {
    DBSubnetGroupDescription: 'Private database subnets',
    SubnetIds: [ref('Subnet0'), ref('Subnet1')],
    Tags: tags,
  });
  r.Parameters = resource('AWS::RDS::DBParameterGroup', {
    Description: 'TLS and connection logging',
    Family: 'postgres17',
    Parameters: {
      'rds.force_ssl': '1',
      log_connections: '1',
      log_disconnections: '1',
      log_min_duration_statement: '1000',
    },
    Tags: tags,
  });
  r.MonitoringRole = resource('AWS::IAM::Role', {
    AssumeRolePolicyDocument: policy({
      Effect: 'Allow',
      Principal: { Service: 'monitoring.rds.amazonaws.com' },
      Action: 'sts:AssumeRole',
      Condition: {
        StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
        ArnEquals: {
          'aws:SourceArn': sub(
            'arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:db:${AWS::StackName}-db',
          ),
        },
      },
    }),
    ManagedPolicyArns: [
      sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole'),
    ],
    Tags: tags,
  });
  for (const log of ['postgresql', 'upgrade']) {
    r[`Logs${log}`] = logs(log);
    r[`Logs${log}`].Properties!.LogGroupName = sub('/aws/rds/instance/${AWS::StackName}-db/' + log);
  }
  r.Database = resource(
    'AWS::RDS::DBInstance',
    {
      DBInstanceIdentifier: sub('${AWS::StackName}-db'),
      Engine: 'postgres',
      EngineVersion: '17.11',
      EngineLifecycleSupport: 'open-source-rds-extended-support-disabled',
      DBInstanceClass: 'db.t4g.micro',
      DBName: 'worldskills',
      AllocatedStorage: '20',
      MaxAllocatedStorage: 100,
      StorageType: 'gp3',
      StorageEncrypted: true,
      MultiAZ: true,
      PubliclyAccessible: false,
      DBSubnetGroupName: ref('SubnetGroup'),
      VPCSecurityGroups: [ref('DatabaseGroup')],
      DBParameterGroupName: ref('Parameters'),
      MasterUsername: 'dbadmin',
      ManageMasterUserPassword: true,
      EnableIAMDatabaseAuthentication: true,
      BackupRetentionPeriod: 14,
      CopyTagsToSnapshot: true,
      DeletionProtection: true,
      DeleteAutomatedBackups: false,
      AutoMinorVersionUpgrade: true,
      EnableCloudwatchLogsExports: ['postgresql', 'upgrade'],
      MonitoringInterval: 60,
      MonitoringRoleArn: att('MonitoringRole'),
      EnablePerformanceInsights: true,
      DatabaseInsightsMode: 'standard',
      PerformanceInsightsRetentionPeriod: 7,
      Tags: namedTags,
    },
    {
      DependsOn: ['Logspostgresql', 'Logsupgrade'],
      DeletionPolicy: 'Snapshot',
      UpdateReplacePolicy: 'Snapshot',
    },
  );
  r.FlowLogs = logs('vpc');
  r.FlowRole = role('vpc-flow-logs.amazonaws.com', [
    allow(
      ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
      att('FlowLogs'),
    ),
    allow('logs:DescribeLogGroups', '*'),
  ]);
  r.FlowRole.Properties!.AssumeRolePolicyDocument.Statement[0].Condition = {
    StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
    ArnLike: {
      'aws:SourceArn': sub(
        'arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:vpc-flow-log/*',
      ),
    },
  };
  r.FlowLog = resource('AWS::EC2::FlowLog', {
    ResourceType: 'VPC',
    ResourceId: ref('Vpc'),
    TrafficType: 'ALL',
    LogDestinationType: 'cloud-watch-logs',
    LogGroupName: ref('FlowLogs'),
    DeliverLogsPermissionArn: att('FlowRole'),
    MaxAggregationInterval: 60,
    Tags: tags,
  });
  for (const [id, metric, threshold, comparison] of [
    ['CpuAlarm', 'CPUUtilization', 80, 'GreaterThanThreshold'],
    ['StorageAlarm', 'FreeStorageSpace', 5368709120, 'LessThanThreshold'],
  ])
    r[id] = resource('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/RDS',
      MetricName: metric,
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: ref('Database') }],
      Statistic: 'Average',
      Period: 300,
      EvaluationPeriods: 2,
      Threshold: threshold,
      ComparisonOperator: comparison,
      TreatMissingData: 'missing',
      Tags: tags,
    });
  r.SecretReadAccess = resource(
    'AWS::IAM::ManagedPolicy',
    {
      PolicyDocument: policy(
        allow(
          ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
          att('Database', 'MasterUserSecret.SecretArn'),
        ),
      ),
    },
    retain,
  );
  t.Outputs = {
    Endpoint: { Value: att('Database', 'Endpoint.Address') },
    Port: { Value: att('Database', 'Endpoint.Port') },
    MasterSecretArn: { Value: att('Database', 'MasterUserSecret.SecretArn') },
    SecretReadAccessArn: { Value: ref('SecretReadAccess') },
    VpcId: { Value: ref('Vpc') },
    ClientSecurityGroup: { Value: ref('ClientGroup') },
  };
  return p;
}

export const infrastructureTools = [compute(false), compute(true), cloudfront(), rds()];

import { pipelineRecipes, type PipelineTemplate } from './templates';
import type { CloudFormationTemplate } from '$lib/powertools/types';
import { regionalWaf } from '$lib/server/powertools/security';

const ref = (Ref: string) => ({ Ref });
const sub = (value: string) => ({ 'Fn::Sub': value });
const att = (id: string, key = 'Arn') => ({ 'Fn::GetAtt': [id, key] });
const tags = [{ Key: ref('TagKey'), Value: ref('TagValue') }];
const resource = (Type: string, Properties: object, extra: object = {}) => ({
  Type,
  ...extra,
  Properties,
});
const policy = (...Statement: object[]) => ({ Version: '2012-10-17', Statement });
const allow = (Action: string | string[], Resource: any) => ({ Effect: 'Allow', Action, Resource });
const logGroup = (suffix: string) =>
  resource(
    'AWS::Logs::LogGroup',
    {
      LogGroupName: sub('/aws/codepipeline/${AWS::StackName}/' + suffix),
      RetentionInDays: 30,
      DeletionProtectionEnabled: true,
      Tags: tags,
    },
    { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
  );

export type SourceProvider = 'S3' | 'CodeCommit';
export interface PipelinePreset {
  id: string;
  title: string;
  source: Record<string, string>;
  variants: { provider: SourceProvider; file: string; template: CloudFormationTemplate }[];
}

function network(template: CloudFormationTemplate) {
  const r = template.Resources;
  template.Parameters.CloudFrontAzs = {
    Type: 'CommaDelimitedList',
    Description:
      'Two available standard AZs supporting VPC origins; discovered by the deploy command.',
  };
  r.Vpc = resource('AWS::EC2::VPC', {
    CidrBlock: '10.42.0.0/16',
    EnableDnsSupport: true,
    EnableDnsHostnames: true,
    Tags: tags,
  });
  r.Gateway = resource('AWS::EC2::InternetGateway', { Tags: tags });
  r.GatewayAttachment = resource('AWS::EC2::VPCGatewayAttachment', {
    VpcId: ref('Vpc'),
    InternetGatewayId: ref('Gateway'),
  });
  r.PublicRoutes = resource('AWS::EC2::RouteTable', { VpcId: ref('Vpc'), Tags: tags });
  r.InternetRoute = resource(
    'AWS::EC2::Route',
    {
      RouteTableId: ref('PublicRoutes'),
      DestinationCidrBlock: '0.0.0.0/0',
      GatewayId: ref('Gateway'),
    },
    { DependsOn: 'GatewayAttachment' },
  );
  for (const index of [0, 1]) {
    const id = `Subnet${index + 1}`;
    r[id] = resource('AWS::EC2::Subnet', {
      VpcId: ref('Vpc'),
      CidrBlock: `10.42.${index}.0/24`,
      AvailabilityZone: { 'Fn::Select': [index, ref('CloudFrontAzs')] },
      MapPublicIpOnLaunch: false,
      Tags: tags,
    });
    r[`${id}Routes`] = resource('AWS::EC2::SubnetRouteTableAssociation', {
      SubnetId: ref(id),
      RouteTableId: ref('PublicRoutes'),
    });
    const privateId = `PrivateSubnet${index + 1}`;
    r[privateId] = resource('AWS::EC2::Subnet', {
      VpcId: ref('Vpc'),
      CidrBlock: `10.42.${index + 10}.0/24`,
      AvailabilityZone: { 'Fn::Select': [index, ref('CloudFrontAzs')] },
      MapPublicIpOnLaunch: false,
      Tags: tags,
    });
    r[`${privateId}Routes`] = resource('AWS::EC2::SubnetRouteTableAssociation', {
      SubnetId: ref(privateId),
      RouteTableId: ref('PrivateRoutes'),
    });
  }
  r.NatAddress = resource('AWS::EC2::EIP', { Domain: 'vpc', Tags: tags });
  r.Nat = resource(
    'AWS::EC2::NatGateway',
    {
      AllocationId: att('NatAddress', 'AllocationId'),
      SubnetId: ref('Subnet1'),
      Tags: tags,
    },
    { DependsOn: ['InternetRoute', 'Subnet1Routes'] },
  );
  r.PrivateRoutes = resource('AWS::EC2::RouteTable', { VpcId: ref('Vpc'), Tags: tags });
  r.NatRoute = resource('AWS::EC2::Route', {
    RouteTableId: ref('PrivateRoutes'),
    DestinationCidrBlock: '0.0.0.0/0',
    NatGatewayId: ref('Nat'),
  });
  for (const service of ['s3', 'dynamodb'])
    r[`${service}Endpoint`] = resource('AWS::EC2::VPCEndpoint', {
      VpcId: ref('Vpc'),
      VpcEndpointType: 'Gateway',
      ServiceName: sub('com.amazonaws.${AWS::Region}.' + service),
      RouteTableIds: [ref('PrivateRoutes')],
      Tags: tags,
    });
  if (r.TaskGroup) {
    r.EndpointGroup = resource('AWS::EC2::SecurityGroup', {
      VpcId: ref('Vpc'),
      GroupDescription: 'Private ECR HTTPS from application tasks only',
      SecurityGroupIngress: [
        { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, SourceSecurityGroupId: ref('TaskGroup') },
      ],
      SecurityGroupEgress: [
        {
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
          DestinationSecurityGroupId: ref('TaskGroup'),
        },
      ],
      Tags: tags,
    });
    for (const [id, service] of [
      ['EcrApiEndpoint', 'ecr.api'],
      ['EcrDockerEndpoint', 'ecr.dkr'],
    ])
      r[id] = resource('AWS::EC2::VPCEndpoint', {
        VpcId: ref('Vpc'),
        VpcEndpointType: 'Interface',
        ServiceName: sub('com.amazonaws.${AWS::Region}.' + service),
        PrivateDnsEnabled: true,
        SubnetIds: [ref('PrivateSubnet1'), ref('PrivateSubnet2')],
        SecurityGroupIds: [ref('EndpointGroup')],
        PolicyDocument: policy(
          { ...allow('ecr:GetAuthorizationToken', '*'), Principal: '*' },
          {
            ...allow(
              [
                'ecr:BatchGetImage',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchCheckLayerAvailability',
              ],
              att('Images'),
            ),
            Principal: '*',
          },
        ),
        Tags: tags,
      });
  }
  r.FlowLogs = logGroup('vpc');
  r.FlowLogsRole = resource('AWS::IAM::Role', {
    AssumeRolePolicyDocument: policy({
      Effect: 'Allow',
      Principal: { Service: 'vpc-flow-logs.amazonaws.com' },
      Action: 'sts:AssumeRole',
      Condition: {
        StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
        ArnLike: {
          'aws:SourceArn': sub(
            'arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:vpc-flow-log/*',
          ),
        },
      },
    }),
    Policies: [
      {
        PolicyName: 'FlowLogs',
        PolicyDocument: policy(
          allow(
            ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
            att('FlowLogs'),
          ),
          allow('logs:DescribeLogGroups', '*'),
        ),
      },
    ],
    Tags: tags,
  });
  r.FlowLog = resource('AWS::EC2::FlowLog', {
    ResourceId: ref('Vpc'),
    ResourceType: 'VPC',
    TrafficType: 'ALL',
    MaxAggregationInterval: 60,
    LogDestinationType: 'cloud-watch-logs',
    LogGroupName: ref('FlowLogs'),
    DeliverLogsPermissionArn: att('FlowLogsRole'),
    Tags: tags,
  });
  template.Outputs!.VpcId = { Value: ref('Vpc') };
}

/** HTTPS at CloudFront; application origins only receive traffic through private VPC origins. */
function privateWeb(template: CloudFormationTemplate) {
  const r = template.Resources;
  template.Parameters.CloudFrontPrefixList = {
    Type: 'String',
    AllowedPattern: 'pl-[0-9a-f]+',
    Description:
      'Discovered automatically by the deploy command: com.amazonaws.global.cloudfront.origin-facing.',
  };
  const group = r.AlbGroup ?? r.InstanceGroup;
  group.Properties!.GroupDescription =
    'Only CloudFront origin-facing traffic; no public CIDR or SSH ingress';
  group.Properties!.SecurityGroupIngress = [
    {
      IpProtocol: 'tcp',
      FromPort: 80,
      ToPort: 80,
      SourcePrefixListId: ref('CloudFrontPrefixList'),
    },
  ];
  if (r.Instance) {
    r.Instance.Properties!.NetworkInterfaces[0].AssociatePublicIpAddress = false;
    r.Instance.Properties!.NetworkInterfaces[0].SubnetId = ref('PrivateSubnet1');
  } else {
    r.LoadBalancer.Properties!.Scheme = 'internal';
    r.LoadBalancer.Properties!.Subnets = [ref('PrivateSubnet1'), ref('PrivateSubnet2')];
    r.Service.Properties!.NetworkConfiguration.AwsvpcConfiguration = {
      AssignPublicIp: 'DISABLED',
      Subnets: [ref('PrivateSubnet1'), ref('PrivateSubnet2')],
      SecurityGroups: [ref('TaskGroup')],
    };
  }
  r.VpcOrigin = resource(
    'AWS::CloudFront::VpcOrigin',
    {
      VpcOriginEndpointConfig: {
        Name: sub('${AWS::StackName}-origin'),
        Arn: r.Instance
          ? sub('arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${Instance}')
          : ref('LoadBalancer'),
        HTTPPort: 80,
        HTTPSPort: 443,
        OriginProtocolPolicy: 'http-only',
        OriginSSLProtocols: ['TLSv1.2'],
      },
      Tags: tags,
    },
    {
      DependsOn: r.Instance ? ['GatewayAttachment'] : ['Listener', 'GatewayAttachment'],
    },
  );
  r.Distribution = resource('AWS::CloudFront::Distribution', {
    Tags: tags,
    DistributionConfig: {
      Enabled: true,
      HttpVersion: 'http2and3',
      IPV6Enabled: true,
      PriceClass: 'PriceClass_100',
      Origins: [
        {
          Id: 'application',
          DomainName: r.Instance
            ? att('Instance', 'PrivateDnsName')
            : att('LoadBalancer', 'DNSName'),
          VpcOriginConfig: {
            VpcOriginId: att('VpcOrigin', 'Id'),
            OriginKeepaliveTimeout: 5,
            OriginReadTimeout: 30,
          },
        },
      ],
      DefaultCacheBehavior: {
        TargetOriginId: 'application',
        ViewerProtocolPolicy: 'redirect-to-https',
        Compress: true,
        AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
        CachedMethods: ['GET', 'HEAD'],
        CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
      },
      ViewerCertificate: { CloudFrontDefaultCertificate: true },
    },
  });
  template.Outputs!.ApplicationUrl = { Value: sub('https://${Distribution.DomainName}') };
}

/** Materialize each preset so its downloaded template has no configuration switches. */
function fixed(recipe: PipelineTemplate, provider: SourceProvider): CloudFormationTemplate {
  const original = structuredClone(recipe.template);
  const values: Record<string, any> = Object.fromEntries(
    Object.entries(original.Parameters).map(([key, value]) => [
      key,
      value.Type === 'CommaDelimitedList' ? value.Default?.split(',') : value.Default,
    ]),
  );
  Object.assign(values, {
    SourceProvider: provider,
    RequireApproval: 'true',
    VpcId: ref('Vpc'),
    SubnetId: ref('Subnet1'),
    SubnetIds: [ref('Subnet1'), ref('Subnet2')],
    Runtime: 'nodejs24.x',
    AmiId: '{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}',
    WorkloadStackName: sub('${AWS::StackName}-app'),
    WorkloadResources: [
      sub('arn:${AWS::Partition}:s3:::${AWS::StackName}-app-${AWS::AccountId}-${AWS::Region}'),
    ],
  });
  delete values.TagKey;
  delete values.TagValue;
  const conditions: Record<string, boolean> = {
    IsS3: provider === 'S3',
    IsCodeCommit: provider === 'CodeCommit',
    Approval: true,
  };
  function resolve(value: any): any {
    if (Array.isArray(value)) return value.map(resolve).filter(v => v !== undefined);
    if (!value || typeof value !== 'object') return value;
    if (value.Ref === 'AWS::NoValue') return undefined;
    if (value.Ref && Object.hasOwn(values, value.Ref)) return structuredClone(values[value.Ref]);
    if (value['Fn::If']) {
      const [condition, yes, no] = value['Fn::If'];
      return resolve(conditions[condition] ? yes : no);
    }
    if (
      value.Condition &&
      Object.hasOwn(conditions, value.Condition) &&
      !conditions[value.Condition]
    )
      return undefined;
    if (typeof value['Fn::Sub'] === 'string') {
      const text = value['Fn::Sub'];
      const bindings = Object.fromEntries(
        Object.entries(values).filter(([key]) => text.includes('${' + key + '}')),
      );
      return { 'Fn::Sub': Object.keys(bindings).length ? [text, structuredClone(bindings)] : text };
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'Condition' || !Object.hasOwn(conditions, value.Condition))
        .map(([key, v]) => [key, resolve(v)])
        .filter(([, v]) => v !== undefined),
    );
  }
  delete original.Conditions;
  original.Parameters = {
    TagKey: original.Parameters.TagKey,
    TagValue: original.Parameters.TagValue,
  };
  const template = resolve(original) as CloudFormationTemplate;
  template.Description = `${recipe.title} · ${provider} source · manual approval`;
  const r = template.Resources;
  if (recipe.template.Parameters.VpcId) {
    network(template);
    privateWeb(template);
    const target = r.Instance ?? r.Service;
    const dependencies = target.DependsOn
      ? Array.isArray(target.DependsOn)
        ? target.DependsOn
        : [target.DependsOn]
      : [];
    target.DependsOn = [
      ...dependencies,
      'NatRoute',
      'PrivateSubnet1Routes',
      'PrivateSubnet2Routes',
    ];
  }
  harden(template, recipe.id);
  return template;
}

function harden(template: CloudFormationTemplate, id: string) {
  const r = template.Resources;
  if (r.Distribution && !r.LoadBalancer) {
    template.Parameters.EdgeWebACL = {
      Type: 'String',
      Description:
        'CloudFront WAF ARN; the deploy command creates the global WAF stack automatically.',
      AllowedPattern: 'arn:aws:wafv2:us-east-1:[0-9]{12}:global/webacl/.+',
    };
    r.Distribution.Properties!.DistributionConfig.WebACLId = ref('EdgeWebACL');
  }
  if (r.Images) {
    r.Images.Properties!.LifecyclePolicy = {
      LifecyclePolicyText: JSON.stringify({
        rules: [
          {
            rulePriority: 1,
            description: 'Expire untagged images after 30 days',
            selection: {
              tagStatus: 'untagged',
              countType: 'sinceImagePushed',
              countUnit: 'days',
              countNumber: 30,
            },
            action: { type: 'expire' },
          },
        ],
      }),
    };
    r.Images.Properties!.RepositoryPolicyText = policy({
      Effect: 'Deny',
      Principal: '*',
      Action: 'ecr:*',
      Condition: { Bool: { 'aws:SecureTransport': 'false', 'aws:PrincipalIsAWSService': 'false' } },
    });
  }
  if (r.Service) {
    regionalWaf(template, ref('LoadBalancer'));
    r.ServiceScaling = resource('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 2,
      MaxCapacity: 4,
      ResourceId: sub('service/${Cluster}/${Service.Name}'),
      ScalableDimension: 'ecs:service:DesiredCount',
      ServiceNamespace: 'ecs',
      RoleARN: sub(
        'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/aws-service-role/ecs.application-autoscaling.amazonaws.com/AWSServiceRoleForApplicationAutoScaling_ECSService',
      ),
    });
    r.ServiceCpuScaling = resource('AWS::ApplicationAutoScaling::ScalingPolicy', {
      PolicyName: sub('${AWS::StackName}-cpu'),
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: ref('ServiceScaling'),
      TargetTrackingScalingPolicyConfiguration: {
        TargetValue: 60,
        PredefinedMetricSpecification: { PredefinedMetricType: 'ECSServiceAverageCPUUtilization' },
        ScaleInCooldown: 300,
        ScaleOutCooldown: 60,
      },
    });
  }
  r.ArtifactKey = resource(
    'AWS::KMS::Key',
    {
      EnableKeyRotation: true,
      PendingWindowInDays: 7,
      Tags: tags,
      KeyPolicy: policy({
        Effect: 'Allow',
        Principal: { AWS: sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:root') },
        Action: 'kms:*',
        Resource: '*',
      }),
    },
    { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
  );
  for (const key of ['Artifacts', 'SourceBucket'])
    if (r[key]) {
      r[key].Properties!.BucketEncryption = {
        ServerSideEncryptionConfiguration: [
          {
            BucketKeyEnabled: true,
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'aws:kms',
              KMSMasterKeyID: att('ArtifactKey'),
            },
          },
        ],
      };
    }
  r.Pipeline.Properties!.ArtifactStore.EncryptionKey = { Id: att('ArtifactKey'), Type: 'KMS' };
  for (const key of ['PipelineRole', 'BuildRole', 'DeployRole', 'InstanceRole'])
    if (r[key]) {
      r[key].Properties!.Policies[0].PolicyDocument.Statement.push({
        ...allow(['kms:Decrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'], att('ArtifactKey')),
        Condition: {
          StringEquals: { 'kms:ViaService': sub('s3.${AWS::Region}.${AWS::URLSuffix}') },
        },
      });
    }
  const stages = r.Pipeline.Properties!.Stages;
  // A build-only preset needs its approval before executing arbitrary build commands or publishing an image.
  if (['commands', 'ecr'].includes(id)) stages.splice(1, 0, ...stages.splice(2, 1));
  for (const stage of stages) {
    if (stage.Name === 'Build')
      stage.OnFailure = { Result: 'RETRY', RetryConfiguration: { RetryMode: 'FAILED_ACTIONS' } };
    if (stage.Name === 'Deploy') stage.OnFailure = { Result: 'ROLLBACK' };
  }
  r.PipelineLogs = logGroup('events');
  r.PipelineEvents = resource('AWS::Events::Rule', {
    EventPattern: {
      source: ['aws.codepipeline'],
      'detail-type': [
        'CodePipeline Pipeline Execution State Change',
        'CodePipeline Stage Execution State Change',
        'CodePipeline Action Execution State Change',
      ],
      detail: { pipeline: [ref('AWS::StackName')] },
    },
    State: 'ENABLED',
    Targets: [
      {
        Id: 'Logs',
        Arn: sub(
          'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${PipelineLogs}',
        ),
      },
    ],
  });
  r.PipelineLogPolicy = resource('AWS::Logs::ResourcePolicy', {
    PolicyName: sub('${AWS::StackName}-events'),
    PolicyDocument: policy({
      Effect: 'Allow',
      Principal: { Service: ['events.amazonaws.com', 'delivery.logs.amazonaws.com'] },
      Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: att('PipelineLogs'),
    }),
  });
  r.FailureMetric = resource('AWS::Logs::MetricFilter', {
    LogGroupName: ref('PipelineLogs'),
    FilterPattern:
      '{ ($.detail.state = "FAILED") && ($.detail-type = "CodePipeline Pipeline Execution State Change") }',
    MetricTransformations: [
      {
        MetricNamespace: 'WorldSkills/CodePipeline',
        MetricName: sub('${AWS::StackName}-failed'),
        MetricValue: '1',
        DefaultValue: 0,
      },
    ],
  });
  r.FailureAlarm = resource('AWS::CloudWatch::Alarm', {
    Namespace: 'WorldSkills/CodePipeline',
    MetricName: sub('${AWS::StackName}-failed'),
    Statistic: 'Sum',
    Period: 60,
    EvaluationPeriods: 1,
    Threshold: 0,
    ComparisonOperator: 'GreaterThanThreshold',
    TreatMissingData: 'notBreaching',
    Tags: tags,
  });
  r.SourceDlq = resource('AWS::SQS::Queue', {
    SqsManagedSseEnabled: true,
    MessageRetentionPeriod: 1209600,
    Tags: tags,
  });
  r.SourceDlqPolicy = resource('AWS::SQS::QueuePolicy', {
    Queues: [ref('SourceDlq')],
    PolicyDocument: policy(
      {
        Effect: 'Allow',
        Principal: { Service: 'events.amazonaws.com' },
        Action: 'sqs:SendMessage',
        Resource: att('SourceDlq'),
        Condition: { ArnEquals: { 'aws:SourceArn': att('SourceChange') } },
      },
      {
        Effect: 'Deny',
        Principal: '*',
        Action: 'sqs:*',
        Resource: att('SourceDlq'),
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      },
    ),
  });
  r.SourceChange.Properties!.Targets[0].DeadLetterConfig = { Arn: att('SourceDlq') };
  r.SourceChange.Properties!.Targets[0].RetryPolicy = {
    MaximumRetryAttempts: 5,
    MaximumEventAgeInSeconds: 3600,
  };
  r.SourceDlqAlarm = resource('AWS::CloudWatch::Alarm', {
    Namespace: 'AWS/SQS',
    MetricName: 'ApproximateNumberOfMessagesVisible',
    Dimensions: [{ Name: 'QueueName', Value: att('SourceDlq', 'QueueName') }],
    Statistic: 'Maximum',
    Period: 60,
    EvaluationPeriods: 1,
    Threshold: 0,
    ComparisonOperator: 'GreaterThanThreshold',
    TreatMissingData: 'notBreaching',
    Tags: tags,
  });
  if (r.Function) {
    r.Function.Properties!.TracingConfig = { Mode: 'Active' };
    r.Function.Properties!.LoggingConfig = {
      LogFormat: 'JSON',
      ApplicationLogLevel: 'INFO',
      SystemLogLevel: 'WARN',
      LogGroup: ref('FunctionLogs'),
    };
    r.FunctionRole.Properties!.Policies[0].PolicyDocument.Statement.push(
      allow(['xray:PutTraceSegments', 'xray:PutTelemetryRecords'], '*'),
    );
  }
  if (r.Cluster) {
    r.InsightsLogs = resource(
      'AWS::Logs::LogGroup',
      {
        LogGroupName: sub('/aws/ecs/containerinsights/${AWS::StackName}-cluster/performance'),
        RetentionInDays: 30,
        DeletionProtectionEnabled: true,
        Tags: tags,
      },
      { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
    );
    r.Cluster.DependsOn = 'InsightsLogs';
    r.Service.Properties!.DesiredCount = 2;
  }
  if (r.Instance) {
    r.Instance.Properties!.Monitoring = true;
    r.InstanceLogs = logGroup('ec2');
    r.InstanceRole.Properties!.Policies[0].PolicyDocument.Statement.push(
      allow(
        ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        att('InstanceLogs'),
      ),
      allow('logs:DescribeLogGroups', '*'),
    );
    const agent = JSON.stringify({
      logs: {
        logs_collected: {
          files: {
            collect_list: [
              {
                file_path: '/var/log/nginx/access.log',
                log_stream_name: '{instance_id}/nginx-access',
              },
              {
                file_path: '/var/log/nginx/error.log',
                log_stream_name: '{instance_id}/nginx-error',
              },
              {
                file_path: '/var/log/aws/codedeploy-agent/codedeploy-agent.log',
                log_stream_name: '{instance_id}/codedeploy',
              },
            ].map(file => ({ ...file, log_group_name: '${InstanceLogs}' })),
          },
        },
      },
    });
    r.Instance.Properties!.UserData['Fn::Base64']['Fn::Sub'] += [
      'dnf install -y amazon-cloudwatch-agent',
      "cat > /opt/aws/amazon-cloudwatch-agent/etc/pipeline.json <<'AGENT'",
      agent,
      'AGENT',
      '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/pipeline.json -s',
      '',
    ].join('\n');
    r.InstanceAlarm = resource('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/EC2',
      MetricName: 'StatusCheckFailed',
      Dimensions: [{ Name: 'InstanceId', Value: ref('Instance') }],
      Statistic: 'Maximum',
      Period: 60,
      EvaluationPeriods: 2,
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      Tags: tags,
    });
    r.DeploymentGroup.Properties!.AlarmConfiguration = {
      Enabled: true,
      IgnorePollAlarmFailure: false,
      Alarms: [{ Name: ref('InstanceAlarm') }],
    };
    r.DeploymentGroup.Properties!.AutoRollbackConfiguration.Events.push('DEPLOYMENT_STOP_ON_ALARM');
    r.CodeDeployRole.Properties!.Policies[0].PolicyDocument.Statement.push(
      allow('cloudwatch:DescribeAlarms', att('InstanceAlarm', 'Arn')),
    );
  }
  template.Outputs!.PipelineUrl = {
    Value: sub(
      'https://${AWS::Region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${AWS::StackName}/view?region=${AWS::Region}',
    ),
  };
  template.Outputs!.ArtifactKeyArn = { Value: att('ArtifactKey') };
  accessLogs(template);
}

function accessLogs(template: CloudFormationTemplate) {
  const r = template.Resources;
  const buckets = Object.entries(r).filter(([, value]) => value.Type === 'AWS::S3::Bucket');
  r.AccessLogs = resource(
    'AWS::S3::Bucket',
    {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: {
        Rules: [
          { ObjectOwnership: r.Distribution ? 'BucketOwnerPreferred' : 'BucketOwnerEnforced' },
        ],
      },
      ...(r.Distribution ? { AccessControl: 'LogDeliveryWrite' } : {}),
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      VersioningConfiguration: { Status: 'Enabled' },
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
      Tags: tags,
    },
    { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
  );
  r.AccessLogsPolicy = resource('AWS::S3::BucketPolicy', {
    Bucket: ref('AccessLogs'),
    PolicyDocument: policy(
      {
        Effect: 'Allow',
        Principal: { Service: 'logging.s3.amazonaws.com' },
        Action: 's3:PutObject',
        Resource: sub('${AccessLogs.Arn}/s3/*'),
        Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') } },
      },
      ...(r.LoadBalancer
        ? [
            {
              Effect: 'Allow',
              Principal: { Service: 'logdelivery.elasticloadbalancing.amazonaws.com' },
              Action: 's3:PutObject',
              Resource: sub('${AccessLogs.Arn}/alb/AWSLogs/${AWS::AccountId}/*'),
            },
          ]
        : []),
      {
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: [att('AccessLogs'), sub('${AccessLogs.Arn}/*')],
        Condition: {
          Bool: { 'aws:SecureTransport': 'false', 'aws:PrincipalIsAWSService': 'false' },
        },
      },
    ),
  });
  for (const [id, bucket] of buckets) {
    bucket.Properties!.LoggingConfiguration = {
      DestinationBucketName: ref('AccessLogs'),
      LogFilePrefix: `s3/${id}/`,
    };
    bucket.DependsOn = 'AccessLogsPolicy';
  }
  if (r.Distribution) {
    r.Distribution.Properties!.DistributionConfig.Logging = {
      Bucket: att('AccessLogs', 'DomainName'),
      Prefix: 'cloudfront/',
      IncludeCookies: false,
    };
    r.Distribution.Properties!.DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId =
      '67f7725c-6f97-4210-82d7-5512b31e9d03';
  }
  if (r.LoadBalancer) {
    r.LoadBalancer.Properties!.LoadBalancerAttributes = [
      { Key: 'access_logs.s3.enabled', Value: 'true' },
      { Key: 'access_logs.s3.bucket', Value: ref('AccessLogs') },
      { Key: 'access_logs.s3.prefix', Value: 'alb' },
      { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' },
      { Key: 'routing.http.desync_mitigation_mode', Value: 'strictest' },
    ];
    r.LoadBalancer.DependsOn = 'AccessLogsPolicy';
  }
  template.Outputs!.AccessLogBucket = { Value: ref('AccessLogs') };
}

export const pipelines: PipelinePreset[] = pipelineRecipes.map(p => ({
  id: p.id,
  title: (
    {
      commands: 'Build',
      s3: 'S3 + CloudFront',
      ecr: 'ECR',
      ecs: 'ECS',
      'ecs-bluegreen': 'ECS blue/green',
      ec2: 'EC2 + CodeDeploy',
      lambda: 'Lambda',
      'lambda-codedeploy': 'Lambda + CodeDeploy',
      cloudformation: 'CloudFormation',
    } as Record<string, string>
  )[p.id],
  source: p.source,
  variants: (['S3', 'CodeCommit'] as const).map(provider => ({
    provider,
    file: `${p.id}-${provider.toLowerCase()}.yaml`,
    template: fixed(p, provider),
  })),
}));

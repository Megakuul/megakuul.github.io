import { tagTemplate } from './resource-tags.mjs';

/** @typedef {null | boolean | number | string | unknown[] | Record<string, unknown>} JsonValue */
/** @param {string} name */
const ref = name => ({ Ref: name });
/** @param {string} value */
const sub = value => ({ 'Fn::Sub': value });
/** @param {string} name @param {string} [key] */
const attr = (name, key = 'Arn') => ({ 'Fn::GetAtt': [name, key] });
/** @param {JsonValue[]} Statement */
const policy = Statement => ({ Version: '2012-10-17', Statement });
/** @param {JsonValue} document */
const policyString = document =>
  sub(
    JSON.stringify(document, (_key, value) => {
      if (value && typeof value === 'object') {
        if (typeof value['Fn::Sub'] === 'string') return value['Fn::Sub'];
        if (typeof value.Ref === 'string') return '${' + value.Ref + '}';
      }
      return value;
    }),
  );
/** @param {string | string[]} Action @param {JsonValue} Resource @param {JsonValue} [Condition] */
const allow = (Action, Resource, Condition) => ({
  Effect: 'Allow',
  Action,
  Resource,
  ...(Condition ? { Condition } : {}),
});
const regional = { StringEquals: { 'aws:RequestedRegion': ref('AWS::Region') } };
/** @param {string} arn */
const source = arn => ({
  StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
  ArnLike: { 'aws:SourceArn': sub(arn) },
});
/** @param {string} id @param {string} [tail] */
const logArn = (id, tail = '') =>
  sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${' + id + '}' + tail);
/** @param {string} id */
const streams = id => logArn(id, ':log-stream:*');
/** @param {string} MetricName */
const visibility = MetricName => ({
  CloudWatchMetricsEnabled: true,
  SampledRequestsEnabled: false,
  MetricName,
});

export function loggingTemplate() {
  /** @type {Record<string, JsonValue>} */
  const Resources = {};
  /** @type {Record<string, JsonValue>} */
  const Outputs = {};
  /** @param {string} id @param {string} name @param {string} description */
  const group = (id, name, description) => {
    Resources[id] = {
      Type: 'AWS::Logs::LogGroup',
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: {
        LogGroupName: sub(name),
        RetentionInDays: ref('RetentionDays'),
        DeletionProtectionEnabled: true,
        LogGroupClass: 'STANDARD',
      },
    };
    Outputs[id] = { Description: description, Value: logArn(id) };
  };
  for (const [id, name, description] of [
    [
      'ApiGatewayLogs',
      'apigateway',
      'REST / HTTP / WebSocket API: select for stage access logging.',
    ],
    ['VpcFlowLogs', 'vpc-flow', 'VPC flow logs: select this group and VpcFlowLogsRole.'],
    [
      'TransitFlowLogs',
      'transit-flow',
      'Transit Gateway flow logs: select this group and VpcFlowLogsRole.',
    ],
    ['LambdaLogs', 'lambda', 'Lambda: select custom CloudWatch log group in monitoring settings.'],
    ['EcsLogs', 'ecs', 'ECS: awslogs-group in task definition; use EcsExecutionLogsRole.'],
    ['BatchLogs', 'batch', 'Batch: awslogs-group in job definition; use EcsExecutionLogsRole.'],
    ['Ec2Logs', 'ec2', 'EC2 / ASG: CloudWatch agent log_group_name; use Ec2LogsInstanceProfile.'],
    [
      'StepFunctionsLogs',
      'states',
      'Step Functions: enable logging; destination ARN needs a trailing :*.',
    ],
    [
      'CodeBuildLogs',
      'codebuild',
      'CodeBuild: CloudWatch logs group; add project source/artifact permissions to its role.',
    ],
    [
      'CloudTrailLogs',
      'cloudtrail',
      'CloudTrail: enable CloudWatch Logs with CloudTrailLogsRole; trail/S3 storage configured separately.',
    ],
    [
      'ResolverLogs',
      'route53-resolver',
      'Route 53 Resolver: query logging destination; associate with VPCs.',
    ],
    ['LatticeLogs', 'vpc-lattice', 'VPC Lattice: access-log subscription destination.'],
    ['FirewallFlowLogs', 'network-firewall-flow', 'Network Firewall: FLOW logging destination.'],
    ['FirewallAlertLogs', 'network-firewall-alert', 'Network Firewall: ALERT logging destination.'],
    ['AlbAccessLogs', 'alb-access', 'ALB Integrations: access logs delivery destination.'],
    [
      'AlbConnectionLogs',
      'alb-connection',
      'ALB Integrations: connection logs delivery destination.',
    ],
    ['AlbHealthLogs', 'alb-health', 'ALB Integrations: health check logs delivery destination.'],
    ['NlbLogs', 'nlb', 'NLB Integrations: TLS access logs delivery destination.'],
    [
      'CloudFrontLogs',
      'cloudfront',
      'CloudFront standard logging v2: CloudWatch Logs delivery destination.',
    ],
    [
      'OpenSearchApplicationLogs',
      'opensearch-application',
      'OpenSearch domain: ES_APPLICATION_LOGS destination.',
    ],
    [
      'OpenSearchSearchLogs',
      'opensearch-search',
      'OpenSearch domain: SEARCH_SLOW_LOGS destination; configure slow-log thresholds.',
    ],
    [
      'OpenSearchIndexLogs',
      'opensearch-index',
      'OpenSearch domain: INDEX_SLOW_LOGS destination; configure slow-log thresholds.',
    ],
    [
      'OpenSearchAuditLogs',
      'opensearch-audit',
      'OpenSearch domain: AUDIT_LOGS destination; requires fine-grained access control.',
    ],
  ])
    group(id, '/aws/vendedlogs/${AWS::StackName}/' + name, description);
  group(
    'EventBridgeLogs',
    '/aws/events/${AWS::StackName}',
    'EventBridge rule target: CloudWatch Logs; no target RoleArn.',
  );

  /** @param {string} id @param {string} principal @param {JsonValue[]} statements @param {JsonValue} condition @param {string} description */
  const role = (id, principal, statements, condition, description) => {
    Resources[id] = {
      Type: 'AWS::IAM::Role',
      Properties: {
        Description: description,
        Path: '/service-role/',
        AssumeRolePolicyDocument: policy([
          {
            Effect: 'Allow',
            Principal: { Service: principal },
            Action: 'sts:AssumeRole',
            ...(condition ? { Condition: condition } : {}),
          },
        ]),
        Policies: [{ PolicyName: 'Logging', PolicyDocument: policy(statements) }],
      },
    };
    Outputs[id] = { Description: description, Value: attr(id) };
  };
  /** @param {string[]} ids */
  const writes = ids => allow(['logs:CreateLogStream', 'logs:PutLogEvents'], ids.map(streams));
  const discover = allow('logs:DescribeLogGroups', '*', regional);
  role(
    'VpcFlowLogsRole',
    'vpc-flow-logs.amazonaws.com',
    [
      writes(['VpcFlowLogs', 'TransitFlowLogs']),
      allow(
        ['logs:CreateLogGroup', 'logs:DescribeLogStreams'],
        [attr('VpcFlowLogs'), attr('TransitFlowLogs')],
      ),
      discover,
    ],
    source('arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:vpc-flow-log/*'),
    'Delivery role for VPC and Transit Gateway flow logs in this account/region.',
  );
  role(
    'ApiGatewayLogsRole',
    'apigateway.amazonaws.com',
    [
      writes(['ApiGatewayLogs']),
      allow(
        [
          'logs:CreateLogGroup',
          'logs:DescribeLogStreams',
          'logs:GetLogEvents',
          'logs:FilterLogEvents',
        ],
        [attr('ApiGatewayLogs')],
      ),
      allow(
        [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:DescribeLogStreams',
          'logs:PutLogEvents',
          'logs:GetLogEvents',
          'logs:FilterLogEvents',
        ],
        sub(
          'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:API-Gateway-Execution-Logs_*:*',
        ),
      ),
      discover,
    ],
    null,
    'REST / WebSocket: set regional API Gateway account CloudWatch role ARN; enable stage logging separately.',
  );
  role(
    'LambdaLogsRole',
    'lambda.amazonaws.com',
    [writes(['LambdaLogs'])],
    null,
    'Lambda execution role: custom-group logging only; add application/VPC permissions as required.',
  );
  role(
    'EcsExecutionLogsRole',
    'ecs-tasks.amazonaws.com',
    [writes(['EcsLogs', 'BatchLogs'])],
    source('arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'),
    'ECS / Fargate / Batch execution role: logging only; add image-pull and secret permissions as required.',
  );
  role(
    'Ec2LogsRole',
    'ec2.amazonaws.com',
    [
      writes(['Ec2Logs']),
      allow('logs:DescribeLogStreams', attr('Ec2Logs')),
      allow('cloudwatch:PutMetricData', '*', {
        StringEquals: {
          'cloudwatch:namespace': 'CWAgent',
          'aws:RequestedRegion': ref('AWS::Region'),
        },
      }),
    ],
    null,
    'EC2 / ASG instance role: agent logs and CWAgent metrics; configure the agent separately.',
  );
  Resources.Ec2LogsInstanceProfile = {
    Type: 'AWS::IAM::InstanceProfile',
    Properties: { Roles: [ref('Ec2LogsRole')] },
  };
  Outputs.Ec2LogsInstanceProfile = {
    Description: 'EC2 / ASG instance profile for the CloudWatch agent.',
    Value: ref('Ec2LogsInstanceProfile'),
  };
  role(
    'StepFunctionsLogsRole',
    'states.amazonaws.com',
    [
      writes(['StepFunctionsLogs']),
      allow(
        [
          'logs:CreateLogDelivery',
          'logs:GetLogDelivery',
          'logs:UpdateLogDelivery',
          'logs:DeleteLogDelivery',
          'logs:ListLogDeliveries',
          'logs:PutResourcePolicy',
          'logs:DescribeResourcePolicies',
          'logs:DescribeLogGroups',
        ],
        '*',
        regional,
      ),
    ],
    source('arn:${AWS::Partition}:states:${AWS::Region}:${AWS::AccountId}:stateMachine:*'),
    'Step Functions execution role: logging only; add workflow task permissions.',
  );
  role(
    'CodeBuildLogsRole',
    'codebuild.amazonaws.com',
    [writes(['CodeBuildLogs'])],
    source('arn:${AWS::Partition}:codebuild:${AWS::Region}:${AWS::AccountId}:project/*'),
    'CodeBuild service role: logging only; add project source/artifact permissions.',
  );
  role(
    'CloudTrailLogsRole',
    'cloudtrail.amazonaws.com',
    [
      allow(
        ['logs:CreateLogStream', 'logs:PutLogEvents'],
        sub(
          'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${CloudTrailLogs}:log-stream:${AWS::AccountId}_CloudTrail_*',
        ),
      ),
    ],
    source('arn:${AWS::Partition}:cloudtrail:${AWS::Region}:${AWS::AccountId}:trail/*'),
    'CloudTrail CloudWatch delivery role for trails in this account/region.',
  );

  // Vended-log resource policies are created by the service when delivery is enabled.
  // Keep only service-specific policies here, scoped to this stack's destination groups.
  const resourceStatements = [
    {
      ...writes([
        'OpenSearchApplicationLogs',
        'OpenSearchSearchLogs',
        'OpenSearchIndexLogs',
        'OpenSearchAuditLogs',
      ]),
      Principal: { Service: 'es.amazonaws.com' },
      Condition: source('arn:${AWS::Partition}:es:${AWS::Region}:${AWS::AccountId}:domain/*'),
    },
    {
      ...writes(['EventBridgeLogs']),
      Principal: { Service: ['events.amazonaws.com', 'delivery.logs.amazonaws.com'] },
    },
  ];
  Resources.ServiceLogPolicy = {
    Type: 'AWS::Logs::ResourcePolicy',
    Properties: {
      PolicyName: sub('${AWS::StackName}-service-logs'),
      PolicyDocument: policyString(policy(resourceStatements)),
    },
  };
  for (const id of [
    'AlbAccessLogs',
    'AlbConnectionLogs',
    'AlbHealthLogs',
    'NlbLogs',
    'CloudFrontLogs',
  ]) {
    Resources[id + 'Destination'] = {
      Type: 'AWS::Logs::DeliveryDestination',
      Properties: {
        Name: sub('${AWS::StackName}-' + id.toLowerCase()),
        DestinationResourceArn: logArn(id),
        OutputFormat: 'json',
      },
    };
    Outputs[id + 'Destination'] = {
      Description: 'Select this destination when enabling v2 log delivery on the service.',
      Value: attr(id + 'Destination'),
    };
  }
  return tagTemplate({
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Selectable log destinations and logging-only roles. Service logging must be enabled separately.',
    Parameters: {
      RetentionDays: {
        Type: 'Number',
        Default: 30,
        AllowedValues: [
          1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557,
          2922, 3288, 3653,
        ],
      },
    },
    Resources,
    Outputs,
  });
}

export function securityGroupsTemplate() {
  const template = tagTemplate({
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Named VPC security groups: no ingress; IPv4 TCP 80/443 egress only.',
    Parameters: {
      VpcId: { Type: 'AWS::EC2::VPC::Id' },
      GroupNames: {
        Type: 'CommaDelimitedList',
        Default: 'app,worker,database',
        AllowedPattern: '(?![sS][gG]-)[a-zA-Z0-9 ._:/()#@\\[\\]+=&;{}!$*-]{1,255}',
        ConstraintDescription: 'Comma-separated security group names; no sg- prefix.',
      },
    },
    Resources: {
      SecurityGroup: {
        Type: 'AWS::EC2::SecurityGroup',
        Properties: {
          VpcId: ref('VpcId'),
          GroupName: ref('GroupName'),
          GroupDescription: 'No ingress; outbound HTTP and HTTPS only',
          SecurityGroupIngress: [],
          SecurityGroupEgress: [80, 443].map(port => ({
            IpProtocol: 'tcp',
            FromPort: port,
            ToPort: port,
            CidrIp: '0.0.0.0/0',
          })),
        },
      },
    },
  });
  return {
    ...template,
    Transform: 'AWS::LanguageExtensions',
    Resources: {
      'Fn::ForEach::SecurityGroups': [
        'GroupName',
        ref('GroupNames'),
        { 'SecurityGroup&{GroupName}': template.Resources.SecurityGroup },
      ],
    },
    Outputs: {
      VpcId: { Value: ref('VpcId') },
      GroupNames: { Value: { 'Fn::Join': [',', ref('GroupNames')] } },
    },
  };
}

export function wafTemplate() {
  return tagTemplate({
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Regional WAF for direct ALB traffic: high per-IP rate limit, opt-in managed-rule blocking, match logs.',
    Parameters: {
      RateLimit: { Type: 'Number', Default: 100000, MinValue: 10, MaxValue: 2000000000 },
      ManagedRuleMode: { Type: 'String', Default: 'COUNT', AllowedValues: ['COUNT', 'BLOCK'] },
      RetentionDays: { Type: 'Number', Default: 30, AllowedValues: [7, 14, 30, 60, 90, 180, 365] },
    },
    Conditions: { BlockManagedRules: { 'Fn::Equals': [ref('ManagedRuleMode'), 'BLOCK'] } },
    Resources: {
      WebACL: {
        Type: 'AWS::WAFv2::WebACL',
        Properties: {
          Name: ref('AWS::StackName'),
          Scope: 'REGIONAL',
          DefaultAction: { Allow: {} },
          VisibilityConfig: visibility('AllRequests'),
          Rules: [
            ...['AWSManagedRulesSQLiRuleSet', 'AWSManagedRulesKnownBadInputsRuleSet'].map(
              (Name, Priority) => ({
                Name,
                Priority,
                Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name } },
                OverrideAction: { 'Fn::If': ['BlockManagedRules', { None: {} }, { Count: {} }] },
                VisibilityConfig: visibility(Name),
              }),
            ),
            {
              Name: 'HighRatePerIP',
              Priority: 10,
              Action: { Block: {} },
              Statement: {
                RateBasedStatement: {
                  Limit: ref('RateLimit'),
                  EvaluationWindowSec: 300,
                  AggregateKeyType: 'IP',
                },
              },
              VisibilityConfig: visibility('HighRatePerIP'),
            },
          ],
        },
      },
      WafLogs: {
        Type: 'AWS::Logs::LogGroup',
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: {
          LogGroupName: sub('aws-waf-logs-${AWS::StackName}'),
          RetentionInDays: ref('RetentionDays'),
          DeletionProtectionEnabled: true,
        },
      },
      WafLogging: {
        Type: 'AWS::WAFv2::LoggingConfiguration',
        Properties: {
          ResourceArn: attr('WebACL'),
          LogDestinationConfigs: [logArn('WafLogs')],
          RedactedFields: [
            { SingleHeader: { Name: 'authorization' } },
            { SingleHeader: { Name: 'cookie' } },
            { QueryString: {} },
          ],
          LoggingFilter: {
            DefaultBehavior: 'DROP',
            Filters: [
              {
                Behavior: 'KEEP',
                Requirement: 'MEETS_ANY',
                Conditions: [
                  { ActionCondition: { Action: 'BLOCK' } },
                  { ActionCondition: { Action: 'COUNT' } },
                ],
              },
            ],
          },
        },
      },
    },
    Outputs: {
      WebACLArn: {
        Description: 'Select this regional web ACL when associating an ALB in the same region.',
        Value: attr('WebACL'),
      },
      RateLimit: {
        Description:
          'BLOCK above this approximate request count per source IP over 300 seconds; shared NAT/proxy IPs share a limit.',
        Value: ref('RateLimit'),
      },
      ManagedRules: {
        Description: 'SQL injection and known-bad-input checks: COUNT observes; BLOCK enforces.',
        Value: ref('ManagedRuleMode'),
      },
      LogGroup: {
        Description:
          'Blocked/counted requests; authorization, cookies and query strings redacted; sampled requests disabled.',
        Value: ref('WafLogs'),
      },
    },
  });
}

export function dlqTemplate() {
  return tagTemplate({
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Standard DLQ for standard SQS queues and asynchronous Lambda invocations.',
    Parameters: {},
    Resources: {
      DeadLetterQueue: {
        Type: 'AWS::SQS::Queue',
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: {
          QueueName: ref('AWS::StackName'),
          Tags: [{ Key: 'MonitoringRole', Value: 'dlq' }],
          SqsManagedSseEnabled: true,
          MessageRetentionPeriod: 1209600,
          ReceiveMessageWaitTimeSeconds: 20,
          VisibilityTimeout: 60,
          RedriveAllowPolicy: { redrivePermission: 'allowAll' },
        },
      },
      QueueTLS: {
        Type: 'AWS::SQS::QueuePolicy',
        Properties: {
          Queues: [ref('DeadLetterQueue')],
          PolicyDocument: policy([
            {
              Effect: 'Deny',
              Principal: '*',
              Action: 'sqs:*',
              Resource: attr('DeadLetterQueue'),
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            },
          ]),
        },
      },
    },
    Outputs: {
      QueueArn: {
        Description:
          'Select for standard SQS redrive or Lambda asynchronous DLQ / on-failure destination. FIFO sources need a FIFO DLQ.',
        Value: attr('DeadLetterQueue'),
      },
      QueueUrl: {
        Description: 'Receive or redrive failed messages here; retention is 14 days.',
        Value: ref('DeadLetterQueue'),
      },
      LambdaSendPolicyJSON: {
        Description: 'Add to the Lambda role permissions when connecting an asynchronous DLQ.',
        Value: sub(
          '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sqs:SendMessage","Resource":"${DeadLetterQueue.Arn}"}]}',
        ),
      },
      SourceQueueRedrivePolicy: {
        Description:
          'Set on the SOURCE SQS queue. For SQS-triggered Lambda, configure the source queue DLQ, not Lambda async settings.',
        Value: sub('{"deadLetterTargetArn":"${DeadLetterQueue.Arn}","maxReceiveCount":5}'),
      },
    },
  });
}

export function configTemplate() {
  const configSource = source('arn:${AWS::Partition}:config:${AWS::Region}:${AWS::AccountId}:*');
  const objects = sub('${ConfigBucket.Arn}/AWSLogs/${AWS::AccountId}/Config/*');
  return tagTemplate({
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Enable continuous AWS Config recording with a private delivery bucket and AWS Config read role.',
    Parameters: {
      IncludeGlobalIAM: {
        Type: 'String',
        Default: 'true',
        AllowedValues: ['true', 'false'],
        Description:
          'Enable global IAM recording in one supported home region; use false in additional regions.',
      },
    },
    Conditions: { RecordGlobalIAM: { 'Fn::Equals': [ref('IncludeGlobalIAM'), 'true'] } },
    Resources: {
      ConfigBucket: {
        Type: 'AWS::S3::Bucket',
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
            ],
          },
          VersioningConfiguration: { Status: 'Enabled' },
        },
      },
      ConfigBucketPolicy: {
        Type: 'AWS::S3::BucketPolicy',
        Properties: {
          Bucket: ref('ConfigBucket'),
          PolicyDocument: policy([
            {
              Effect: 'Deny',
              Principal: '*',
              Action: 's3:*',
              Resource: [attr('ConfigBucket'), sub('${ConfigBucket.Arn}/*')],
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            },
            {
              ...allow(['s3:GetBucketAcl', 's3:ListBucket'], attr('ConfigBucket'), configSource),
              Principal: { Service: 'config.amazonaws.com' },
            },
            {
              ...allow('s3:PutObject', objects, {
                ...configSource,
                StringEquals: {
                  ...configSource.StringEquals,
                  's3:x-amz-acl': 'bucket-owner-full-control',
                },
              }),
              Principal: { Service: 'config.amazonaws.com' },
            },
          ]),
        },
      },
      ConfigRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          Description: 'AWS Config resource inventory and delivery to this stack bucket.',
          AssumeRolePolicyDocument: policy([
            {
              Effect: 'Allow',
              Principal: { Service: 'config.amazonaws.com' },
              Action: 'sts:AssumeRole',
              Condition: configSource,
            },
          ]),
          ManagedPolicyArns: [
            sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AWS_ConfigRole'),
          ],
          Policies: [
            {
              PolicyName: 'ConfigDelivery',
              PolicyDocument: policy([
                allow(['s3:GetBucketAcl', 's3:ListBucket'], attr('ConfigBucket')),
                allow('s3:PutObject', objects, {
                  StringEquals: { 's3:x-amz-acl': 'bucket-owner-full-control' },
                }),
              ]),
            },
          ],
        },
      },
      ConfigurationRecorder: {
        Type: 'AWS::Config::ConfigurationRecorder',
        Properties: {
          Name: ref('AWS::StackName'),
          RoleARN: attr('ConfigRole'),
          RecordingGroup: {
            AllSupported: true,
            IncludeGlobalResourceTypes: { 'Fn::If': ['RecordGlobalIAM', true, false] },
          },
          RecordingMode: { RecordingFrequency: 'CONTINUOUS' },
        },
      },
      DeliveryChannel: {
        Type: 'AWS::Config::DeliveryChannel',
        DependsOn: ['ConfigurationRecorder', 'ConfigBucketPolicy'],
        Properties: {
          Name: ref('AWS::StackName'),
          S3BucketName: ref('ConfigBucket'),
          ConfigSnapshotDeliveryProperties: { DeliveryFrequency: 'TwentyFour_Hours' },
        },
      },
    },
    Outputs: {
      RecorderName: { Value: ref('ConfigurationRecorder') },
      DeliveryBucket: { Value: ref('ConfigBucket') },
      RecorderRole: { Value: attr('ConfigRole') },
      Recording: {
        Description:
          'All supported resource types in this region; continuous recording. Global IAM is configurable.',
        Value: ref('AWS::Region'),
      },
    },
  });
}

/** @param {string} collectorCode */
export function alarmsTemplate(collectorCode) {
  const notifications = {
    'Fn::If': ['UseExistingTopic', ref('NotificationTopicArn'), ref('Notifications')],
  };
  /** @param {string} name @param {string} unit */
  const metric = (name, unit) => ({
    Namespace: 'Powertools/Health',
    MetricName: name,
    Unit: unit,
    Dimensions: [{ Name: 'Monitor', Value: ref('AWS::StackName') }],
    Statistic: 'Maximum',
    Period: 300,
    EvaluationPeriods: 1,
    DatapointsToAlarm: 1,
    TreatMissingData: 'breaching',
    AlarmActions: [notifications],
    OKActions: [notifications],
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
  });
  return tagTemplate({
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Two regional alarms: any discovered SQS DLQ backlog and worst per-function Lambda error rate. Discovers every five minutes.',
    Parameters: {
      ErrorRatePercent: { Type: 'Number', Default: 1, MinValue: 0.01, MaxValue: 100 },
      MinInvocations: { Type: 'Number', Default: 1, MinValue: 1 },
      NotificationTopicArn: {
        Type: 'String',
        Default: '',
        Description:
          'Optional regional SNS topic permitting CloudWatch alarm notifications. Empty creates a topic; subscribe to it for notifications.',
      },
      RetentionDays: { Type: 'Number', Default: 30, AllowedValues: [7, 14, 30, 60, 90, 180, 365] },
    },
    Conditions: {
      UseExistingTopic: { 'Fn::Not': [{ 'Fn::Equals': [ref('NotificationTopicArn'), ''] }] },
      CreateTopic: { 'Fn::Equals': [ref('NotificationTopicArn'), ''] },
    },
    Resources: {
      CollectorLogs: {
        Type: 'AWS::Logs::LogGroup',
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: {
          LogGroupName: sub('/aws/lambda/${AWS::StackName}-collector'),
          RetentionInDays: ref('RetentionDays'),
          DeletionProtectionEnabled: true,
        },
      },
      CollectorRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: policy([
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ]),
          Policies: [
            {
              PolicyName: 'DiscoverAndMeasure',
              PolicyDocument: policy([
                allow(['logs:CreateLogStream', 'logs:PutLogEvents'], streams('CollectorLogs')),
                allow('cloudwatch:PutMetricData', '*', {
                  StringEquals: {
                    'cloudwatch:namespace': 'Powertools/Health',
                    'aws:RequestedRegion': ref('AWS::Region'),
                  },
                }),
                allow(
                  [
                    'cloudwatch:GetMetricData',
                    'lambda:ListFunctions',
                    'lambda:ListEventSourceMappings',
                    'sqs:ListQueues',
                    'sns:ListSubscriptions',
                    'sns:GetSubscriptionAttributes',
                    'events:ListEventBuses',
                    'events:ListRules',
                    'scheduler:ListSchedules',
                  ],
                  '*',
                  regional,
                ),
                allow(
                  ['sqs:GetQueueAttributes', 'sqs:ListQueueTags'],
                  sub('arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:*'),
                ),
                allow(
                  'lambda:ListFunctionEventInvokeConfigs',
                  sub('arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:*'),
                ),
                allow(
                  'events:DescribeEventBus',
                  sub('arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:event-bus/*'),
                ),
                allow(
                  'events:ListTargetsByRule',
                  sub('arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/*'),
                ),
                allow(
                  'scheduler:GetSchedule',
                  sub(
                    'arn:${AWS::Partition}:scheduler:${AWS::Region}:${AWS::AccountId}:schedule/*',
                  ),
                ),
              ]),
            },
          ],
        },
      },
      Collector: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          FunctionName: sub('${AWS::StackName}-collector'),
          Runtime: 'nodejs24.x',
          Handler: 'index.handler',
          Role: attr('CollectorRole'),
          Timeout: 240,
          MemorySize: 256,
          ReservedConcurrentExecutions: 1,
          Code: { ZipFile: collectorCode },
          Environment: {
            Variables: {
              ACCOUNT_ID: ref('AWS::AccountId'),
              PARTITION: ref('AWS::Partition'),
              MONITOR: ref('AWS::StackName'),
              MIN_INVOCATIONS: ref('MinInvocations'),
            },
          },
        },
      },
      CollectorInvokeConfig: {
        Type: 'AWS::Lambda::EventInvokeConfig',
        Properties: {
          FunctionName: ref('Collector'),
          Qualifier: '$LATEST',
          MaximumRetryAttempts: 0,
          MaximumEventAgeInSeconds: 240,
        },
      },
      Poll: {
        Type: 'AWS::Events::Rule',
        Properties: {
          ScheduleExpression: 'rate(5 minutes)',
          State: 'ENABLED',
          Targets: [
            {
              Id: 'Collector',
              Arn: attr('Collector'),
              RetryPolicy: { MaximumEventAgeInSeconds: 240, MaximumRetryAttempts: 0 },
            },
          ],
        },
      },
      InvokeCollector: {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          Action: 'lambda:InvokeFunction',
          FunctionName: ref('Collector'),
          Principal: 'events.amazonaws.com',
          SourceArn: attr('Poll'),
          SourceAccount: ref('AWS::AccountId'),
        },
      },
      Notifications: { Type: 'AWS::SNS::Topic', Condition: 'CreateTopic' },
      NotificationPolicy: {
        Type: 'AWS::SNS::TopicPolicy',
        Condition: 'CreateTopic',
        Properties: {
          Topics: [ref('Notifications')],
          PolicyDocument: policy([
            {
              ...allow(
                'sns:Publish',
                ref('Notifications'),
                source(
                  'arn:${AWS::Partition}:cloudwatch:${AWS::Region}:${AWS::AccountId}:alarm:${AWS::StackName}-*',
                ),
              ),
              Principal: { Service: 'cloudwatch.amazonaws.com' },
            },
          ]),
        },
      },
      DLQDepthAlarm: {
        Type: 'AWS::CloudWatch::Alarm',
        Properties: {
          ...metric('DLQDepth', 'Count'),
          AlarmName: sub('${AWS::StackName}-all-dlq-depth'),
          Threshold: 1,
          AlarmDescription:
            'Any waiting/in-flight/delayed messages in regional SQS DLQs referenced by SQS, Lambda, SNS or EventBridge (including Scheduler), or tagged MonitoringRole=dlq. Missing collector data also alarms; inspect collector logs.',
        },
      },
      LambdaErrorRateAlarm: {
        Type: 'AWS::CloudWatch::Alarm',
        Properties: {
          ...metric('WorstLambdaErrorRate', 'Percent'),
          AlarmName: sub('${AWS::StackName}-all-lambda-error-rate'),
          Threshold: ref('ErrorRatePercent'),
          AlarmDescription:
            'Highest per-function Errors/Invocations percentage in any five-minute bucket in the last 20 minutes, including new functions. MinInvocations applies per bucket. Missing collector data also alarms. Throttles and application-returned HTTP errors are separate from Lambda Errors.',
        },
      },
    },
    Outputs: {
      DLQAlarm: { Value: ref('DLQDepthAlarm') },
      LambdaAlarm: { Value: ref('LambdaErrorRateAlarm') },
      NotificationTopic: {
        Description:
          'Subscribe to this topic for notifications. First scan within five minutes; missing scan data also triggers alarms.',
        Value: notifications,
      },
      CollectorLogs: {
        Description:
          'Nonempty queues and failing function names; discovery failures never publish healthy zeroes.',
        Value: ref('CollectorLogs'),
      },
      ExtraDLQs: {
        Description:
          'For unattached DLQs or other source services, tag the SQS queue MonitoringRole=dlq. Generated DLQs carry this tag automatically.',
        Value: 'MonitoringRole=dlq',
      },
    },
  });
}

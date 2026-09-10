// @ts-nocheck
import { tagTemplate } from './resource-tags.mjs';
import { ref, sub, att, tags } from './native-commands.mjs';
const policy = (...Statement) => ({ Version: '2012-10-17', Statement });
const tls = (Action, Resource) => ({
  Effect: 'Deny',
  Principal: '*',
  Action,
  Resource,
  Condition: { Bool: { 'aws:SecureTransport': 'false', 'aws:PrincipalIsAWSService': 'false' } },
});
const resource = (Type, Properties, retain = false) => ({
  Type,
  ...(retain ? { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' } : {}),
  Properties,
});
const logs = name =>
  resource(
    'AWS::Logs::LogGroup',
    { LogGroupName: name, RetentionInDays: 30, DeletionProtectionEnabled: true },
    true,
  );
const bucket = (name, retention) =>
  resource(
    'AWS::S3::Bucket',
    {
      BucketName: name,
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      VersioningConfiguration: { Status: 'Enabled' },
      LifecycleConfiguration: {
        Rules: [
          {
            Id: 'AbortIncompleteUploads',
            Status: 'Enabled',
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
          },
          {
            Id: 'OldVersions',
            Prefix: '',
            Status: 'Enabled',
            NoncurrentVersionExpiration: { NoncurrentDays: 90, NewerNoncurrentVersions: 5 },
          },
          ...(retention ? [{ Id: 'ExpireLogs', Status: 'Enabled', ExpirationInDays: 90 }] : []),
        ],
      },
    },
    true,
  );
export function serviceTemplate(id) {
  const t = {
    AWSTemplateFormatVersion: '2010-09-09',
    Parameters: { Name: { Type: 'String', MinLength: 1 } },
    Resources: {},
    Outputs: {},
  };
  const r = t.Resources;
  switch (id) {
    case 'lambda':
      t.Parameters.RoleArn = { Type: 'String' };
      r.Logs = logs(sub('/aws/lambda/${Name}'));
      r.Function = resource('AWS::Lambda::Function', {
        FunctionName: ref('Name'),
        Runtime: 'nodejs24.x',
        Handler: 'index.handler',
        Role: ref('RoleArn'),
        Code: {
          ZipFile:
            'exports.handler=async()=>{throw new Error("Deploy application code before invoking this function.");};',
        },
        MemorySize: 256,
        Timeout: 10,
        Architectures: ['arm64'],
        ReservedConcurrentExecutions: 5,
        LoggingConfig: {
          LogFormat: 'JSON',
          ApplicationLogLevel: 'INFO',
          SystemLogLevel: 'INFO',
          LogGroup: ref('Logs'),
        },
      });
      r.Retries = resource('AWS::Lambda::EventInvokeConfig', {
        FunctionName: ref('Function'),
        Qualifier: '$LATEST',
        MaximumRetryAttempts: 2,
        MaximumEventAgeInSeconds: 3600,
      });
      t.Outputs.FunctionArn = { Value: att('Function') };
      break;
    case 's3':
      r.AccessLogs = bucket(undefined, true);
      r.LogPolicy = resource('AWS::S3::BucketPolicy', {
        Bucket: ref('AccessLogs'),
        PolicyDocument: policy(tls('s3:*', [att('AccessLogs'), sub('${AccessLogs.Arn}/*')]), {
          Effect: 'Allow',
          Principal: { Service: 'logging.s3.amazonaws.com' },
          Action: 's3:PutObject',
          Resource: sub('${AccessLogs.Arn}/access/*'),
          Condition: {
            StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
            ArnLike: { 'aws:SourceArn': sub('arn:${AWS::Partition}:s3:::${Name}') },
          },
        }),
      });
      r.Bucket = bucket(ref('Name'));
      r.Bucket.DependsOn = 'LogPolicy';
      r.Bucket.Properties.LoggingConfiguration = {
        DestinationBucketName: ref('AccessLogs'),
        LogFilePrefix: 'access/',
      };
      r.Policy = resource('AWS::S3::BucketPolicy', {
        Bucket: ref('Bucket'),
        PolicyDocument: policy(tls('s3:*', [att('Bucket'), sub('${Bucket.Arn}/*')]), {
          Effect: 'Deny',
          Principal: '*',
          Action: 's3:PutObject',
          Resource: sub('${Bucket.Arn}/*'),
          Condition: { Null: { 's3:x-amz-server-side-encryption-customer-algorithm': 'false' } },
        }),
      });
      t.Outputs.Bucket = { Value: ref('Bucket') };
      break;
    case 'sqs':
      r.DLQ = resource(
        'AWS::SQS::Queue',
        {
          QueueName: sub('${Name}-dlq'),
          SqsManagedSseEnabled: true,
          MessageRetentionPeriod: 1209600,
          ReceiveMessageWaitTimeSeconds: 20,
          VisibilityTimeout: 180,
          RedriveAllowPolicy: { redrivePermission: 'allowAll' },
          Tags: [{ Key: 'MonitoringRole', Value: 'dlq' }],
        },
        true,
      );
      r.Queue = resource(
        'AWS::SQS::Queue',
        {
          QueueName: ref('Name'),
          SqsManagedSseEnabled: true,
          MessageRetentionPeriod: 345600,
          ReceiveMessageWaitTimeSeconds: 20,
          VisibilityTimeout: 180,
          RedrivePolicy: { deadLetterTargetArn: att('DLQ'), maxReceiveCount: 5 },
        },
        true,
      );
      r.TLS = resource('AWS::SQS::QueuePolicy', {
        Queues: [ref('Queue'), ref('DLQ')],
        PolicyDocument: policy(tls('sqs:*', [att('Queue'), att('DLQ')])),
      });
      t.Outputs.QueueArn = { Value: att('Queue') };
      t.Outputs.DLQArn = { Value: att('DLQ') };
      break;
    case 'sns':
      r.Topic = resource(
        'AWS::SNS::Topic',
        { TopicName: ref('Name'), KmsMasterKeyId: 'alias/aws/sns' },
        true,
      );
      r.TLS = resource('AWS::SNS::TopicPolicy', {
        Topics: [ref('Topic')],
        PolicyDocument: policy(tls('sns:*', ref('Topic'))),
      });
      t.Outputs.TopicArn = { Value: ref('Topic') };
      break;
    case 'eventbridge':
      r.Bus = resource('AWS::Events::EventBus', { Name: ref('Name') }, true);
      t.Outputs.BusArn = { Value: att('Bus') };
      break;
    case 'ecr':
      r.Repository = resource(
        'AWS::ECR::Repository',
        {
          RepositoryName: ref('Name'),
          ImageTagMutability: 'IMMUTABLE',
          ImageScanningConfiguration: { ScanOnPush: true },
          EncryptionConfiguration: { EncryptionType: 'AES256' },
          LifecyclePolicy: {
            LifecyclePolicyText: JSON.stringify({
              rules: [
                {
                  rulePriority: 1,
                  description: 'Expire old untagged images',
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
          },
        },
        true,
      );
      t.Outputs.RepositoryArn = { Value: att('Repository') };
      break;
    case 'ecs':
      r.ExecLogs = logs(sub('/aws/ecs/${Name}/exec'));
      r.Cluster = resource(
        'AWS::ECS::Cluster',
        {
          ClusterName: ref('Name'),
          Configuration: {
            ExecuteCommandConfiguration: {
              Logging: 'OVERRIDE',
              LogConfiguration: { CloudWatchLogGroupName: ref('ExecLogs') },
            },
          },
          ClusterSettings: [{ Name: 'containerInsights', Value: 'enhanced' }],
          CapacityProviders: ['FARGATE', 'FARGATE_SPOT'],
          DefaultCapacityProviderStrategy: [{ CapacityProvider: 'FARGATE', Weight: 1, Base: 1 }],
        },
        true,
      );
      t.Outputs.ClusterArn = { Value: att('Cluster') };
      break;
    case 'logs':
      r.Logs = logs(ref('Name'));
      t.Outputs.LogGroup = { Value: ref('Logs') };
      break;
    case 'secret':
      r.Secret = resource('AWS::SecretsManager::Secret', { Name: ref('Name') }, true);
      t.Outputs.SecretArn = { Value: ref('Secret') };
      break;
    case 'appconfig':
      r.Application = resource('AWS::AppConfig::Application', { Name: ref('Name') });
      r.Environment = resource('AWS::AppConfig::Environment', {
        ApplicationId: ref('Application'),
        Name: 'test',
      });
      r.Profile = resource('AWS::AppConfig::ConfigurationProfile', {
        ApplicationId: ref('Application'),
        Name: 'settings',
        LocationUri: 'hosted',
        Type: 'AWS.Freeform',
        Validators: [{ Type: 'JSON_SCHEMA', Content: '{"type":"object"}' }],
      });
      r.Strategy = resource('AWS::AppConfig::DeploymentStrategy', {
        Name: sub('${Name}-gradual'),
        DeploymentDurationInMinutes: 10,
        FinalBakeTimeInMinutes: 10,
        GrowthFactor: 20,
        GrowthType: 'LINEAR',
        ReplicateTo: 'NONE',
      });
      t.Outputs.ApplicationId = { Value: ref('Application') };
      t.Outputs.EnvironmentId = { Value: ref('Environment') };
      t.Outputs.ProfileId = { Value: ref('Profile') };
      break;
    case 'states':
      t.Parameters.RoleArn = { Type: 'String' };
      r.Logs = logs(sub('/aws/vendedlogs/states/${Name}'));
      r.StateMachine = resource('AWS::StepFunctions::StateMachine', {
        StateMachineName: ref('Name'),
        StateMachineType: 'STANDARD',
        RoleArn: ref('RoleArn'),
        Definition: {
          StartAt: 'ConfigureWorkflow',
          States: {
            ConfigureWorkflow: {
              Type: 'Fail',
              Error: 'NotConfigured',
              Cause: 'Replace with your workflow.',
            },
          },
        },
        LoggingConfiguration: {
          Level: 'ERROR',
          IncludeExecutionData: false,
          Destinations: [{ CloudWatchLogsLogGroup: { LogGroupArn: att('Logs') } }],
        },
      });
      t.Outputs.StateMachineArn = { Value: ref('StateMachine') };
      break;
    case 'athena':
      r.Workgroup = resource('AWS::Athena::WorkGroup', {
        Name: ref('Name'),
        WorkGroupConfiguration: {
          EnforceWorkGroupConfiguration: true,
          ManagedQueryResultsConfiguration: { Enabled: true },
          PublishCloudWatchMetricsEnabled: true,
          BytesScannedCutoffPerQuery: 1073741824,
          RequesterPaysEnabled: false,
        },
      });
      break;
    case 'kinesis':
      r.Stream = resource(
        'AWS::Kinesis::Stream',
        {
          Name: ref('Name'),
          StreamModeDetails: { StreamMode: 'ON_DEMAND' },
          RetentionPeriodHours: 72,
          StreamEncryption: { EncryptionType: 'KMS', KeyId: 'alias/aws/kinesis' },
        },
        true,
      );
      r.TLS = resource('AWS::Kinesis::ResourcePolicy', {
        ResourceArn: att('Stream'),
        ResourcePolicy: policy(tls('kinesis:*', att('Stream'))),
      });
      t.Outputs.StreamArn = { Value: att('Stream') };
      break;
    case 'security':
      r.Detector = resource(
        'AWS::GuardDuty::Detector',
        { Enable: true, FindingPublishingFrequency: 'FIFTEEN_MINUTES' },
        true,
      );
      r.Analyzer = resource(
        'AWS::AccessAnalyzer::Analyzer',
        { AnalyzerName: ref('Name'), Type: 'ACCOUNT' },
        true,
      );
      t.Outputs.DetectorId = { Value: ref('Detector') };
      t.Outputs.AnalyzerArn = { Value: att('Analyzer') };
      break;
    default:
      throw Error(id);
  }
  return tagTemplate(t);
}

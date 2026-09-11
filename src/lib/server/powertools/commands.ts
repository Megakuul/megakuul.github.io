import { lambdaZip } from './lambda-zip';
import type { CloudFormationTemplate } from '$lib/powertools/types';
/** Render CloudFormation submissions and emergency CLI commands from the same template. */
const quote = (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
const expr = (code: string) => ({ __jq: code });
const ref = (name: string) => ({ Ref: name });
const sub = (value: string) => ({ 'Fn::Sub': value });
const att = (name: string, key = 'Arn') => ({ 'Fn::GetAtt': [name, key] });
const tags = [{ Key: ref('TagKey'), Value: ref('TagValue') }];
const region = 'export REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region)}}"';
function shell(steps: string[], inputs: string[] = []) {
  return [
    ': ' + ['TAG_KEY', 'TAG_VALUE', ...inputs].map(k => `"\${${k}:?Set ${k}}"`).join(' '),
    'export AWS_PAGER="" AWS_DEFAULT_OUTPUT=json',
    region,
    ...steps,
  ].join(' && ');
}
function work() {
  return ['d=$(mktemp -d)', `trap ${quote('rm -rf "$d"')} EXIT`];
}
function identity() {
  return [
    'identity=$(aws sts get-caller-identity --output json)',
    'ACCOUNT_ID=$(jq -r .Account <<<"$identity")',
    'PARTITION=$(jq -r \' .Arn | split(":")[1] \' <<<"$identity")',
    'export ACCOUNT_ID PARTITION',
  ];
}
/** Compile CFN intrinsics into jq expressions at page-build time. */
function compiler(template: CloudFormationTemplate) {
  const resources = template.Resources;
  const envParams: Record<string, string> = {
    TagKey: 'TAG_KEY',
    TagValue: 'TAG_VALUE',
    Name: 'NAME',
    RoleName: 'ROLE_NAME',
    RoleArn: 'ROLE_ARN',
    ClusterName: 'CLUSTER_NAME',
    Namespace: 'NAMESPACE',
    ServiceAccount: 'SERVICE_ACCOUNT',
    VpcId: 'VPC_ID',
    GroupNames: 'SG_NAMES',
    GroupName: 'SG_NAME',
    Fifo: 'FIFO',
    DLQName: 'DLQ_NAME',
    AccessLogName: 'ACCESS_LOG_NAME',
  };
  const nameFields: Record<string, string> = {
    'AWS::IAM::Role': 'RoleName',
    'AWS::IAM::ManagedPolicy': 'ManagedPolicyName',
    'AWS::IAM::InstanceProfile': 'InstanceProfileName',
    'AWS::Logs::LogGroup': 'LogGroupName',
    'AWS::SQS::Queue': 'QueueName',
    'AWS::SNS::Topic': 'TopicName',
    'AWS::Lambda::Function': 'FunctionName',
    'AWS::Events::Rule': 'Name',
    'AWS::Events::EventBus': 'Name',
    'AWS::CloudWatch::Alarm': 'AlarmName',
    'AWS::Logs::DeliveryDestination': 'Name',
    'AWS::WAFv2::WebACL': 'Name',
    'AWS::S3::Bucket': 'BucketName',
    'AWS::Config::ConfigurationRecorder': 'Name',
    'AWS::Config::DeliveryChannel': 'Name',
    'AWS::EC2::SecurityGroup': 'GroupName',
    'AWS::ECR::Repository': 'RepositoryName',
    'AWS::ECS::Cluster': 'ClusterName',
    'AWS::SecretsManager::Secret': 'Name',
    'AWS::AppConfig::Application': 'Name',
    'AWS::AppConfig::Environment': 'Name',
    'AWS::AppConfig::ConfigurationProfile': 'Name',
    'AWS::AppConfig::DeploymentStrategy': 'Name',
    'AWS::StepFunctions::StateMachine': 'StateMachineName',
    'AWS::Athena::WorkGroup': 'Name',
    'AWS::Kinesis::Stream': 'Name',
    'AWS::AccessAnalyzer::Analyzer': 'AnalyzerName',
  };
  function name(id: string): string {
    const r = resources[id],
      p = r.Properties ?? {};
    if (p[nameFields[r.Type]]) return c(p[nameFields[r.Type]]);
    if (r.Type === 'AWS::S3::Bucket') return '(env.NAME[0:24]+"-"+env.ACCOUNT_ID+"-"+env.REGION)';
    return '(env.NAME+"-' + id + '")';
  }
  function arn(id: string): string {
    const r = resources[id],
      n = name(id),
      p = r.Properties ?? {};
    if (r.Type === 'AWS::S3::Bucket') return '("arn:"+env.PARTITION+":s3:::"+' + n + ')';
    const iam = (
      {
        'AWS::IAM::Role': 'role',
        'AWS::IAM::ManagedPolicy': 'policy',
        'AWS::IAM::InstanceProfile': 'instance-profile',
      } as Record<string, string>
    )[r.Type];
    if (iam)
      return (
        '("arn:"+env.PARTITION+":iam::"+env.ACCOUNT_ID+":' +
        iam +
        '"+' +
        c(p.Path ?? '/') +
        '+' +
        n +
        ')'
      );
    const kind = (
      {
        'AWS::Logs::LogGroup': ['logs', 'log-group:'],
        'AWS::SQS::Queue': ['sqs', ''],
        'AWS::SNS::Topic': ['sns', ''],
        'AWS::Lambda::Function': ['lambda', 'function:'],
        'AWS::Events::Rule': ['events', 'rule/'],
        'AWS::Events::EventBus': ['events', 'event-bus/'],
        'AWS::CloudWatch::Alarm': ['cloudwatch', 'alarm:'],
        'AWS::ECR::Repository': ['ecr', 'repository/'],
        'AWS::ECS::Cluster': ['ecs', 'cluster/'],
        'AWS::StepFunctions::StateMachine': ['states', 'stateMachine:'],
        'AWS::Kinesis::Stream': ['kinesis', 'stream/'],
        'AWS::AccessAnalyzer::Analyzer': ['access-analyzer', 'analyzer/'],
      } as Record<string, [string, string]>
    )[r.Type];
    if (kind)
      return (
        '("arn:"+env.PARTITION+":' +
        kind[0] +
        ':"+env.REGION+":"+env.ACCOUNT_ID+":' +
        kind[1] +
        '"+' +
        n +
        ')'
      );
    return `env.A_${id}`;
  }
  function reference(key: string): string {
    if (key === 'AWS::NoValue') return 'null';
    if (key === 'AWS::StackName') return 'env.NAME';
    if (key === 'AWS::Region') return 'env.REGION';
    if (key === 'AWS::AccountId') return 'env.ACCOUNT_ID';
    if (key === 'AWS::Partition') return 'env.PARTITION';
    if (key === 'AWS::URLSuffix')
      return '(if env.PARTITION=="aws-cn" then "amazonaws.com.cn" else "amazonaws.com" end)';
    if (envParams[key]) return 'env.' + envParams[key];
    if (template.Parameters?.[key]) return c(template.Parameters[key].Default);
    const r = resources[key];
    if (!r) throw Error('Unknown reference ' + key);
    if (
      [
        'AWS::SNS::Topic',
        'AWS::IAM::ManagedPolicy',
        'AWS::ECS::Cluster',
        'AWS::StepFunctions::StateMachine',
        'AWS::SecretsManager::Secret',
        'AWS::AccessAnalyzer::Analyzer',
      ].includes(r.Type)
    )
      return arn(key);
    if (
      [
        'AWS::SQS::Queue',
        'AWS::EC2::SecurityGroup',
        'AWS::AppConfig::Application',
        'AWS::AppConfig::Environment',
        'AWS::AppConfig::ConfigurationProfile',
        'AWS::AppConfig::DeploymentStrategy',
        'AWS::GuardDuty::Detector',
      ].includes(r.Type)
    )
      return 'env.R_' + key;
    return name(key);
  }
  function c(v: any): string {
    if (v === undefined || v === null) return 'null';
    if (Array.isArray(v)) return '[' + v.map(c).join(',') + ']';
    if (typeof v !== 'object') return JSON.stringify(v);
    if (v.__jq) return v.__jq;
    if (v.Ref) return reference(v.Ref);
    if (v['Fn::GetAtt']) {
      const [id, key] = v['Fn::GetAtt'];
      if (key === 'GroupId' || key === 'Id') return reference(id);
      if (key !== 'Arn') throw Error('Unknown attribute ' + key);
      return '(' + arn(id) + (resources[id].Type === 'AWS::Logs::LogGroup' ? '+":*"' : '') + ')';
    }
    if (v['Fn::Sub']) {
      const str = v['Fn::Sub'];
      const parts = [];
      let start = 0;
      for (const match of str.matchAll(/\$\{([^}]+)\}/g)) {
        parts.push(JSON.stringify(str.slice(start, match.index)));
        const key = match[1];
        parts.push(
          '(' + c(key.includes('.') ? att(key.split('.')[0], key.split('.')[1]) : ref(key)) + ')',
        );
        start = match.index + match[0].length;
      }
      parts.push(JSON.stringify(str.slice(start)));
      return '(' + parts.join('+') + ')';
    }
    if (v['Fn::If']) {
      const [k, a, b] = v['Fn::If'];
      return '(if ' + c(template.Conditions?.[k]) + ' then (' + c(a) + ') else (' + c(b) + ') end)';
    }
    if (v['Fn::Equals'])
      return '(' + v['Fn::Equals'].map((x: any) => '(' + c(x) + ')').join(' == ') + ')';
    if (v['Fn::Not']) return '(' + c(v['Fn::Not'][0]) + ' | not)';
    if (v['Fn::Join']) return '(' + c(v['Fn::Join'][1]) + ' | join(' + c(v['Fn::Join'][0]) + '))';
    const entries = Object.entries(v as Record<string, any>).filter(
      ([, x]) => x !== undefined && x !== null,
    );
    const object = '{' + entries.map(([k, x]) => JSON.stringify(k) + ':' + c(x)).join(',') + '}';
    return entries.some(([, x]) => x?.__jq?.includes('null') || x?.['Fn::If'])
      ? '(' + object + ' | with_entries(select(.value != null)))'
      : object;
  }
  return { c, name, arn, reference };
}
const templateFile = (kind: string) => `${kind}.yaml`;
function stackName(kind: string, inputs: string[]) {
  const key = inputs.includes('NAME') ? 'NAME' : inputs.includes('ROLE_NAME') ? 'ROLE_NAME' : null;
  const prefix = kind === 'logging' ? 'powertools' : `powertools-${kind}`;
  return key ? `${prefix}-\${${key}//[^a-zA-Z0-9-]/-}` : prefix;
}
const cfnTagExceptions: Record<string, string> = {
  'AWS::IAM::ManagedPolicy': 'managed policy',
  'AWS::IAM::InstanceProfile': 'instance profile',
  'AWS::Config::ConfigurationRecorder': 'Config recorder',
};
/** Keep the template as the default and direct API calls as the fallback. */
export function creationCommands(
  resourceTemplate: CloudFormationTemplate,
  kind: string,
  inputs: string[] = ['NAME'],
  cliOverride?: string,
) {
  const cli = cliOverride ?? directCommand(resourceTemplate, kind, inputs);
  const untagged = [
    ...new Set(
      Object.values(resourceTemplate.Resources)
        .map(r => cfnTagExceptions[r.Type])
        .filter(Boolean),
    ),
  ];
  return {
    command: cfnCommand(resourceTemplate, kind, inputs),
    cliCommand: cli,
    resourceTemplate,
    document: resourceTemplate,
    templateFile: templateFile(kind),
    documentTitle: 'CloudFormation YAML',
    cfnTagNote: untagged.length
      ? `CloudFormation cannot tag: ${untagged.join(', ')}. AWS CLI includes those tags.`
      : null,
  };
}
/** A normal CLI invocation: download the matching YAML, then submit the stack. */
function cfnCommand(template: CloudFormationTemplate, kind: string, inputs: string[] = ['NAME']) {
  if (JSON.stringify(template.Resources).includes('Custom::'))
    throw Error('Deployment custom resources are not allowed');
  const envParams: Record<string, string> = {
    TagKey: 'TAG_KEY',
    TagValue: 'TAG_VALUE',
    Name: 'NAME',
    RoleName: 'ROLE_NAME',
    ClusterName: 'CLUSTER_NAME',
    Namespace: 'NAMESPACE',
    ServiceAccount: 'SERVICE_ACCOUNT',
    VpcId: 'VPC_ID',
    GroupNames: 'SG_NAMES',
  };
  const parameterNames = Object.keys(template.Parameters).sort(
    (a, b) => Number(!a.startsWith('Tag')) - Number(!b.startsWith('Tag')),
  );
  const parameters = parameterNames.map(key => {
    const value =
      key === 'RoleArn'
        ? '$(aws iam get-role --role-name "${ROLE_NAME:?Set ROLE_NAME}" --query Role.Arn --output text)'
        : `\${${envParams[key]}:?Set ${envParams[key]}}`;
    if (!envParams[key] && key !== 'RoleArn') throw Error('Unexpected bootstrap parameter: ' + key);
    return `ParameterKey=${key},ParameterValue="${key === 'GroupNames' ? "'" + value + "'" : value}"`;
  });
  const capabilities = [];
  if (Object.values(template.Resources).some(r => r.Type?.startsWith('AWS::IAM::')))
    capabilities.push('CAPABILITY_NAMED_IAM');
  if (template.Transform) capabilities.push('CAPABILITY_AUTO_EXPAND');
  const deploy = [
    `aws cloudformation create-stack --stack-name "${stackName(kind, inputs)}"`,
    `--template-body file://${templateFile(kind)}`,
    parameters.length ? '--parameters ' + parameters.join(' ') : '',
    '--tags "Key=${TAG_KEY:?Set TAG_KEY},Value=${TAG_VALUE:?Set TAG_VALUE}"',
    capabilities.length ? '--capabilities ' + capabilities.join(' ') : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `curl -fsSL https://megakuul.github.io/worldskills/powertools/templates/${templateFile(kind)} -o ${templateFile(kind)} && ${deploy}`;
}
/** Build explicit AWS API calls; jq only serializes request JSON. */
function cliSteps(template: CloudFormationTemplate) {
  const e = compiler(template),
    steps = [];
  const request = (
    service: string,
    operation: string,
    payload: Record<string, any>,
    id = 'response',
  ) => {
    const command = `aws ${service} ${operation} --cli-input-json "$(jq -cn ${quote(e.c(payload))})"`;
    steps.push(id === 'response' ? command : `result=$(${command})`);
  };
  const output = (id: string, field: string, key = 'R') =>
    steps.push(`export ${key}_${id}=$(jq -er ${quote(field)} <<<"$result")`);
  const j = (value: any) => expr('(' + e.c(value) + ' | tojson)');
  const tagmap = (value: any) =>
    expr('(' + e.c(value ?? tags) + ' | map({key:.Key,value:.Value}) | from_entries)');
  for (const [id, r] of Object.entries(template.Resources)) {
    const p = r.Properties ?? {},
      n = expr(e.name(id)),
      a = expr(e.arn(id)),
      t = p.Tags ?? tags;
    switch (r.Type) {
      case 'AWS::Logs::LogGroup':
        request('logs', 'create-log-group', {
          logGroupName: n,
          tags: tagmap(t),
          deletionProtectionEnabled: true,
        });
        request('logs', 'put-retention-policy', { logGroupName: n, retentionInDays: 30 });
        break;
      case 'AWS::Logs::ResourcePolicy':
        request('logs', 'put-resource-policy', {
          policyName: p.PolicyName,
          policyDocument: p.PolicyDocument,
        });
        break;
      case 'AWS::Logs::DeliveryDestination':
        request(
          'logs',
          'put-delivery-destination',
          {
            name: n,
            outputFormat: p.OutputFormat,
            deliveryDestinationConfiguration: { destinationResourceArn: p.DestinationResourceArn },
            tags: tagmap(t),
          },
          id,
        );
        output(id, '.deliveryDestination.arn', 'A');
        break;
      case 'AWS::IAM::Role':
        request('iam', 'create-role', {
          RoleName: n,
          Path: p.Path ?? '/',
          AssumeRolePolicyDocument: j(p.AssumeRolePolicyDocument),
          Tags: t,
          Description: p.Description,
        });
        for (const policy of p.Policies ?? [])
          request('iam', 'put-role-policy', {
            RoleName: n,
            PolicyName: policy.PolicyName,
            PolicyDocument: j(policy.PolicyDocument),
          });
        for (const policy of p.ManagedPolicyArns ?? [])
          request('iam', 'attach-role-policy', { RoleName: n, PolicyArn: policy });
        break;
      case 'AWS::IAM::ManagedPolicy':
        request('iam', 'create-policy', {
          PolicyName: n,
          Path: p.Path ?? '/',
          PolicyDocument: j(p.PolicyDocument),
          Description: p.Description,
          Tags: t,
        });
        for (const role of p.Roles ?? [])
          request('iam', 'attach-role-policy', { RoleName: role, PolicyArn: a });
        break;
      case 'AWS::IAM::InstanceProfile':
        request('iam', 'create-instance-profile', {
          InstanceProfileName: n,
          Path: p.Path ?? '/',
          Tags: t,
        });
        for (const role of p.Roles ?? [])
          request('iam', 'add-role-to-instance-profile', {
            InstanceProfileName: n,
            RoleName: role,
          });
        break;
      case 'AWS::SQS::Queue': {
        const attrs: Record<string, any> = {};
        for (const [k, v] of Object.entries(p))
          if (!['QueueName', 'Tags'].includes(k))
            attrs[k] =
              typeof v === 'string'
                ? v
                : expr('(' + e.c(v) + ' | if type=="string" then . else tojson end)');
        request('sqs', 'create-queue', { QueueName: n, Attributes: attrs, tags: tagmap(t) }, id);
        output(id, '.QueueUrl');
        steps.push('sleep 1');
        break;
      }
      case 'AWS::SQS::QueuePolicy':
        for (const queue of p.Queues)
          request('sqs', 'set-queue-attributes', {
            QueueUrl: queue,
            Attributes: { Policy: j(p.PolicyDocument) },
          });
        break;
      case 'AWS::WAFv2::WebACL':
        request(
          'wafv2',
          'create-web-acl',
          {
            Name: n,
            Scope: p.Scope,
            DefaultAction: p.DefaultAction,
            VisibilityConfig: p.VisibilityConfig,
            Rules: p.Rules,
            Tags: t,
          },
          id,
        );
        output(id, '.Summary.ARN', 'A');
        break;
      case 'AWS::WAFv2::LoggingConfiguration':
        request('wafv2', 'put-logging-configuration', { LoggingConfiguration: p });
        break;
      case 'AWS::S3::Bucket':
        request('s3api', 'create-bucket', {
          Bucket: n,
          ObjectOwnership: 'BucketOwnerEnforced',
          CreateBucketConfiguration: expr(
            `({Tags:${e.c(t)}} + (if env.REGION=="us-east-1" then {} else {LocationConstraint:env.REGION} end))`,
          ),
        });
        request('s3api', 'put-public-access-block', {
          Bucket: n,
          PublicAccessBlockConfiguration: p.PublicAccessBlockConfiguration,
        });
        request('s3api', 'put-bucket-encryption', {
          Bucket: n,
          ServerSideEncryptionConfiguration: {
            Rules: p.BucketEncryption.ServerSideEncryptionConfiguration.map(
              (rule: Record<string, any>) => ({
                ApplyServerSideEncryptionByDefault: rule.ServerSideEncryptionByDefault,
                ...(rule.BucketKeyEnabled ? { BucketKeyEnabled: true } : {}),
              }),
            ),
          },
        });
        if (p.VersioningConfiguration)
          request('s3api', 'put-bucket-versioning', {
            Bucket: n,
            VersioningConfiguration: p.VersioningConfiguration,
          });
        if (p.LifecycleConfiguration)
          request('s3api', 'put-bucket-lifecycle-configuration', {
            Bucket: n,
            LifecycleConfiguration: {
              Rules: p.LifecycleConfiguration.Rules.map((rule: Record<string, any>) => ({
                ID: rule.Id,
                Status: rule.Status,
                Filter: { Prefix: rule.Prefix ?? '' },
                ...(rule.ExpirationInDays ? { Expiration: { Days: rule.ExpirationInDays } } : {}),
                ...(rule.NoncurrentVersionExpiration
                  ? { NoncurrentVersionExpiration: rule.NoncurrentVersionExpiration }
                  : {}),
                ...(rule.AbortIncompleteMultipartUpload
                  ? { AbortIncompleteMultipartUpload: rule.AbortIncompleteMultipartUpload }
                  : {}),
              })),
            },
          });
        if (p.LoggingConfiguration)
          request('s3api', 'put-bucket-logging', {
            Bucket: n,
            BucketLoggingStatus: {
              LoggingEnabled: {
                TargetBucket: p.LoggingConfiguration.DestinationBucketName,
                TargetPrefix: p.LoggingConfiguration.LogFilePrefix,
              },
            },
          });
        break;
      case 'AWS::S3::BucketPolicy':
        request('s3api', 'put-bucket-policy', { Bucket: p.Bucket, Policy: j(p.PolicyDocument) });
        break;
      case 'AWS::Config::ConfigurationRecorder': {
        const group: Record<string, any> = {};
        for (const [k, v] of Object.entries(p.RecordingGroup))
          group[k[0].toLowerCase() + k.slice(1)] = v;
        request('configservice', 'put-configuration-recorder', {
          ConfigurationRecorder: {
            name: n,
            roleARN: p.RoleARN,
            recordingGroup: group,
            recordingMode: { recordingFrequency: p.RecordingMode.RecordingFrequency },
          },
          Tags: t,
        });
        break;
      }
      case 'AWS::Config::DeliveryChannel':
        request('configservice', 'put-delivery-channel', {
          DeliveryChannel: {
            name: n,
            s3BucketName: p.S3BucketName,
            configSnapshotDeliveryProperties: {
              deliveryFrequency: p.ConfigSnapshotDeliveryProperties.DeliveryFrequency,
            },
          },
        });
        steps.push(
          `aws configservice start-configuration-recorder --configuration-recorder-name "$(jq -nr ${quote(e.name(id))})"`,
        );
        break;
      case 'AWS::Lambda::Function': {
        steps.push(`printf %s ${quote(lambdaZip(p.Code.ZipFile))} | base64 -d > "$d/function.zip"`);
        const input: Record<string, any> = { ...p, FunctionName: n, Tags: tagmap(t) };
        delete input.Code;
        if (input.Environment)
          input.Environment = {
            Variables: Object.fromEntries(
              Object.entries(input.Environment.Variables).map(([k, v]) => [
                k,
                expr('(' + e.c(v) + ' | tostring)'),
              ]),
            ),
          };
        steps.push(
          `jq -cn ${quote(e.c(input))} > "$d/request.json"`,
          `aws lambda create-function --cli-input-json "file://$d/request.json" --zip-file "fileb://$d/function.zip"`,
          `aws lambda wait function-active-v2 --function-name "$(jq -nr ${quote(e.name(id))})"`,
        );
        break;
      }
      case 'AWS::Lambda::EventInvokeConfig':
        request('lambda', 'put-function-event-invoke-config', p);
        break;
      case 'AWS::Lambda::Permission':
        request('lambda', 'add-permission', { ...p, StatementId: sub('${Name}-' + id) });
        break;
      case 'AWS::SNS::Topic':
        request('sns', 'create-topic', {
          Name: n,
          Attributes: p.KmsMasterKeyId ? { KmsMasterKeyId: p.KmsMasterKeyId } : undefined,
          Tags: t,
        });
        break;
      case 'AWS::SNS::TopicPolicy':
        for (const topic of p.Topics)
          request('sns', 'set-topic-attributes', {
            TopicArn: topic,
            AttributeName: 'Policy',
            AttributeValue: j(p.PolicyDocument),
          });
        break;
      case 'AWS::Events::Rule':
        request('events', 'put-rule', {
          Name: n,
          ScheduleExpression: p.ScheduleExpression,
          State: p.State,
          Tags: t,
        });
        request('events', 'put-targets', { Rule: n, Targets: p.Targets }, id);
        steps.push(`jq -e '.FailedEntryCount == 0' <<<"$result" >/dev/null`);
        break;
      case 'AWS::CloudWatch::Alarm':
        request('cloudwatch', 'put-metric-alarm', { ...p, AlarmName: n, Tags: t });
        break;
      case 'AWS::Events::EventBus':
        request('events', 'create-event-bus', { Name: n, Tags: t });
        break;
      case 'AWS::ECR::Repository':
        request('ecr', 'create-repository', {
          repositoryName: n,
          imageTagMutability: p.ImageTagMutability,
          imageScanningConfiguration: { scanOnPush: true },
          encryptionConfiguration: { encryptionType: 'AES256' },
          tags: t,
        });
        request('ecr', 'put-lifecycle-policy', {
          repositoryName: n,
          lifecyclePolicyText: p.LifecyclePolicy.LifecyclePolicyText,
        });
        break;
      case 'AWS::EKS::PodIdentityAssociation':
        request('eks', 'create-pod-identity-association', {
          clusterName: p.ClusterName,
          namespace: p.Namespace,
          serviceAccount: p.ServiceAccount,
          roleArn: p.RoleArn,
          tags: tagmap(t),
        });
        break;
      case 'AWS::ECS::Cluster':
        request('ecs', 'create-cluster', {
          clusterName: n,
          configuration: {
            executeCommandConfiguration: {
              logging: 'OVERRIDE',
              logConfiguration: {
                cloudWatchLogGroupName:
                  p.Configuration.ExecuteCommandConfiguration.LogConfiguration
                    .CloudWatchLogGroupName,
              },
            },
          },
          settings: [{ name: 'containerInsights', value: 'enhanced' }],
          capacityProviders: ['FARGATE', 'FARGATE_SPOT'],
          defaultCapacityProviderStrategy: [{ capacityProvider: 'FARGATE', weight: 1, base: 1 }],
          tags: expr('(' + e.c(t) + ' | map({key:.Key,value:.Value}))'),
        });
        break;
      case 'AWS::SecretsManager::Secret':
        request('secretsmanager', 'create-secret', { Name: n, Tags: t }, id);
        output(id, '.ARN', 'A');
        break;
      case 'AWS::AppConfig::Application':
        request('appconfig', 'create-application', { Name: n, Tags: tagmap(t) }, id);
        output(id, '.Id');
        break;
      case 'AWS::AppConfig::Environment':
        request(
          'appconfig',
          'create-environment',
          { ApplicationId: p.ApplicationId, Name: n, Tags: tagmap(t) },
          id,
        );
        output(id, '.Id');
        break;
      case 'AWS::AppConfig::ConfigurationProfile':
        request(
          'appconfig',
          'create-configuration-profile',
          {
            ApplicationId: p.ApplicationId,
            Name: n,
            LocationUri: p.LocationUri,
            Type: p.Type,
            Validators: p.Validators,
            Tags: tagmap(t),
          },
          id,
        );
        output(id, '.Id');
        break;
      case 'AWS::AppConfig::DeploymentStrategy':
        request(
          'appconfig',
          'create-deployment-strategy',
          {
            Name: n,
            DeploymentDurationInMinutes: p.DeploymentDurationInMinutes,
            FinalBakeTimeInMinutes: p.FinalBakeTimeInMinutes,
            GrowthFactor: p.GrowthFactor,
            GrowthType: p.GrowthType,
            ReplicateTo: p.ReplicateTo,
            Tags: tagmap(t),
          },
          id,
        );
        output(id, '.Id');
        break;
      case 'AWS::StepFunctions::StateMachine':
        request('stepfunctions', 'create-state-machine', {
          name: n,
          definition: j(p.Definition),
          roleArn: p.RoleArn,
          type: p.StateMachineType,
          loggingConfiguration: expr(
            '(' +
              e.c(p.LoggingConfiguration) +
              ' | {level:.Level,includeExecutionData:.IncludeExecutionData,destinations:[.Destinations[]|{cloudWatchLogsLogGroup:{logGroupArn:.CloudWatchLogsLogGroup.LogGroupArn}}]})',
          ),
          tags: expr('(' + e.c(t) + ' | map({key:.Key,value:.Value}))'),
        });
        break;
      case 'AWS::Athena::WorkGroup':
        request('athena', 'create-work-group', {
          Name: n,
          Configuration: p.WorkGroupConfiguration,
          Tags: t,
        });
        break;
      case 'AWS::Kinesis::Stream':
        request('kinesis', 'create-stream', {
          StreamName: n,
          StreamModeDetails: { StreamMode: 'ON_DEMAND' },
          Tags: tagmap(t),
        });
        steps.push(`aws kinesis wait stream-exists --stream-name "$(jq -nr ${quote(e.name(id))})"`);
        request('kinesis', 'start-stream-encryption', {
          StreamName: n,
          EncryptionType: 'KMS',
          KeyId: 'alias/aws/kinesis',
        });
        steps.push(`aws kinesis wait stream-exists --stream-name "$(jq -nr ${quote(e.name(id))})"`);
        request('kinesis', 'increase-stream-retention-period', {
          StreamName: n,
          RetentionPeriodHours: 72,
        });
        break;
      case 'AWS::Kinesis::ResourcePolicy':
        steps.push(`aws kinesis wait stream-exists --stream-name "$NAME"`);
        request('kinesis', 'put-resource-policy', {
          ResourceARN: p.ResourceArn,
          Policy: j(p.ResourcePolicy),
        });
        break;
      case 'AWS::GuardDuty::Detector':
        request(
          'guardduty',
          'create-detector',
          { Enable: true, FindingPublishingFrequency: 'FIFTEEN_MINUTES', Tags: tagmap(t) },
          id,
        );
        output(id, '.DetectorId');
        break;
      case 'AWS::AccessAnalyzer::Analyzer':
        request(
          'accessanalyzer',
          'create-analyzer',
          { analyzerName: n, type: 'ACCOUNT', tags: tagmap(t) },
          id,
        );
        output(id, '.arn', 'A');
        break;
      case 'AWS::EC2::SecurityGroup':
        request(
          'ec2',
          'create-security-group',
          {
            GroupName: p.GroupName,
            Description: p.GroupDescription,
            VpcId: p.VpcId,
            TagSpecifications: [{ ResourceType: 'security-group', Tags: t }],
          },
          id,
        );
        output(id, '.GroupId');
        request('ec2', 'revoke-security-group-egress', {
          GroupId: ref(id),
          IpPermissions: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
        });
        steps.push(
          `if err=$(aws ec2 revoke-security-group-egress --group-id "$R_${id}" --ip-permissions '[{"IpProtocol":"-1","Ipv6Ranges":[{"CidrIpv6":"::/0"}]}]' 2>&1); then :; elif [[ "$err" != *"(InvalidPermission.NotFound)"* ]]; then printf '%s\\n' "$err" >&2; exit 1; fi`,
        );
        for (const rule of p.SecurityGroupEgress)
          request('ec2', 'authorize-security-group-egress', {
            GroupId: ref(id),
            IpPermissions: [
              {
                IpProtocol: rule.IpProtocol,
                FromPort: rule.FromPort,
                ToPort: rule.ToPort,
                IpRanges: [{ CidrIp: rule.CidrIp }],
              },
            ],
            TagSpecifications: [{ ResourceType: 'security-group-rule', Tags: t }],
          });
        break;
      default:
        throw Error('Missing native CLI mapping: ' + r.Type);
    }
  }
  return steps;
}
const shortTagMap = `"$(jq -cn --arg key "\${TAG_KEY:?Set TAG_KEY}" --arg value "\${TAG_VALUE:?Set TAG_VALUE}" '{($key):$value}')"`;
const shortTagList = `"Key=\${TAG_KEY:?Set TAG_KEY},Value=\${TAG_VALUE:?Set TAG_VALUE}"`;
function simpleCommand(kind: string) {
  const name = '"${NAME:?Set NAME}"';
  if (kind === 'logs')
    return `aws logs create-log-group --log-group-name ${name} --deletion-protection-enabled --tags ${shortTagMap} && aws logs put-retention-policy --log-group-name "$NAME" --retention-in-days 30`;
  if (kind === 'secret')
    return `aws secretsmanager create-secret --name ${name} --tags ${shortTagList}`;
  if (kind === 'sns') return null; // Its TLS policy is part of the generated chain.
  if (kind === 'eventbridge')
    return `aws events create-event-bus --name ${name} --tags ${shortTagList}`;
  if (kind === 'ecr')
    return `aws ecr create-repository --repository-name ${name} --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 --tags ${shortTagList} && aws ecr put-lifecycle-policy --repository-name "$NAME" --lifecycle-policy-text '${JSON.stringify({ rules: [{ rulePriority: 1, description: 'Expire untagged images after 30 days', selection: { tagStatus: 'untagged', countType: 'sinceImagePushed', countUnit: 'days', countNumber: 30 }, action: { type: 'expire' } }] })}'`;
  return null;
}
function directCommand(
  template: CloudFormationTemplate,
  kind: string,
  inputs: string[] = ['NAME'],
) {
  const simple = simpleCommand(kind);
  if (simple) return simple;
  const source = structuredClone(template);
  if (kind === 'security-groups') {
    source.Resources = {
      SecurityGroup:
        source.Resources['Fn::ForEach::SecurityGroups'][2]['SecurityGroup&{GroupName}'],
    };
    delete source.Outputs;
  }
  const steps = [
    ...(Object.values(source.Resources).some(r => r.Type === 'AWS::Lambda::Function')
      ? work()
      : []),
    `export NAME=${inputs.includes('NAME') ? '"$NAME"' : inputs.includes('ROLE_NAME') ? '"$ROLE_NAME"' : quote(stackName(kind, inputs))}`,
    ...identity(),
  ];
  if (template.Parameters?.RoleArn)
    steps.push(
      'ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)',
      'export ROLE_ARN',
    );
  if (kind === 'security-groups')
    steps.push(
      'IFS=, read -ra names <<<"$SG_NAMES"',
      `for SG_NAME in "\${names[@]}"; do export SG_NAME && ${cliSteps(source).join(' && ')} || exit $?; done`,
    );
  else steps.push(...cliSteps(source));
  const body = steps.filter(step => !identity().includes(step)).join(' ');
  return shell(
    /env\.(ACCOUNT_ID|PARTITION)|\$(ACCOUNT_ID|PARTITION)/.test(body)
      ? steps
      : steps.filter(step => !identity().includes(step)),
    inputs,
  );
}

export function securityCommand() {
  return shell(
    [
      ...identity(),
      `tags=$(jq -cn '{(env.TAG_KEY):env.TAG_VALUE}')`,
      'detector=$(aws guardduty list-detectors --query "DetectorIds[0]" --output text)',
      'analyzers=$(aws accessanalyzer list-analyzers --output json)',
      `jq -e --arg name "$NAME" 'all(.analyzers[]; .name != $name or .type == "ACCOUNT") and all(.analyzers[] | select(.type=="ACCOUNT"); .status=="ACTIVE" or .status=="CREATING")' <<<"$analyzers" >/dev/null`,
      'analyzer=$(jq -r \'.analyzers[] | select(.type=="ACCOUNT") | .arn\' <<<"$analyzers")',
      `if [ "$detector" = None ]; then detector=$(aws guardduty create-detector --enable --finding-publishing-frequency FIFTEEN_MINUTES --tags "$tags" --query DetectorId --output text); else aws guardduty update-detector --detector-id "$detector" --enable --finding-publishing-frequency FIFTEEN_MINUTES && aws guardduty tag-resource --resource-arn "arn:$PARTITION:guardduty:$REGION:$ACCOUNT_ID:detector/$detector" --tags "$tags"; fi`,
      `if [ -n "$analyzer" ]; then aws accessanalyzer tag-resource --resource-arn "$analyzer" --tags "$tags"; else analyzer=$(aws accessanalyzer create-analyzer --analyzer-name "$NAME" --type ACCOUNT --tags "$tags" --query arn --output text); fi`,
      `printf 'Detector: %s\\nAnalyzer: %s\\n' "$detector" "$analyzer"`,
    ],
    ['NAME'],
  );
}

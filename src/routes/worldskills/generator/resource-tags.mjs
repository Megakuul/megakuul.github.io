/** @param {string} name */
const ref = name => ({ Ref: name });
/** @param {string} value */
const sub = value => ({ 'Fn::Sub': value });
/** @param {string} name */
const arn = name => ({ 'Fn::GetAtt': [name, 'Arn'] });
const tags = () => [{ Key: ref('TagKey'), Value: ref('TagValue') }];
const native = new Set([
  'AWS::EC2::SecurityGroup',
  'AWS::Logs::LogGroup',
  'AWS::Logs::DeliveryDestination',
  'AWS::IAM::Role',
  'AWS::WAFv2::WebACL',
  'AWS::SQS::Queue',
  'AWS::S3::Bucket',
  'AWS::Lambda::Function',
  'AWS::Events::Rule',
  'AWS::SNS::Topic',
  'AWS::CloudWatch::Alarm',
]);

export const taggerCode = `import boto3
import cfnresponse
from botocore.config import Config

def handler(event, context):
    physical_id = event.get("PhysicalResourceId", event["LogicalResourceId"])
    try:
        if event["RequestType"] != "Delete":
            props = event["ResourceProperties"]
            tags = [{"Key": props["TagKey"], "Value": props["TagValue"]}]
            for target in props["Targets"]:
                kind, identifier = target["Kind"], target["Id"]
                service = {"Policy": "iam", "InstanceProfile": "iam", "Recorder": "config", "WebACL": "wafv2"}[kind]
                client = boto3.client(service, config=Config(retries={"mode": "standard", "max_attempts": 5}))
                if kind == "Policy":
                    client.tag_policy(PolicyArn=identifier, Tags=tags)
                elif kind == "InstanceProfile":
                    client.tag_instance_profile(InstanceProfileName=identifier, Tags=tags)
                elif kind == "Recorder":
                    recorders = client.describe_configuration_recorders(ConfigurationRecorderNames=[identifier])["ConfigurationRecorders"]
                    client.tag_resource(ResourceArn=recorders[0]["arn"], Tags=tags)
                elif kind == "WebACL":
                    client.tag_resource(ResourceARN=identifier, Tags=tags)
    except Exception as error:
        print(type(error).__name__, str(error))
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, physical_id, reason=str(error)[:1000])
        return
    cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physical_id)
`;

/** @template {{ Parameters: Record<string, any>, Resources: Record<string, any> }} T @param {T} template @returns {T} */
export function tagTemplate(template) {
  template.Parameters.TagKey = {
    Type: 'String',
    Default: 'Project',
    MinLength: 1,
    MaxLength: 128,
    AllowedPattern: '(?![aA][wW][sS]:)(?!MonitoringRole$).+',
    ConstraintDescription: 'Use a custom tag key; aws: and MonitoringRole are reserved.',
  };
  template.Parameters.TagValue = { Type: 'String', Default: 'quickstart', MaxLength: 256 };
  const targets = [];
  const statements = [];
  for (const [id, resource] of Object.entries(template.Resources)) {
    if (native.has(resource.Type)) {
      resource.Properties ??= {};
      resource.Properties.Tags = [...(resource.Properties.Tags ?? []), ...tags()];
    }
    let kind, identifier, action, scope;
    if (resource.Type === 'AWS::IAM::ManagedPolicy') {
      kind = 'Policy';
      identifier = ref(id);
      action = 'iam:TagPolicy';
      scope = ref(id);
    } else if (resource.Type === 'AWS::IAM::InstanceProfile') {
      kind = 'InstanceProfile';
      identifier = ref(id);
      action = 'iam:TagInstanceProfile';
      scope = arn(id);
    } else if (resource.Type === 'AWS::Config::ConfigurationRecorder') {
      kind = 'Recorder';
      identifier = ref(id);
      action = 'config:TagResource';
      scope = sub(
        'arn:${AWS::Partition}:config:${AWS::Region}:${AWS::AccountId}:configuration-recorder/${' +
          id +
          '}/*',
      );
      statements.push({
        Effect: 'Allow',
        Action: 'config:DescribeConfigurationRecorders',
        Resource: scope,
        Condition: { StringEquals: { 'aws:RequestedRegion': ref('AWS::Region') } },
      });
    } else if (resource.Type === 'AWS::WAFv2::WebACL') {
      // WAF's documented CloudFormation Tags property only applies at creation.
      kind = 'WebACL';
      identifier = arn(id);
      action = 'wafv2:TagResource';
      scope = arn(id);
    }
    if (kind) {
      targets.push({ Kind: kind, Id: identifier });
      statements.push({ Effect: 'Allow', Action: action, Resource: scope });
    }
  }
  if (!targets.length) return template;
  template.Resources.ResourceTaggerLogs = {
    Type: 'AWS::Logs::LogGroup',
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      RetentionInDays: template.Parameters.RetentionDays ? ref('RetentionDays') : 30,
      DeletionProtectionEnabled: true,
      Tags: tags(),
    },
  };
  template.Resources.ResourceTaggerRole = {
    Type: 'AWS::IAM::Role',
    Properties: {
      Tags: tags(),
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      Policies: [
        {
          PolicyName: 'TagStackResources',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              ...statements,
              {
                Effect: 'Allow',
                Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                Resource: arn('ResourceTaggerLogs'),
              },
            ],
          },
        },
      ],
    },
  };
  template.Resources.ResourceTagger = {
    Type: 'AWS::Lambda::Function',
    Properties: {
      Runtime: 'python3.13',
      Handler: 'index.handler',
      Timeout: 120,
      Role: arn('ResourceTaggerRole'),
      Tags: tags(),
      LoggingConfig: { LogGroup: ref('ResourceTaggerLogs') },
      Code: { ZipFile: taggerCode },
    },
  };
  template.Resources.ResourceTags = {
    Type: 'Custom::ResourceTags',
    Properties: {
      ServiceToken: arn('ResourceTagger'),
      ServiceTimeout: 180,
      TagKey: ref('TagKey'),
      TagValue: ref('TagValue'),
      Targets: targets,
    },
  };
  return template;
}

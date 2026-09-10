import { bootstrapTemplate } from './bootstrap-template.mjs';
/** @param {string} name */
const ref = name => ({ Ref: name });
const tags = () => [{ Key: ref('TagKey'), Value: ref('TagValue') }];
const native = new Set([
  'AWS::EC2::SecurityGroup',
  'AWS::EKS::PodIdentityAssociation',
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
  'AWS::Events::EventBus',
  'AWS::ECR::Repository',
  'AWS::ECS::Cluster',
  'AWS::SecretsManager::Secret',
  'AWS::AppConfig::Application',
  'AWS::AppConfig::Environment',
  'AWS::AppConfig::ConfigurationProfile',
  'AWS::AppConfig::DeploymentStrategy',
  'AWS::StepFunctions::StateMachine',
  'AWS::Athena::WorkGroup',
  'AWS::Kinesis::Stream',
  'AWS::GuardDuty::Detector',
  'AWS::AccessAnalyzer::Analyzer',
]);

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
  for (const resource of Object.values(template.Resources)) {
    if (native.has(resource.Type)) {
      resource.Properties ??= {};
      resource.Properties.Tags = [...(resource.Properties.Tags ?? []), ...tags()];
    }
  }
  return bootstrapTemplate(template);
}

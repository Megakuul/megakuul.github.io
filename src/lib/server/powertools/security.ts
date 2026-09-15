import type { CloudFormationTemplate } from '$lib/powertools/types';

/** CloudFront WAFs must be created in us-east-1, independently of the pipeline Region. */
export function globalWafTemplate(): CloudFormationTemplate {
  const template: CloudFormationTemplate = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'CloudFront WAF and logs; deploy in us-east-1.',
    Parameters: { TagKey: { Type: 'String' }, TagValue: { Type: 'String' } },
    Resources: {},
    Outputs: { WebACLArn: { Value: { 'Fn::GetAtt': ['WebACL', 'Arn'] } } },
  };
  regionalWaf(template, {});
  delete template.Resources.WafAssociation;
  template.Resources.WebACL.Properties!.Scope = 'CLOUDFRONT';
  return template;
}

/** An attached regional WAF; request bodies and credentials are not logged. */
export function regionalWaf(template: CloudFormationTemplate, targetArn: object) {
  const r = template.Resources;
  const tags = [{ Key: { Ref: 'TagKey' }, Value: { Ref: 'TagValue' } }];
  const visibility = (MetricName: string) => ({
    MetricName,
    CloudWatchMetricsEnabled: true,
    SampledRequestsEnabled: false,
  });
  r.WebACL = {
    Type: 'AWS::WAFv2::WebACL',
    Properties: {
      Scope: 'REGIONAL',
      DefaultAction: { Allow: {} },
      Tags: tags,
      VisibilityConfig: visibility('Application'),
      Rules: [
        ...[
          'AWSManagedRulesCommonRuleSet',
          'AWSManagedRulesKnownBadInputsRuleSet',
          'AWSManagedRulesSQLiRuleSet',
          'AWSManagedRulesAmazonIpReputationList',
        ].map((Name, Priority) => ({
          Name,
          Priority,
          Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name } },
          OverrideAction: { None: {} },
          VisibilityConfig: visibility(Name),
        })),
        {
          Name: 'RateLimit',
          Priority: 10,
          Statement: {
            RateBasedStatement: { Limit: 10000, EvaluationWindowSec: 300, AggregateKeyType: 'IP' },
          },
          Action: { Block: {} },
          VisibilityConfig: visibility('RateLimit'),
        },
      ],
    },
  };
  r.WafLogs = {
    Type: 'AWS::Logs::LogGroup',
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      LogGroupName: { 'Fn::Sub': 'aws-waf-logs-${AWS::StackName}' },
      RetentionInDays: 30,
      DeletionProtectionEnabled: true,
      Tags: tags,
    },
  };
  r.WafLogging = {
    Type: 'AWS::WAFv2::LoggingConfiguration',
    Properties: {
      ResourceArn: { 'Fn::GetAtt': ['WebACL', 'Arn'] },
      LogDestinationConfigs: [
        {
          'Fn::Sub':
            'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WafLogs}',
        },
      ],
      RedactedFields: [
        { SingleHeader: { Name: 'authorization' } },
        { SingleHeader: { Name: 'cookie' } },
        { QueryString: {} },
      ],
    },
  };
  r.WafAssociation = {
    Type: 'AWS::WAFv2::WebACLAssociation',
    Properties: { ResourceArn: targetArn, WebACLArn: { 'Fn::GetAtt': ['WebACL', 'Arn'] } },
  };
}

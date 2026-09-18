import type { CloudFormationTemplate } from '$lib/powertools/types';

/** Apply the same log encryption baseline to YAML and generated infrastructure recipes. */
export function encryptLogGroups(template: CloudFormationTemplate): CloudFormationTemplate {
  const result = structuredClone(template);
  const groups = Object.values(result.Resources).filter(
    r => r.Type === 'AWS::Logs::LogGroup' && !r.Properties?.KmsKeyId,
  );
  if (!groups.length) return result;
  const contexts = groups.map(group => {
    const name = group.Properties!.LogGroupName;
    if (!name) throw Error('Encrypted log groups must have an explicit name');
    // API -> Lambda -> logs -> key would form a cycle if the key depended on API's ID.
    // Limit this one context to the API execution-log prefix and live stage instead.
    const contextName =
      name['Fn::Sub'] === 'API-Gateway-Execution-Logs_${Api}/live'
        ? 'API-Gateway-Execution-Logs_*/live'
        : name;
    return {
      'Fn::Join': [
        '',
        [
          { 'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' },
          contextName,
        ],
      ],
    };
  });
  const key = {
    Type: 'AWS::KMS::Key',
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      Description: 'CloudWatch Logs encryption for this powertool',
      EnableKeyRotation: true,
      KeySpec: 'SYMMETRIC_DEFAULT',
      KeyUsage: 'ENCRYPT_DECRYPT',
      PendingWindowInDays: 30,
      KeyPolicy: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AccountAdministration',
            Effect: 'Allow',
            Principal: { AWS: { 'Fn::Sub': 'arn:${AWS::Partition}:iam::${AWS::AccountId}:root' } },
            Action: 'kms:*',
            Resource: '*',
          },
          {
            Sid: 'ScopedLogEncryption',
            Effect: 'Allow',
            Principal: { Service: { 'Fn::Sub': 'logs.${AWS::Region}.${AWS::URLSuffix}' } },
            Action: [
              'kms:Encrypt',
              'kms:Decrypt',
              'kms:ReEncrypt*',
              'kms:GenerateDataKey*',
              'kms:DescribeKey',
            ],
            Resource: '*',
            Condition: { ArnLike: { 'kms:EncryptionContext:aws:logs:arn': contexts } },
          },
        ],
      },
      Tags: [{ Key: { Ref: 'TagKey' }, Value: { Ref: 'TagValue' } }],
    },
  };
  // The native CLI renderer executes in resource order; create the key before log groups.
  result.Resources = { LogEncryptionKey: key, ...result.Resources };
  for (const group of groups)
    group.Properties!.KmsKeyId = { 'Fn::GetAtt': ['LogEncryptionKey', 'Arn'] };
  result.Outputs = {
    ...result.Outputs,
    LogEncryptionKeyArn: {
      Description: 'Retained rotating key; keep enabled while retained logs are needed.',
      Value: { 'Fn::GetAtt': ['LogEncryptionKey', 'Arn'] },
    },
  };
  return result;
}

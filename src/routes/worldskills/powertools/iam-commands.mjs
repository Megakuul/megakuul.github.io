// @ts-nocheck
import catalog from '../../../../static/downloads/iam/catalog.json' with { type: 'json' };
import { tagTemplate } from './resource-tags.mjs';
import { creationCommands, ref, sub, att } from './native-commands.mjs';
import { iamEnvironment, tagEnvironment } from './environment.mjs';
function resolveExample(value, context) {
  return JSON.parse(
    JSON.stringify(value).replace(/\$\{([A-Z_]+)\}/g, (_, key) =>
      JSON.stringify(context[key]).slice(1, -1),
    ),
  );
}
export function roleTemplate(role) {
  const mapping = {
    PARTITION: 'AWS::Partition',
    ACCOUNT_ID: 'AWS::AccountId',
    REGION: 'AWS::Region',
    ROLE_NAME: 'RoleName',
    CLUSTER_NAME: 'ClusterName',
    NAMESPACE: 'Namespace',
    SERVICE_ACCOUNT: 'ServiceAccount',
  };
  function convert(v) {
    if (Array.isArray(v)) return v.map(convert);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, v]) => [k, convert(v)]));
    if (typeof v !== 'string' || !v.includes('${')) return v;
    v = v
      .replaceAll('${SOURCE_ARN}', role.source ?? '')
      .replaceAll(
        '${CLUSTER_ARN}',
        'arn:${PARTITION}:eks:${REGION}:${ACCOUNT_ID}:cluster/${CLUSTER_NAME}',
      );
    return sub(v.replace(/\$\{([A-Z_]+)\}/g, (_, k) => '${' + mapping[k] + '}'));
  }
  const t = {
    AWSTemplateFormatVersion: '2010-09-09',
    Parameters: { RoleName: { Type: 'String', AllowedPattern: '[A-Za-z0-9+=,.@_-]{1,64}' } },
    Resources: {},
    Outputs: {},
  };
  for (const input of role.inputs)
    t.Parameters[mapping[input.env]] = { Type: 'String', MinLength: 1 };
  t.Resources.Role = {
    Type: 'AWS::IAM::Role',
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      RoleName: ref('RoleName'),
      AssumeRolePolicyDocument: convert(role.trust),
      ManagedPolicyArns: convert(role.managedPolicies),
    },
  };
  t.Resources.Permissions = {
    Type: 'AWS::IAM::ManagedPolicy',
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      ManagedPolicyName: sub('${RoleName}-permissions'),
      Path: '/powertools/',
      Description: 'Application permissions for this role.',
      PolicyDocument: catalog.emptyPolicy,
      Roles: [ref('Role')],
    },
  };
  if (role.instanceProfile)
    t.Resources.Profile = {
      Type: 'AWS::IAM::InstanceProfile',
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: { InstanceProfileName: ref('RoleName'), Roles: [ref('Role')] },
    };
  t.Outputs.RoleArn = { Value: att('Role') };
  t.Outputs.PolicyArn = { Value: ref('Permissions') };
  return tagTemplate(t);
}
function podIdentityRecipe() {
  const inputs = ['ROLE_NAME', 'CLUSTER_NAME', 'NAMESPACE', 'SERVICE_ACCOUNT'];
  const document = tagTemplate({
    AWSTemplateFormatVersion: '2010-09-09',
    Parameters: Object.fromEntries(
      ['RoleArn', 'ClusterName', 'Namespace', 'ServiceAccount'].map(k => [
        k,
        { Type: 'String', MinLength: 1 },
      ]),
    ),
    Resources: {
      Association: {
        Type: 'AWS::EKS::PodIdentityAssociation',
        Properties: {
          RoleArn: ref('RoleArn'),
          ClusterName: ref('ClusterName'),
          Namespace: ref('Namespace'),
          ServiceAccount: ref('ServiceAccount'),
        },
      },
    },
  });
  return {
    id: 'iam-pod-identity-association',
    title: 'EKS · associate Pod Identity role · agent required',
    ...creationCommands(document, 'pod-identity', inputs),
    env: [
      ...inputs.map((name, i) => ({
        name,
        example: ['my-app-role', 'my-cluster', 'app', 'worker'][i],
        required: true,
      })),
      ...tagEnvironment,
    ],
  };
}
export function iamGroups() {
  return [
    {
      id: 'iam-environment',
      title: 'Environment',
      recipes: [
        {
          id: 'iam-environment-setup',
          title: 'Tags · required by every creation command',
          command: 'export TAG_KEY=Project TAG_VALUE=my-app',
          env: tagEnvironment,
        },
        {
          id: 'iam-change-role',
          title: 'Shared role name · create role, then Lambda / Step Functions',
          command: 'export ROLE_NAME=my-app-role',
          env: [{ name: 'ROLE_NAME', example: 'my-app-role', required: true }],
        },
      ],
    },
    {
      id: 'iam-roles',
      title: 'IAM · role + empty tagged policy',
      recipes: catalog.roles.map(role => {
        const document = roleTemplate(role),
          inputs = ['ROLE_NAME', ...role.inputs.map(i => i.env)];
        return {
          id: `iam-role-${role.id}`,
          title: role.title,
          ...creationCommands(document, 'role-' + role.id, inputs),
          env: iamEnvironment('iam-role-' + role.id),
        };
      }),
    },
    {
      id: 'iam-manage',
      title: 'IAM · inspect',
      recipes: [
        podIdentityRecipe(),
        {
          id: 'iam-list-attached',
          title: 'Show attached policies',
          command: 'aws iam list-attached-role-policies --role-name "${ROLE_NAME:?Set ROLE_NAME}"',
          env: [{ name: 'ROLE_NAME', example: 'my-app-role', required: true }],
        },
      ],
    },
    ...[...new Set(catalog.policies.map(p => p.group))].map(group => ({
      id: `iam-access-${group.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      title: `Policies · ${group}`,
      recipes: catalog.policies
        .filter(p => p.group === group)
        .map(p => ({
          id: `iam-access-${p.id}`,
          title: p.title,
          document: resolveExample(p.policy, { ...catalog.exampleContext, ...p.example }),
        })),
    })),
  ];
}

import { stringify } from 'yaml';
import type { CloudFormationTemplate } from '$lib/powertools/types';

const ref = (Ref: string) => ({ Ref });
const sub = (value: string) => ({ 'Fn::Sub': value });
const att = (resource: string, attribute = 'Arn') => ({ 'Fn::GetAtt': [resource, attribute] });
const iff = (condition: string, yes: any, no: any = ref('AWS::NoValue')) => ({
  'Fn::If': [condition, yes, no],
});
const tags = [{ Key: ref('TagKey'), Value: ref('TagValue') }];
const allow = (Action: string | string[] | object, Resource: any, Condition?: object) => ({
  Effect: 'Allow',
  Action,
  Resource,
  ...(Condition ? { Condition } : {}),
});
const policy = (...Statement: any[]) => ({ Version: '2012-10-17', Statement });
const resource = (Type: string, Properties: any, extra: any = {}) => ({
  Type,
  ...extra,
  Properties,
});
const pipelineArn = sub(
  'arn:${AWS::Partition}:codepipeline:${AWS::Region}:${AWS::AccountId}:${AWS::StackName}',
);
const projectArn = (suffix: string) =>
  sub(
    'arn:${AWS::Partition}:codebuild:${AWS::Region}:${AWS::AccountId}:project/${AWS::StackName}-' +
      suffix,
  );
const role = (service: string, statements: any[], source?: any) =>
  resource('AWS::IAM::Role', {
    AssumeRolePolicyDocument: policy({
      Effect: 'Allow',
      Principal: { Service: service },
      Action: 'sts:AssumeRole',
      ...(source
        ? {
            Condition: {
              StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
              ArnEquals: { 'aws:SourceArn': source },
            },
          }
        : {}),
    }),
    ...(statements.length
      ? { Policies: [{ PolicyName: 'ScopedAccess', PolicyDocument: policy(...statements) }] }
      : {}),
    Tags: tags,
  });
const logs = (name: any) =>
  resource(
    'AWS::Logs::LogGroup',
    { LogGroupName: name, RetentionInDays: 30, DeletionProtectionEnabled: true, Tags: tags },
    { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
  );
const bucket = (extra: object = {}) =>
  resource(
    'AWS::S3::Bucket',
    {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
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
    { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
  );
const bucketTLS = (id: string, extraStatements: any[] = []) =>
  resource('AWS::S3::BucketPolicy', {
    Bucket: ref(id),
    PolicyDocument: policy(
      {
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: [att(id), sub('${' + id + '.Arn}/*')],
        Condition: {
          Bool: { 'aws:SecureTransport': 'false', 'aws:PrincipalIsAWSService': 'false' },
        },
      },
      ...extraStatements,
    ),
  });
const artifactPermissions = () => [
  allow(['s3:GetBucketLocation', 's3:GetBucketVersioning', 's3:ListBucket'], att('Artifacts')),
  allow(['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'], sub('${Artifacts.Arn}/*')),
];
const logPermissions = (id: string) =>
  allow(['logs:CreateLogStream', 'logs:PutLogEvents'], att(id));
const passRole = (arns: any, service: string) =>
  allow('iam:PassRole', arns, { StringEquals: { 'iam:PassedToService': service } });
const action = (
  name: string,
  category: string,
  provider: string,
  Configuration: any,
  input?: string,
  output?: string,
) => ({
  Name: name,
  ActionTypeId: { Category: category, Owner: 'AWS', Provider: provider, Version: '1' },
  Configuration,
  RunOrder: 1,
  ...(input ? { InputArtifacts: [{ Name: input }] } : {}),
  ...(output ? { OutputArtifacts: [{ Name: output }] } : {}),
});
const stage = (name: string, ...Actions: any[]) => ({ Name: name, Actions });

type PipelineCloudFormation = Omit<CloudFormationTemplate, 'Resources'> & {
  Parameters: CloudFormationTemplate['Parameters'];
  Resources: Record<string, { Type: string; Properties: any; [key: string]: any }>;
};

export interface PipelineTemplate {
  id: string;
  title: string;
  template: PipelineCloudFormation;
  source: Record<string, string>;
}
const html = '<!doctype html><html><body><h1>Deployed by CodePipeline</h1></body></html>\n';
const lambdaCode =
  'exports.handler = async () => ({ statusCode: 200, body: "Deployed by CodePipeline" });\n';
const defaults: Record<string, [string, string]> = {
  commands: ['mkdir -p dist && printf "build succeeded\\n" > dist/result.txt', 'dist'],
  s3: ['mkdir -p dist && cp index.html dist/', 'dist'],
  ec2: ['mkdir -p dist && cp -r site scripts appspec.yml dist/', 'dist'],
  lambda: ['mkdir -p dist && cp index.js dist/', 'dist'],
  'lambda-codedeploy': ['mkdir -p dist && cp index.js dist/', 'dist'],
  cloudformation: ['mkdir -p dist && cp template.yaml dist/', 'dist'],
  ecr: [':', '.'],
  ecs: [':', '.'],
  'ecs-bluegreen': [':', '.'],
};

function base(id: string, title: string): PipelineTemplate {
  const [command, output] = defaults[id];
  const template: PipelineCloudFormation = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      title +
      '. Source is a new S3 bucket or CodeCommit repository. All execution roles are created by this stack.',
    Parameters: {
      SourceProvider: { Type: 'String', Default: 'S3', AllowedValues: ['S3', 'CodeCommit'] },
      SourceKey: { Type: 'String', Default: 'source.zip', MinLength: 1 },
      BranchName: { Type: 'String', Default: 'main', MinLength: 1 },
      BuildCommand: { Type: 'String', Default: command },
      OutputDirectory: { Type: 'String', Default: output, MinLength: 1 },
      RequireApproval: { Type: 'String', Default: 'true', AllowedValues: ['true', 'false'] },
      TagKey: { Type: 'String', Default: 'Project' },
      TagValue: { Type: 'String', Default: 'worldskills' },
    },
    Conditions: {
      IsS3: { 'Fn::Equals': [ref('SourceProvider'), 'S3'] },
      IsCodeCommit: { 'Fn::Equals': [ref('SourceProvider'), 'CodeCommit'] },
      Approval: { 'Fn::Equals': [ref('RequireApproval'), 'true'] },
    },
    Resources: {
      Artifacts: bucket({
        LifecycleConfiguration: {
          Rules: [
            {
              Id: 'ExpireArtifacts',
              Status: 'Enabled',
              ExpirationInDays: 30,
              NoncurrentVersionExpiration: { NoncurrentDays: 30 },
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            },
          ],
        },
      }),
      ArtifactsTLS: bucketTLS('Artifacts'),
      SourceBucket: {
        ...bucket({
          NotificationConfiguration: { EventBridgeConfiguration: { EventBridgeEnabled: true } },
        }),
        Condition: 'IsS3',
      },
      SourceTLS: { ...bucketTLS('SourceBucket'), Condition: 'IsS3' },
      Repository: resource(
        'AWS::CodeCommit::Repository',
        {
          RepositoryName: sub('${AWS::StackName}-source'),
          RepositoryDescription: 'Pipeline source',
          Tags: tags,
        },
        { Condition: 'IsCodeCommit', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
      ),
      BuildLogs: logs(sub('/aws/codebuild/${AWS::StackName}-build')),
      BuildRole: role(
        'codebuild.amazonaws.com',
        [...artifactPermissions(), logPermissions('BuildLogs')],
        projectArn('build'),
      ),
      PipelineRole: role('codepipeline.amazonaws.com', [
        ...artifactPermissions(),
        iff('IsS3', allow(['s3:GetBucketVersioning', 's3:GetBucketLocation'], att('SourceBucket'))),
        iff(
          'IsS3',
          allow(['s3:GetObject', 's3:GetObjectVersion'], sub('${SourceBucket.Arn}/${SourceKey}')),
        ),
        iff(
          'IsCodeCommit',
          allow(
            [
              'codecommit:GetBranch',
              'codecommit:GetCommit',
              'codecommit:UploadArchive',
              'codecommit:GetUploadArchiveStatus',
              'codecommit:CancelUploadArchive',
            ],
            att('Repository'),
          ),
        ),
        allow(['codebuild:StartBuild', 'codebuild:BatchGetBuilds'], projectArn('build')),
      ]),
    },
    Outputs: {
      PipelineName: { Value: ref('AWS::StackName') },
      ArtifactBucket: { Value: ref('Artifacts') },
      SourceBucketName: { Condition: 'IsS3', Value: ref('SourceBucket') },
      RepositoryName: { Condition: 'IsCodeCommit', Value: ref('Repository') },
      RepositoryCloneUrl: { Condition: 'IsCodeCommit', Value: att('Repository', 'CloneUrlHttp') },
    },
  };
  return {
    id,
    title,
    template,
    source: {
      'README.txt': 'Put your application source here. BuildCommand runs from this directory.\n',
    },
  };
}
function addInput(recipe: PipelineTemplate, parameter: string, value: string, schema: any = {}) {
  recipe.template.Parameters[parameter] = {
    Type: 'String',
    ...schema,
    ...(schema.Type?.startsWith('AWS::EC2::') ? {} : { Default: value }),
  };
}
function statements(recipe: PipelineTemplate, roleId = 'PipelineRole'): any[] {
  return recipe.template.Resources[roleId].Properties!.Policies[0].PolicyDocument.Statement;
}
function buildProject(
  recipe: PipelineTemplate,
  spec: any,
  extraEnv: any[] = [],
  privileged = false,
) {
  recipe.template.Resources.BuildProject = resource('AWS::CodeBuild::Project', {
    Name: sub('${AWS::StackName}-build'),
    ServiceRole: att('BuildRole'),
    Source: { Type: 'CODEPIPELINE', BuildSpec: stringify(spec) },
    Artifacts: { Type: 'CODEPIPELINE' },
    Environment: {
      ComputeType: 'BUILD_GENERAL1_SMALL',
      Image: 'aws/codebuild/standard:7.0',
      Type: 'LINUX_CONTAINER',
      PrivilegedMode: privileged,
      EnvironmentVariables: [
        { Name: 'BUILD_COMMAND', Type: 'PLAINTEXT', Value: ref('BuildCommand') },
        ...(recipe.template.Parameters.OutputDirectory
          ? [{ Name: 'OUTPUT_DIRECTORY', Type: 'PLAINTEXT', Value: ref('OutputDirectory') }]
          : []),
        ...extraEnv,
      ],
    },
    TimeoutInMinutes: 30,
    QueuedTimeoutInMinutes: 30,
    LogsConfig: { CloudWatchLogs: { Status: 'ENABLED', GroupName: ref('BuildLogs') } },
    Tags: tags,
  });
}
const env = (Name: string, Value: any) => ({ Name, Value, Type: 'PLAINTEXT' });
function normalBuild(recipe: PipelineTemplate) {
  buildProject(recipe, {
    version: '0.2',
    phases: {
      build: {
        commands: ['bash -e -o pipefail -c "$BUILD_COMMAND"', 'test -d "$OUTPUT_DIRECTORY"'],
      },
    },
    artifacts: { files: ['**/*'], 'base-directory': '$OUTPUT_DIRECTORY' },
  });
}
function deployProject(
  recipe: PipelineTemplate,
  commands: string[],
  permissions: any[],
  variables: any[] = [],
) {
  const r = recipe.template.Resources;
  r.DeployLogs = logs(sub('/aws/codebuild/${AWS::StackName}-deploy'));
  r.DeployRole = role(
    'codebuild.amazonaws.com',
    [...artifactPermissions(), logPermissions('DeployLogs'), ...permissions],
    projectArn('deploy'),
  );
  r.DeployProject = resource('AWS::CodeBuild::Project', {
    Name: sub('${AWS::StackName}-deploy'),
    ServiceRole: att('DeployRole'),
    Source: {
      Type: 'CODEPIPELINE',
      BuildSpec: stringify({ version: '0.2', phases: { build: { commands } } }),
    },
    Artifacts: { Type: 'CODEPIPELINE' },
    Environment: {
      Type: 'LINUX_CONTAINER',
      ComputeType: 'BUILD_GENERAL1_SMALL',
      Image: 'aws/codebuild/standard:7.0',
      PrivilegedMode: false,
      EnvironmentVariables: variables,
    },
    TimeoutInMinutes: 30,
    QueuedTimeoutInMinutes: 30,
    LogsConfig: { CloudWatchLogs: { Status: 'ENABLED', GroupName: ref('DeployLogs') } },
    Tags: tags,
  });
  statements(recipe).push(
    allow(['codebuild:StartBuild', 'codebuild:BatchGetBuilds'], projectArn('deploy')),
  );
  return action(
    'Deploy',
    'Build',
    'CodeBuild',
    { ProjectName: ref('DeployProject') },
    'BuildOutput',
  );
}
function finish(recipe: PipelineTemplate, deploy?: any) {
  const r = recipe.template.Resources;
  r.Pipeline = resource('AWS::CodePipeline::Pipeline', {
    Name: ref('AWS::StackName'),
    PipelineType: 'V2',
    ExecutionMode: 'QUEUED',
    RoleArn: att('PipelineRole'),
    RestartExecutionOnUpdate: false,
    ArtifactStore: { Type: 'S3', Location: ref('Artifacts') },
    Stages: [
      stage(
        'Source',
        iff(
          'IsS3',
          action(
            'Source',
            'Source',
            'S3',
            {
              S3Bucket: ref('SourceBucket'),
              S3ObjectKey: ref('SourceKey'),
              PollForSourceChanges: 'false',
            },
            undefined,
            'SourceOutput',
          ),
          action(
            'Source',
            'Source',
            'CodeCommit',
            {
              RepositoryName: ref('Repository'),
              BranchName: ref('BranchName'),
              PollForSourceChanges: 'false',
            },
            undefined,
            'SourceOutput',
          ),
        ),
      ),
      stage(
        'Build',
        action(
          'Build',
          'Build',
          'CodeBuild',
          { ProjectName: ref('BuildProject') },
          'SourceOutput',
          'BuildOutput',
        ),
      ),
      iff(
        'Approval',
        stage(
          'Approval',
          action('Approve', 'Approval', 'Manual', {
            CustomData: 'Review this execution before continuing.',
          }),
        ),
      ),
      ...(deploy ? [stage('Deploy', deploy)] : []),
    ],
    Tags: tags,
  });
  r.TriggerRole = role(
    'events.amazonaws.com',
    [allow('codepipeline:StartPipelineExecution', pipelineArn)],
    sub(
      'arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/${AWS::StackName}-source',
    ),
  );
  r.SourceChange = resource(
    'AWS::Events::Rule',
    {
      Name: sub('${AWS::StackName}-source'),
      State: 'ENABLED',
      EventPattern: iff(
        'IsS3',
        {
          source: ['aws.s3'],
          'detail-type': ['Object Created'],
          detail: { bucket: { name: [ref('SourceBucket')] }, object: { key: [ref('SourceKey')] } },
        },
        {
          source: ['aws.codecommit'],
          'detail-type': ['CodeCommit Repository State Change'],
          resources: [att('Repository')],
          detail: {
            event: ['referenceCreated', 'referenceUpdated'],
            referenceType: ['branch'],
            referenceName: [ref('BranchName')],
          },
        },
      ),
      Targets: [
        {
          Id: 'Pipeline',
          Arn: pipelineArn,
          RoleArn: att('TriggerRole'),
          InputTransformer: {
            InputPathsMap: {
              revision: iff('IsS3', '$.detail.object.version-id', '$.detail.commitId'),
            },
            InputTemplate: iff(
              'IsS3',
              '{"sourceRevisions":[{"actionName":"Source","revisionType":"S3_OBJECT_VERSION_ID","revisionValue":"<revision>"}]}',
              '{"sourceRevisions":[{"actionName":"Source","revisionType":"COMMIT_ID","revisionValue":"<revision>"}]}',
            ),
          },
        },
      ],
    },
    { DependsOn: 'Pipeline' },
  );
  return recipe;
}

function commands() {
  const p = base('commands', 'Build command');
  normalBuild(p);
  return finish(p);
}
function s3() {
  const p = base('s3', 'S3 + CloudFront');
  const r = p.template.Resources;
  r.Website = bucket();
  r.OriginAccess = resource('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: {
      Name: sub('${AWS::StackName}-oac'),
      OriginAccessControlOriginType: 's3',
      SigningBehavior: 'always',
      SigningProtocol: 'sigv4',
    },
  });
  r.Distribution = resource('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      Enabled: true,
      DefaultRootObject: 'index.html',
      HttpVersion: 'http2',
      PriceClass: 'PriceClass_100',
      Origins: [
        {
          Id: 'website',
          DomainName: att('Website', 'RegionalDomainName'),
          OriginAccessControlId: ref('OriginAccess'),
          S3OriginConfig: { OriginAccessIdentity: '' },
        },
      ],
      DefaultCacheBehavior: {
        TargetOriginId: 'website',
        ViewerProtocolPolicy: 'redirect-to-https',
        Compress: true,
        AllowedMethods: ['GET', 'HEAD'],
        CachedMethods: ['GET', 'HEAD'],
        CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
      },
      ViewerCertificate: { CloudFrontDefaultCertificate: true },
    },
    Tags: tags,
  });
  r.WebsiteTLS = bucketTLS('Website', [
    {
      Effect: 'Allow',
      Principal: { Service: 'cloudfront.amazonaws.com' },
      Action: 's3:GetObject',
      Resource: sub('${Website.Arn}/*'),
      Condition: {
        StringEquals: {
          'AWS:SourceArn': sub(
            'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}',
          ),
        },
      },
    },
  ]);
  normalBuild(p);
  const deploy = deployProject(
    p,
    [
      'aws s3 sync . "s3://$WEBSITE_BUCKET/" --delete --only-show-errors',
      'aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*"',
    ],
    [
      allow('s3:ListBucket', att('Website')),
      allow(['s3:PutObject', 's3:DeleteObject'], sub('${Website.Arn}/*')),
      allow(
        'cloudfront:CreateInvalidation',
        sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}'),
      ),
    ],
    [env('WEBSITE_BUCKET', ref('Website')), env('DISTRIBUTION_ID', ref('Distribution'))],
  );
  p.template.Outputs!.WebsiteUrl = { Value: sub('https://${Distribution.DomainName}') };
  p.source = { 'index.html': html };
  return finish(p, deploy);
}

function containerBuild(p: PipelineTemplate) {
  delete p.template.Parameters.OutputDirectory;
  const r = p.template.Resources;
  r.Images = resource(
    'AWS::ECR::Repository',
    {
      ImageTagMutability: 'IMMUTABLE',
      ImageScanningConfiguration: { ScanOnPush: true },
      EncryptionConfiguration: { EncryptionType: 'AES256' },
      EmptyOnDelete: false,
      Tags: tags,
    },
    { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
  );
  statements(p, 'BuildRole').push(
    allow('ecr:GetAuthorizationToken', '*'),
    allow(
      [
        'ecr:BatchCheckLayerAvailability',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:PutImage',
        'ecr:BatchGetImage',
        'ecr:GetDownloadUrlForLayer',
      ],
      att('Images'),
    ),
  );
  buildProject(
    p,
    {
      version: '0.2',
      phases: {
        pre_build: {
          commands: [
            'REGISTRY=$(printf "%s" "$REPOSITORY_URI" | cut -d/ -f1)',
            'aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"',
            'IMAGE_TAG="build-$CODEBUILD_BUILD_NUMBER"',
          ],
        },
        build: {
          commands: [
            'bash -e -o pipefail -c "$BUILD_COMMAND"',
            'docker build --pull -t "$REPOSITORY_URI:$IMAGE_TAG" .',
          ],
        },
        post_build: {
          commands: [
            'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
            'docker push "$REPOSITORY_URI:$IMAGE_TAG"',
            'DIGEST=$(docker inspect --format="{{index .RepoDigests 0}}" "$REPOSITORY_URI:$IMAGE_TAG")',
            'test -n "$DIGEST"',
            'jq -n --arg image "$DIGEST" \'[{name:"app",imageUri:$image}]\' > imagedefinitions.json',
          ],
        },
      },
      artifacts: { files: ['imagedefinitions.json'] },
    },
    [env('REPOSITORY_URI', att('Images', 'RepositoryUri'))],
    true,
  );
  p.template.Outputs!.RepositoryUri = { Value: att('Images', 'RepositoryUri') };
  p.source = {
    Dockerfile:
      'FROM public.ecr.aws/docker/library/nginx:stable\nCOPY index.html /usr/share/nginx/html/index.html\n',
    'index.html': html,
  };
}
function ecr() {
  const p = base('ecr', 'ECR image');
  containerBuild(p);
  return finish(p);
}
function networkInputs(p: PipelineTemplate, ecs: boolean) {
  addInput(p, 'VpcId', 'vpc-0123456789abcdef0', { Type: 'AWS::EC2::VPC::Id' });
  if (ecs)
    addInput(p, 'SubnetIds', 'subnet-0123456789abcdef0,subnet-1123456789abcdef0', {
      Type: 'List<AWS::EC2::Subnet::Id>',
    });
  else addInput(p, 'SubnetId', 'subnet-0123456789abcdef0', { Type: 'AWS::EC2::Subnet::Id' });
  addInput(p, 'ClientCidr', '0.0.0.0/0');
}
function ecs(blueGreen: boolean) {
  const id = blueGreen ? 'ecs-bluegreen' : 'ecs';
  const p = base(id, blueGreen ? 'ECS blue/green' : 'ECS rolling');
  networkInputs(p, true);
  addInput(p, 'ContainerPort', '80', { Type: 'Number', MinValue: 1, MaxValue: 65535 });
  addInput(p, 'BootstrapImage', 'public.ecr.aws/docker/library/nginx:stable');
  addInput(p, 'HealthCheckPath', '/');
  containerBuild(p);
  const r = p.template.Resources;
  r.Cluster = resource('AWS::ECS::Cluster', {
    ClusterName: sub('${AWS::StackName}-cluster'),
    ClusterSettings: [{ Name: 'containerInsights', Value: 'enhanced' }],
    Tags: tags,
  });
  r.AppLogs = logs(sub('/ecs/${AWS::StackName}'));
  r.TaskRole = role(
    'ecs-tasks.amazonaws.com',
    [],
    sub('arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'),
  );
  // ECS supplies task ARNs to the trust policy; ArnLike permits the wildcard above.
  r.TaskRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.ArnLike =
    r.TaskRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.ArnEquals;
  delete r.TaskRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.ArnEquals;
  r.TaskExecutionRole = role('ecs-tasks.amazonaws.com', [
    logPermissions('AppLogs'),
    allow('ecr:GetAuthorizationToken', '*'),
    allow(
      ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'],
      att('Images'),
    ),
  ]);
  r.AlbGroup = resource('AWS::EC2::SecurityGroup', {
    GroupDescription: 'HTTP client access',
    VpcId: ref('VpcId'),
    SecurityGroupIngress: [
      { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, CidrIp: ref('ClientCidr') },
    ],
    SecurityGroupEgress: [{ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }],
    Tags: tags,
  });
  r.TaskGroup = resource('AWS::EC2::SecurityGroup', {
    GroupDescription: 'Only the ALB reaches application containers',
    VpcId: ref('VpcId'),
    SecurityGroupIngress: [
      {
        IpProtocol: 'tcp',
        FromPort: ref('ContainerPort'),
        ToPort: ref('ContainerPort'),
        SourceSecurityGroupId: ref('AlbGroup'),
      },
    ],
    SecurityGroupEgress: [{ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }],
    Tags: tags,
  });
  r.LoadBalancer = resource('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    Type: 'application',
    Scheme: 'internet-facing',
    Subnets: ref('SubnetIds'),
    SecurityGroups: [ref('AlbGroup')],
    Tags: tags,
  });
  const targetGroup = () =>
    resource('AWS::ElasticLoadBalancingV2::TargetGroup', {
      VpcId: ref('VpcId'),
      TargetType: 'ip',
      Protocol: 'HTTP',
      Port: ref('ContainerPort'),
      HealthCheckPath: ref('HealthCheckPath'),
      Matcher: { HttpCode: '200-399' },
      TargetGroupAttributes: [{ Key: 'deregistration_delay.timeout_seconds', Value: '30' }],
      Tags: tags,
    });
  r.Blue = targetGroup();
  if (blueGreen) r.Green = targetGroup();
  r.Listener = resource('AWS::ElasticLoadBalancingV2::Listener', {
    LoadBalancerArn: ref('LoadBalancer'),
    Port: 80,
    Protocol: 'HTTP',
    DefaultActions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '404' } }],
  });
  r.ProductionRule = resource('AWS::ElasticLoadBalancingV2::ListenerRule', {
    ListenerArn: ref('Listener'),
    Priority: 1,
    Conditions: [{ Field: 'path-pattern', Values: ['/*'] }],
    Actions: [
      {
        Type: 'forward',
        ForwardConfig: {
          TargetGroups: [
            { TargetGroupArn: ref('Blue'), Weight: 1 },
            ...(blueGreen ? [{ TargetGroupArn: ref('Green'), Weight: 0 }] : []),
          ],
        },
      },
    ],
  });
  if (blueGreen)
    r.TrafficRole = role('ecs.amazonaws.com', [
      allow(
        [
          'elasticloadbalancing:DescribeListeners',
          'elasticloadbalancing:DescribeRules',
          'elasticloadbalancing:DescribeTargetGroups',
          'elasticloadbalancing:DescribeTargetHealth',
        ],
        '*',
      ),
      allow(
        ['elasticloadbalancing:RegisterTargets', 'elasticloadbalancing:DeregisterTargets'],
        [ref('Blue'), ref('Green')],
      ),
      allow('elasticloadbalancing:ModifyListener', ref('Listener')),
      allow('elasticloadbalancing:ModifyRule', ref('ProductionRule')),
    ]);
  r.TaskDefinition = resource('AWS::ECS::TaskDefinition', {
    Family: sub('${AWS::StackName}-app'),
    RequiresCompatibilities: ['FARGATE'],
    NetworkMode: 'awsvpc',
    Cpu: '256',
    Memory: '512',
    ExecutionRoleArn: att('TaskExecutionRole'),
    TaskRoleArn: att('TaskRole'),
    ContainerDefinitions: [
      {
        Name: 'app',
        Image: ref('BootstrapImage'),
        Essential: true,
        PortMappings: [{ ContainerPort: ref('ContainerPort'), Protocol: 'tcp' }],
        LogConfiguration: {
          LogDriver: 'awslogs',
          Options: {
            'awslogs-group': ref('AppLogs'),
            'awslogs-region': ref('AWS::Region'),
            'awslogs-stream-prefix': 'app',
          },
        },
      },
    ],
    Tags: tags,
  });
  r.Service = resource(
    'AWS::ECS::Service',
    {
      ServiceName: sub('${AWS::StackName}-app'),
      Cluster: ref('Cluster'),
      TaskDefinition: ref('TaskDefinition'),
      DesiredCount: 1,
      LaunchType: 'FARGATE',
      HealthCheckGracePeriodSeconds: 60,
      EnableECSManagedTags: true,
      PropagateTags: 'SERVICE',
      DeploymentController: { Type: 'ECS' },
      DeploymentConfiguration: blueGreen
        ? {
            Strategy: 'BLUE_GREEN',
            BakeTimeInMinutes: 5,
            MinimumHealthyPercent: 100,
            MaximumPercent: 200,
          }
        : {
            DeploymentCircuitBreaker: { Enable: true, Rollback: true },
            MinimumHealthyPercent: 100,
            MaximumPercent: 200,
          },
      NetworkConfiguration: {
        AwsvpcConfiguration: {
          AssignPublicIp: 'ENABLED',
          Subnets: ref('SubnetIds'),
          SecurityGroups: [ref('TaskGroup')],
        },
      },
      LoadBalancers: [
        {
          ContainerName: 'app',
          ContainerPort: ref('ContainerPort'),
          TargetGroupArn: ref('Blue'),
          ...(blueGreen
            ? {
                AdvancedConfiguration: {
                  AlternateTargetGroupArn: ref('Green'),
                  ProductionListenerRule: ref('ProductionRule'),
                  RoleArn: att('TrafficRole'),
                },
              }
            : {}),
        },
      ],
      Tags: tags,
    },
    blueGreen ? {} : { DependsOn: 'ProductionRule' },
  );
  statements(p).push(
    allow(
      ['ecs:DescribeServices', 'ecs:UpdateService'],
      sub(
        'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:service/${AWS::StackName}-cluster/${AWS::StackName}-app',
      ),
    ),
    allow(['ecs:DescribeTaskDefinition', 'ecs:RegisterTaskDefinition'], '*'),
    allow(
      'ecs:TagResource',
      sub(
        'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:task-definition/${AWS::StackName}-app:*',
      ),
      { StringEquals: { 'ecs:CreateAction': 'RegisterTaskDefinition' } },
    ),
    passRole([att('TaskRole'), att('TaskExecutionRole')], 'ecs-tasks.amazonaws.com'),
  );
  if (blueGreen) statements(p).push(passRole(att('TrafficRole'), 'ecs.amazonaws.com'));
  p.template.Outputs!.ApplicationUrl = { Value: sub('http://${LoadBalancer.DNSName}') };
  p.template.Outputs!.ApplicationRoleArn = { Value: att('TaskRole') };
  return finish(
    p,
    action(
      'Deploy',
      'Deploy',
      'ECS',
      {
        ClusterName: ref('Cluster'),
        ServiceName: att('Service', 'Name'),
        FileName: 'imagedefinitions.json',
        DeploymentTimeout: '30',
      },
      'BuildOutput',
    ),
  );
}

function lambda(codeDeploy: boolean) {
  const id = codeDeploy ? 'lambda-codedeploy' : 'lambda';
  const p = base(id, codeDeploy ? 'Lambda + CodeDeploy canary' : 'Lambda deploy');
  addInput(p, 'Runtime', 'nodejs22.x', { AllowedValues: ['nodejs22.x', 'nodejs24.x'] });
  addInput(p, 'Handler', 'index.handler');
  const r = p.template.Resources;
  r.FunctionLogs = logs(sub('/aws/lambda/${AWS::StackName}-app'));
  r.FunctionRole = role('lambda.amazonaws.com', [logPermissions('FunctionLogs')]);
  r.Function = resource('AWS::Lambda::Function', {
    FunctionName: sub('${AWS::StackName}-app'),
    Runtime: ref('Runtime'),
    Handler: ref('Handler'),
    Role: att('FunctionRole'),
    Timeout: 15,
    MemorySize: 128,
    Code: { ZipFile: lambdaCode },
    Tags: tags,
  });
  r.InitialVersion = resource(
    'AWS::Lambda::Version',
    {
      FunctionName: ref('Function'),
      Description: 'Bootstrap version; application releases are published by the pipeline.',
    },
    { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' },
  );
  r.Live = resource('AWS::Lambda::Alias', {
    FunctionName: ref('Function'),
    FunctionVersion: att('InitialVersion', 'Version'),
    Name: 'live',
  });
  r.Errors = resource('AWS::CloudWatch::Alarm', {
    AlarmDescription: 'Errors on the live Lambda alias',
    Namespace: 'AWS/Lambda',
    MetricName: 'Errors',
    Dimensions: [
      { Name: 'FunctionName', Value: ref('Function') },
      { Name: 'Resource', Value: sub('${Function}:live') },
    ],
    Statistic: 'Sum',
    Period: 60,
    EvaluationPeriods: 1,
    Threshold: 0,
    ComparisonOperator: 'GreaterThanThreshold',
    TreatMissingData: 'notBreaching',
    Tags: tags,
  });
  normalBuild(p);
  p.source = { 'index.js': lambdaCode };
  p.template.Outputs!.FunctionAliasArn = { Value: ref('Live') };
  p.template.Outputs!.ApplicationRoleArn = { Value: att('FunctionRole') };
  const functionArns = [att('Function'), sub('${Function.Arn}:*')];
  if (!codeDeploy) {
    r.ActionLogs = logs(sub('/${AWS::Region}/codepipeline/${AWS::StackName}'));
    statements(p).push(
      logPermissions('ActionLogs'),
      allow('logs:CreateLogGroup', [
        att('ActionLogs'),
        sub(
          'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/${AWS::Region}/codepipeline/${AWS::StackName}',
        ),
      ]),
    );
    statements(p).push(
      allow(
        [
          'lambda:GetFunction',
          'lambda:GetFunctionConfiguration',
          'lambda:UpdateFunctionCode',
          'lambda:PublishVersion',
          'lambda:GetAlias',
          'lambda:UpdateAlias',
          'lambda:ListVersionsByFunction',
          'lambda:GetProvisionedConcurrencyConfig',
        ],
        functionArns,
      ),
      allow('cloudwatch:DescribeAlarms', att('Errors', 'Arn')),
    );
    finish(
      p,
      action(
        'Deploy',
        'Deploy',
        'Lambda',
        {
          FunctionName: ref('Function'),
          FunctionAlias: 'live',
          DeployStrategy: 'Canary10Percent5Minutes',
          Alarms: ref('Errors'),
        },
        'BuildOutput',
      ),
    );
    r.Pipeline.DependsOn = 'Live';
    return p;
  }
  r.DeployApplication = resource('AWS::CodeDeploy::Application', {
    ApplicationName: sub('${AWS::StackName}-app'),
    ComputePlatform: 'Lambda',
  });
  r.CodeDeployRole = role('codedeploy.amazonaws.com', [
    allow(
      ['lambda:GetAlias', 'lambda:UpdateAlias', 'lambda:GetProvisionedConcurrencyConfig'],
      sub('${Function.Arn}:live'),
    ),
    allow('cloudwatch:DescribeAlarms', '*'),
  ]);
  r.DeploymentGroup = resource('AWS::CodeDeploy::DeploymentGroup', {
    ApplicationName: ref('DeployApplication'),
    DeploymentGroupName: 'production',
    ServiceRoleArn: att('CodeDeployRole'),
    DeploymentConfigName: 'CodeDeployDefault.LambdaCanary10Percent5Minutes',
    DeploymentStyle: { DeploymentType: 'BLUE_GREEN', DeploymentOption: 'WITH_TRAFFIC_CONTROL' },
    AutoRollbackConfiguration: {
      Enabled: true,
      Events: ['DEPLOYMENT_FAILURE', 'DEPLOYMENT_STOP_ON_ALARM', 'DEPLOYMENT_STOP_ON_REQUEST'],
    },
    AlarmConfiguration: {
      Enabled: true,
      IgnorePollAlarmFailure: false,
      Alarms: [{ Name: ref('Errors') }],
    },
    Tags: tags,
  });
  const deployment = deployProject(
    p,
    [
      'CURRENT=$(aws lambda get-alias --function-name "$FUNCTION_NAME" --name live --query FunctionVersion --output text)',
      'zip -qr /tmp/function.zip .',
      'TARGET=$(aws lambda update-function-code --function-name "$FUNCTION_NAME" --zip-file fileb:///tmp/function.zip --publish --query Version --output text)',
      'aws lambda wait function-updated-v2 --function-name "$FUNCTION_NAME"',
      'APPSPEC=$(jq -nc --arg name "$FUNCTION_NAME" --arg current "$CURRENT" --arg target "$TARGET" \'{version:0.0,Resources:[{Function:{Type:"AWS::Lambda::Function",Properties:{Name:$name,Alias:"live",CurrentVersion:$current,TargetVersion:$target}}}]}\')',
      'REVISION=$(jq -nc --arg content "$APPSPEC" \'{revisionType:"AppSpecContent",appSpecContent:{content:$content}}\')',
      'DEPLOYMENT_ID=$(aws deploy create-deployment --application-name "$APPLICATION_NAME" --deployment-group-name production --revision "$REVISION" --query deploymentId --output text)',
      'for attempt in $(seq 1 150); do STATUS=$(aws deploy get-deployment --deployment-id "$DEPLOYMENT_ID" --query deploymentInfo.status --output text); case "$STATUS" in Succeeded) exit 0 ;; Failed|Stopped) aws deploy get-deployment --deployment-id "$DEPLOYMENT_ID"; exit 1 ;; esac; sleep 10; done; aws deploy stop-deployment --deployment-id "$DEPLOYMENT_ID" --auto-rollback-enabled; exit 1',
    ],
    [
      allow(
        ['lambda:GetAlias', 'lambda:UpdateFunctionCode', 'lambda:GetFunctionConfiguration'],
        functionArns,
      ),
      allow(
        ['codedeploy:CreateDeployment', 'codedeploy:GetDeploymentGroup'],
        sub(
          'arn:${AWS::Partition}:codedeploy:${AWS::Region}:${AWS::AccountId}:deploymentgroup:${AWS::StackName}-app/production',
        ),
      ),
      allow(
        [
          'codedeploy:GetApplication',
          'codedeploy:GetApplicationRevision',
          'codedeploy:RegisterApplicationRevision',
        ],
        sub(
          'arn:${AWS::Partition}:codedeploy:${AWS::Region}:${AWS::AccountId}:application:${AWS::StackName}-app',
        ),
      ),
      allow(
        'codedeploy:GetDeploymentConfig',
        sub(
          'arn:${AWS::Partition}:codedeploy:${AWS::Region}:${AWS::AccountId}:deploymentconfig:CodeDeployDefault.LambdaCanary10Percent5Minutes',
        ),
      ),
      allow(['codedeploy:GetDeployment', 'codedeploy:StopDeployment'], '*'),
    ],
    [env('FUNCTION_NAME', ref('Function')), env('APPLICATION_NAME', ref('DeployApplication'))],
  );
  // The deployment project is independent of the group, so wait for the group before the first pipeline run.
  finish(p, deployment);
  r.Pipeline.DependsOn = ['DeploymentGroup', 'Live'];
  return p;
}

function ec2() {
  const p = base('ec2', 'EC2 + CodeDeploy');
  networkInputs(p, false);
  addInput(p, 'InstanceType', 't3.micro');
  addInput(p, 'AmiId', '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64', {
    Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',
  });
  const r = p.template.Resources;
  r.InstanceRole = role('ec2.amazonaws.com', [
    allow(['s3:GetObject', 's3:GetObjectVersion'], sub('${Artifacts.Arn}/*')),
  ]);
  r.InstanceProfile = resource('AWS::IAM::InstanceProfile', { Roles: [ref('InstanceRole')] });
  r.InstanceGroup = resource('AWS::EC2::SecurityGroup', {
    GroupDescription: 'HTTP only; no inbound SSH',
    VpcId: ref('VpcId'),
    SecurityGroupIngress: [
      { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, CidrIp: ref('ClientCidr') },
    ],
    SecurityGroupEgress: [{ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }],
    Tags: tags,
  });
  r.Instance = resource(
    'AWS::EC2::Instance',
    {
      ImageId: ref('AmiId'),
      InstanceType: ref('InstanceType'),
      IamInstanceProfile: ref('InstanceProfile'),
      MetadataOptions: {
        HttpTokens: 'required',
        HttpEndpoint: 'enabled',
        HttpPutResponseHopLimit: 1,
      },
      NetworkInterfaces: [
        {
          DeviceIndex: '0',
          AssociatePublicIpAddress: true,
          SubnetId: ref('SubnetId'),
          GroupSet: [ref('InstanceGroup')],
        },
      ],
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/xvda',
          Ebs: { VolumeSize: 12, VolumeType: 'gp3', Encrypted: true, DeleteOnTermination: true },
        },
      ],
      Tags: [...tags, { Key: 'CodeDeployTarget', Value: ref('AWS::StackName') }],
      UserData: {
        'Fn::Base64': sub(`#!/bin/bash
set -euo pipefail
dnf install -y aws-cfn-bootstrap
trap '/opt/aws/bin/cfn-signal -e $? --stack \${AWS::StackName} --resource Instance --region \${AWS::Region}' EXIT
dnf install -y wget ruby nginx
cd /tmp
wget -q https://aws-codedeploy-\${AWS::Region}.s3.\${AWS::Region}.\${AWS::URLSuffix}/latest/install -O install-codedeploy
chmod 0700 install-codedeploy
./install-codedeploy auto
systemctl enable --now codedeploy-agent nginx
systemctl is-active --quiet codedeploy-agent
curl --fail --retry 5 --retry-delay 2 http://127.0.0.1/
`),
      },
    },
    { CreationPolicy: { ResourceSignal: { Count: 1, Timeout: 'PT15M' } } },
  );
  r.DeployApplication = resource('AWS::CodeDeploy::Application', {
    ApplicationName: sub('${AWS::StackName}-app'),
    ComputePlatform: 'Server',
  });
  r.CodeDeployRole = role('codedeploy.amazonaws.com', [
    allow(['ec2:DescribeInstances', 'ec2:DescribeInstanceStatus', 'tag:GetResources'], '*'),
  ]);
  r.DeploymentGroup = resource('AWS::CodeDeploy::DeploymentGroup', {
    ApplicationName: ref('DeployApplication'),
    DeploymentGroupName: 'production',
    ServiceRoleArn: att('CodeDeployRole'),
    Ec2TagFilters: [
      { Key: 'CodeDeployTarget', Value: ref('AWS::StackName'), Type: 'KEY_AND_VALUE' },
    ],
    DeploymentConfigName: 'CodeDeployDefault.OneAtATime',
    DeploymentStyle: { DeploymentType: 'IN_PLACE', DeploymentOption: 'WITHOUT_TRAFFIC_CONTROL' },
    AutoRollbackConfiguration: { Enabled: true, Events: ['DEPLOYMENT_FAILURE'] },
    Tags: tags,
  });
  statements(p).push(
    allow(
      ['codedeploy:CreateDeployment', 'codedeploy:GetDeploymentGroup'],
      sub(
        'arn:${AWS::Partition}:codedeploy:${AWS::Region}:${AWS::AccountId}:deploymentgroup:${AWS::StackName}-app/production',
      ),
    ),
    allow(
      [
        'codedeploy:GetApplication',
        'codedeploy:GetApplicationRevision',
        'codedeploy:RegisterApplicationRevision',
      ],
      sub(
        'arn:${AWS::Partition}:codedeploy:${AWS::Region}:${AWS::AccountId}:application:${AWS::StackName}-app',
      ),
    ),
    allow(
      'codedeploy:GetDeploymentConfig',
      sub(
        'arn:${AWS::Partition}:codedeploy:${AWS::Region}:${AWS::AccountId}:deploymentconfig:CodeDeployDefault.OneAtATime',
      ),
    ),
    allow('codedeploy:GetDeployment', '*'),
  );
  normalBuild(p);
  p.source = {
    'site/index.html': html,
    'appspec.yml':
      'version: 0.0\nos: linux\nfiles:\n  - source: site/\n    destination: /usr/share/nginx/html\nfile_exists_behavior: OVERWRITE\nhooks:\n  AfterInstall:\n    - location: scripts/reload.sh\n      timeout: 60\n      runas: root\n',
    'scripts/reload.sh':
      '#!/bin/bash\nset -euo pipefail\nnginx -t\nsystemctl reload nginx\ncurl --fail --retry 5 --retry-delay 2 http://127.0.0.1/\n',
  };
  p.template.Outputs!.ApplicationUrl = { Value: sub('http://${Instance.PublicDnsName}') };
  finish(
    p,
    action(
      'Deploy',
      'Deploy',
      'CodeDeploy',
      { ApplicationName: ref('DeployApplication'), DeploymentGroupName: ref('DeploymentGroup') },
      'BuildOutput',
    ),
  );
  r.Pipeline.DependsOn = 'Instance';
  return p;
}

function cloudformation() {
  const p = base('cloudformation', 'CloudFormation workload');
  addInput(p, 'WorkloadStackName', 'my-workload');
  addInput(
    p,
    'WorkloadActions',
    's3:CreateBucket,s3:DeleteBucket,s3:Get*,s3:ListBucket,s3:PutBucketTagging,s3:PutBucketPublicAccessBlock,s3:PutEncryptionConfiguration,s3:PutBucketVersioning,s3:PutBucketOwnershipControls,s3:PutLifecycleConfiguration',
    { Type: 'CommaDelimitedList' },
  );
  addInput(p, 'WorkloadResources', 'arn:aws:s3:::my-workload-111122223333-eu-central-1', {
    Type: 'CommaDelimitedList',
  });
  const r = p.template.Resources;
  r.WorkloadRole = role('cloudformation.amazonaws.com', [
    allow(ref('WorkloadActions'), ref('WorkloadResources')),
  ]);
  statements(p).push(
    allow(
      [
        'cloudformation:CreateStack',
        'cloudformation:UpdateStack',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:DescribeStackResources',
        'cloudformation:GetTemplate',
        'cloudformation:SetStackPolicy',
      ],
      sub(
        'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${WorkloadStackName}/*',
      ),
    ),
    allow('cloudformation:ValidateTemplate', '*'),
    passRole(att('WorkloadRole'), 'cloudformation.amazonaws.com'),
  );
  normalBuild(p);
  p.source = {
    'template.yaml': stringify(
      {
        AWSTemplateFormatVersion: '2010-09-09',
        Resources: {
          Data: bucket({
            BucketName: sub('${AWS::StackName}-${AWS::AccountId}-${AWS::Region}'),
            Tags: [{ Key: 'Project', Value: ref('AWS::StackName') }],
          }),
        },
        Outputs: { BucketName: { Value: ref('Data') } },
      },
      { aliasDuplicateObjects: false },
    ),
  };
  p.template.Outputs!.WorkloadRoleArn = { Value: att('WorkloadRole') };
  return finish(
    p,
    action(
      'Deploy',
      'Deploy',
      'CloudFormation',
      {
        ActionMode: 'CREATE_UPDATE',
        StackName: ref('WorkloadStackName'),
        RoleArn: att('WorkloadRole'),
        TemplatePath: 'BuildOutput::template.yaml',
      },
      'BuildOutput',
    ),
  );
}

export const pipelineRecipes: PipelineTemplate[] = [
  commands(),
  s3(),
  ecr(),
  ecs(false),
  ecs(true),
  ec2(),
  lambda(false),
  lambda(true),
  cloudformation(),
];

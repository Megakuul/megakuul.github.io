const root = '/downloads/cloud-init/';
export const cloudConfigs = [
  { id: 'nginx', title: 'Nginx', file: 'nginx.yaml' },
  { id: 'nginx-s3', title: 'Nginx S3', file: 'nginx-s3.yaml' },
  {
    id: 'node-s3',
    title: 'Node.js',
    file: 'node-s3.yaml',
  },
  { id: 'python-s3', title: 'Python', file: 'python-s3.yaml' },
  { id: 'java-s3', title: 'Java', file: 'java-s3.yaml' },
  {
    id: 'binary-s3',
    title: 'Go / Rust',
    file: 'binary-s3.yaml',
  },
  {
    id: 'ecr-container',
    title: 'ECR Container',
    file: 'ecr-container.yaml',
  },
  {
    id: 'ecs-host',
    title: 'ECS Host',
    file: 'ecs-host.yaml',
  },
].map(snippet => ({ ...snippet, download: root + snippet.file }));

/** @param {...Record<string, unknown>} Statement */
const document = (...Statement) => JSON.stringify({ Version: '2012-10-17', Statement }, null, 2);
export const commands = [
  {
    id: 'launch-env',
    title: 'Environment',
    lang: 'bash',
    code: 'export REGION=eu-central-1 NAME=my-app INSTANCE_PROFILE=my-ec2-role SUBNET_ID=subnet-0123456789abcdef0 SECURITY_GROUP_ID=sg-0123456789abcdef0 INSTANCE_TYPE=t3.small USER_DATA_FILE=./node-s3.yaml AMI_PARAMETER=/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 TAG_KEY=Project TAG_VALUE=my-app',
  },
  {
    id: 'ecs-ami',
    title: 'ECS AMI',
    lang: 'bash',
    code: 'export AMI_PARAMETER=/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id INSTANCE_PROFILE=my-ecs-instance-role USER_DATA_FILE=./ecs-host.yaml',
  },
  {
    id: 'launch',
    title: 'Launch',
    lang: 'bash',
    code: 'AMI_ID=$(aws ssm get-parameter --region "${REGION:?}" --name "${AMI_PARAMETER:?}" --query Parameter.Value --output text) && TAG_SPEC=$(python3 -c \'import json,os; tags={"Name":os.environ["NAME"],os.environ["TAG_KEY"]:os.environ["TAG_VALUE"]}; print(json.dumps([{"ResourceType":t,"Tags":[{"Key":k,"Value":v} for k,v in tags.items()]} for t in ["instance","volume","network-interface"]]))\') && aws ec2 run-instances --region "$REGION" --image-id "$AMI_ID" --instance-type "${INSTANCE_TYPE:?}" --count 1 --iam-instance-profile "Name=${INSTANCE_PROFILE:?}" --subnet-id "${SUBNET_ID:?}" --security-group-ids "${SECURITY_GROUP_ID:?}" --no-associate-public-ip-address --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1,InstanceMetadataTags=disabled --block-device-mappings \'[{"DeviceName":"/dev/xvda","Ebs":{"Encrypted":true,"VolumeType":"gp3","VolumeSize":30,"DeleteOnTermination":true}}]\' --tag-specifications "$TAG_SPEC" --user-data "file://${USER_DATA_FILE:?}" --query "Instances[0].InstanceId" --output text',
  },
  {
    id: 'upload',
    title: 'Upload Artifact',
    lang: 'bash',
    code: 'export REGION=eu-central-1 BUCKET=my-artifacts-111122223333 OBJECT_KEY=node/server.mjs ARTIFACT=./server.mjs && aws s3 cp "$ARTIFACT" "s3://$BUCKET/$OBJECT_KEY" --region "$REGION" --only-show-errors',
  },
  {
    id: 'upload-site',
    title: 'Upload Website',
    lang: 'bash',
    code: 'export REGION=eu-central-1 BUCKET=my-artifacts-111122223333 PREFIX=website/ && aws s3 sync ./website/ "s3://$BUCKET/$PREFIX" --region "$REGION" --only-show-errors --no-follow-symlinks',
  },
];
export const policies = [
  {
    id: 's3-object-policy',
    title: 'S3 Read',
    lang: 'json',
    code: document({
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:GetObjectVersion'],
      Resource: 'arn:aws:s3:::my-artifacts-111122223333/node/server.mjs',
    }),
  },
  {
    id: 's3-site-policy',
    title: 'S3 Website Read',
    lang: 'json',
    code: document(
      {
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: 'arn:aws:s3:::my-artifacts-111122223333',
        Condition: { StringLike: { 's3:prefix': ['website/', 'website/*'] } },
      },
      {
        Effect: 'Allow',
        Action: 's3:GetObject',
        Resource: 'arn:aws:s3:::my-artifacts-111122223333/website/*',
      },
    ),
  },
  {
    id: 'kms-policy',
    title: 'KMS Decrypt',
    lang: 'json',
    code: document({
      Effect: 'Allow',
      Action: 'kms:Decrypt',
      Resource: 'arn:aws:kms:eu-central-1:111122223333:key/12345678-1234-1234-1234-123456789abc',
      Condition: {
        StringEquals: { 'kms:ViaService': 's3.eu-central-1.amazonaws.com' },
        StringLike: {
          'kms:EncryptionContext:aws:s3:arn': [
            'arn:aws:s3:::my-artifacts-111122223333',
            'arn:aws:s3:::my-artifacts-111122223333/*',
          ],
        },
      },
    }),
  },
  {
    id: 'ecr-policy',
    title: 'ECR Pull',
    lang: 'json',
    code: document(
      { Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
      {
        Effect: 'Allow',
        Action: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
        ],
        Resource: 'arn:aws:ecr:eu-central-1:111122223333:repository/my-app',
      },
    ),
  },
];
export const operations = [
  {
    id: 'boot-status',
    title: 'Boot Status',
    lang: 'bash',
    code: 'sudo cloud-init status --wait; sudo tail -n 100 /var/log/cloud-init-output.log; sudo journalctl -u cloud-final -b --no-pager -n 100',
  },
  {
    id: 'app-logs',
    title: 'App Logs',
    lang: 'bash',
    code: 'sudo systemctl status app --no-pager; sudo journalctl -u app -f -n 100',
  },
  {
    id: 'nginx-logs',
    title: 'Nginx Logs',
    lang: 'bash',
    code: 'sudo nginx -t && sudo systemctl status nginx --no-pager; sudo tail -F /var/log/nginx/access.log /var/log/nginx/error.log',
  },
  {
    id: 'container-logs',
    title: 'Container Logs',
    lang: 'bash',
    code: 'sudo docker ps -a --filter name=app; sudo docker logs --tail 100 -f app',
  },
  {
    id: 'ecs-logs',
    title: 'ECS Logs',
    lang: 'bash',
    code: 'sudo systemctl status ecs --no-pager; sudo tail -n 100 /var/log/ecs/ecs-agent.log',
  },
  {
    id: 'app-restart',
    title: 'Restart App',
    lang: 'bash',
    code: 'sudo systemctl restart app && sudo systemctl is-active app',
  },
];

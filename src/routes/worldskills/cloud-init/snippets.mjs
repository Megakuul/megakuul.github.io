const root = '/downloads/cloud-init/';
export const cloudConfigs = [
  { id: 'nginx', title: 'Nginx · HTTP :8080', file: 'nginx.yaml' },
  { id: 'nginx-s3', title: 'Nginx · S3 website/ → HTTP :8080', file: 'nginx-s3.yaml' },
  {
    id: 'node-s3',
    title: 'Node.js 24 · S3 server.mjs · bundle dependencies into the file',
    file: 'node-s3.yaml',
  },
  { id: 'python-s3', title: 'Python 3 · S3 worker.py · standard library', file: 'python-s3.yaml' },
  { id: 'java-s3', title: 'Java 21 · S3 app.jar · executable JAR', file: 'java-s3.yaml' },
  {
    id: 'binary-s3',
    title: 'Go / Rust · S3 server · Linux binary matching the AMI architecture',
    file: 'binary-s3.yaml',
  },
  {
    id: 'ecr-container',
    title: 'ECR container · UID 10001 · read-only · HTTP :8080',
    file: 'ecr-container.yaml',
  },
  {
    id: 'ecs-host',
    title: 'ECS host · ECS-optimized AL2023 AMI · ecs-instance role',
    file: 'ecs-host.yaml',
  },
].map(snippet => ({ ...snippet, download: root + snippet.file }));

/** @param {...Record<string, unknown>} Statement */
const document = (...Statement) => JSON.stringify({ Version: '2012-10-17', Statement }, null, 2);
export const commands = [
  {
    id: 'launch-env',
    title: 'Launch inputs · existing instance profile / subnet / security group',
    lang: 'bash',
    code: 'export REGION=eu-central-1 NAME=my-app INSTANCE_PROFILE=my-ec2-role SUBNET_ID=subnet-0123456789abcdef0 SECURITY_GROUP_ID=sg-0123456789abcdef0 INSTANCE_TYPE=t3.small USER_DATA_FILE=./node-s3.yaml AMI_PARAMETER=/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 TAG_KEY=Project TAG_VALUE=my-app',
  },
  {
    id: 'ecs-ami',
    title: 'ECS host · select optimized AMI instead',
    lang: 'bash',
    code: 'export AMI_PARAMETER=/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id INSTANCE_PROFILE=my-ecs-instance-role USER_DATA_FILE=./ecs-host.yaml',
  },
  {
    id: 'launch',
    title: 'Launch · private IPv4 · IMDSv2 · encrypted root · outbound HTTPS / endpoints required',
    lang: 'bash',
    code: 'AMI_ID=$(aws ssm get-parameter --region "${REGION:?}" --name "${AMI_PARAMETER:?}" --query Parameter.Value --output text) && TAG_SPEC=$(python3 -c \'import json,os; tags={"Name":os.environ["NAME"],os.environ["TAG_KEY"]:os.environ["TAG_VALUE"]}; print(json.dumps([{"ResourceType":t,"Tags":[{"Key":k,"Value":v} for k,v in tags.items()]} for t in ["instance","volume","network-interface"]]))\') && aws ec2 run-instances --region "$REGION" --image-id "$AMI_ID" --instance-type "${INSTANCE_TYPE:?}" --count 1 --iam-instance-profile "Name=${INSTANCE_PROFILE:?}" --subnet-id "${SUBNET_ID:?}" --security-group-ids "${SECURITY_GROUP_ID:?}" --no-associate-public-ip-address --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1,InstanceMetadataTags=disabled --block-device-mappings \'[{"DeviceName":"/dev/xvda","Ebs":{"Encrypted":true,"VolumeType":"gp3","VolumeSize":30,"DeleteOnTermination":true}}]\' --tag-specifications "$TAG_SPEC" --user-data "file://${USER_DATA_FILE:?}" --query "Instances[0].InstanceId" --output text',
  },
  {
    id: 'upload',
    title: 'Upload artifact · match BUCKET / OBJECT_KEY inside the YAML',
    lang: 'bash',
    code: 'export REGION=eu-central-1 BUCKET=my-artifacts-111122223333 OBJECT_KEY=node/server.mjs ARTIFACT=./server.mjs && aws s3 cp "$ARTIFACT" "s3://$BUCKET/$OBJECT_KEY" --region "$REGION" --only-show-errors',
  },
  {
    id: 'upload-site',
    title: 'Upload website · match BUCKET / PREFIX inside the YAML',
    lang: 'bash',
    code: 'export REGION=eu-central-1 BUCKET=my-artifacts-111122223333 PREFIX=website/ && aws s3 sync ./website/ "s3://$BUCKET/$PREFIX" --region "$REGION" --only-show-errors --no-follow-symlinks',
  },
];
export const policies = [
  {
    id: 's3-object-policy',
    title: 'Instance role · read one S3 artifact / version',
    lang: 'json',
    code: document({
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:GetObjectVersion'],
      Resource: 'arn:aws:s3:::my-artifacts-111122223333/node/server.mjs',
    }),
  },
  {
    id: 's3-site-policy',
    title: 'Instance role · read website/ only',
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
    title: 'Instance role · optional S3 customer-managed KMS key',
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
    title: 'Instance role · pull one ECR repository',
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
    title: 'On instance · cloud-init status / boot errors',
    lang: 'bash',
    code: 'sudo cloud-init status --wait; sudo tail -n 100 /var/log/cloud-init-output.log; sudo journalctl -u cloud-final -b --no-pager -n 100',
  },
  {
    id: 'app-logs',
    title: 'On instance · app status / live logs',
    lang: 'bash',
    code: 'sudo systemctl status app --no-pager; sudo journalctl -u app -f -n 100',
  },
  {
    id: 'nginx-logs',
    title: 'On instance · Nginx status / live logs',
    lang: 'bash',
    code: 'sudo nginx -t && sudo systemctl status nginx --no-pager; sudo tail -F /var/log/nginx/access.log /var/log/nginx/error.log',
  },
  {
    id: 'container-logs',
    title: 'On instance · container status / live logs',
    lang: 'bash',
    code: 'sudo docker ps -a --filter name=app; sudo docker logs --tail 100 -f app',
  },
  {
    id: 'ecs-logs',
    title: 'On instance · ECS agent status / logs',
    lang: 'bash',
    code: 'sudo systemctl status ecs --no-pager; sudo tail -n 100 /var/log/ecs/ecs-agent.log',
  },
  {
    id: 'app-restart',
    title: 'On instance · restart application',
    lang: 'bash',
    code: 'sudo systemctl restart app && sudo systemctl is-active app',
  },
];

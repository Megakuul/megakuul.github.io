import { shellQuote, awsRegionSetup, fixedSettings } from './generators.mjs';

/** @param {string[]} commands */
const chain = commands => commands.join(' && ');
/** @param {string} action @param {string} id @param {string} [extra] */
const payload = (action, id, extra = '') =>
  `p ${action} ${id}${extra ? ' ' + extra : ''} > "$d/request.json"`;
/** @param {string} action @param {string} id @param {string} command @param {string} [output] */
const call = (action, id, command, output = '/dev/null') =>
  chain([
    payload(action, id),
    `aws ${command} --cli-input-json "file://$d/request.json" > ${output}`,
  ]);
/** @param {string} action @param {string} id @param {string} expected @param {string} command @param {string} [resultId] */
const create = (action, id, expected, command, resultId = id) =>
  chain([payload(action, id), `create ${expected} ${resultId} ${command}`]);

/** @param {Record<string, any>} source @param {string} kind @param {string} renderer */
export function directDeploymentCommand(source, kind, renderer) {
  const template = structuredClone(source);
  for (const key of ['ResourceTagger', 'ResourceTaggerRole', 'ResourceTaggerLogs', 'ResourceTags'])
    delete template.Resources[key];
  if (kind === 'security-groups') {
    template.Resources = {
      SecurityGroup:
        template.Resources['Fn::ForEach::SecurityGroups'][2]['SecurityGroup&{GroupName}'],
    };
    delete template.Transform;
  }
  const steps = [
    'set -euo pipefail',
    awsRegionSetup,
    'export AWS_PAGER="" AWS_DEFAULT_REGION="$REGION" AWS_REGION="$REGION" AWS_DEFAULT_OUTPUT=json',
    'd=$(mktemp -d)',
    `trap ${shellQuote('rm -rf "$d"')} EXIT`,
    `printf %s ${shellQuote(JSON.stringify(template))} > "$d/template.json"`,
    `python3 -c ${shellQuote('import json,sys; open(sys.argv[2],"w").write(json.loads(sys.argv[1]))')} ${shellQuote(JSON.stringify(renderer))} "$d/render.py"`,
    'p() { python3 "$d/render.py" "$d" "$@"; }',
    'create() { local expected=$1 id=$2 attempt rc err; shift 2; created=0; for ((attempt=0; attempt<8; attempt++)); do if aws "$@" --cli-input-json "file://$d/request.json" > "$d/$id.json" 2> "$d/error"; then created=1; return 0; else rc=$?; err=$(cat "$d/error"); if [[ "$err" == *"($expected)"* ]]; then return 0; elif [[ "$err" == *"cannot be assumed by Lambda"* && "$attempt" -lt 7 ]]; then sleep 3; else printf "%s\\n" "$err" >&2; return "$rc"; fi; fi; done; }',
    'retry() { local expected=$1 attempt rc err; shift; for ((attempt=0; attempt<8; attempt++)); do if aws "$@" --cli-input-json "file://$d/request.json" > "$d/retry.json" 2> "$d/error"; then return 0; else rc=$?; err=$(cat "$d/error"); if [[ "$err" == *"($expected)"* && "$attempt" -lt 7 ]]; then sleep 3; else printf "%s\\n" "$err" >&2; return "$rc"; fi; fi; done; }',
    'aws sts get-caller-identity > "$d/identity.json"',
    'p init',
  ];
  if (kind === 'config')
    steps.push(
      'aws configservice describe-configuration-recorders > "$d/existing.json"',
      'RECORDER=$(p existing-config)',
      'export RECORDER',
      `if [ -n "$RECORDER" ]; then ${chain([
        'p config-existing-tag > "$d/request.json"',
        'aws configservice tag-resource --cli-input-json "file://$d/request.json"',
        'aws configservice start-configuration-recorder --configuration-recorder-name "$RECORDER"',
        'aws configservice describe-configuration-recorder-status --configuration-recorder-names "$RECORDER"',
      ])}; exit $?; fi`,
    );
  if (kind === 'security-groups') {
    steps.push(
      `while IFS= read -r -d '' SG_NAME; do export SG_NAME && ${chain([
        create('sg-create', 'SecurityGroup', 'InvalidGroup.Duplicate', 'ec2 create-security-group'),
        call('sg-find', 'SecurityGroup', 'ec2 describe-security-groups', '"$d/SecurityGroup.json"'),
        'p sg-check SecurityGroup',
        create(
          'sg-revoke-4',
          'SecurityGroup',
          'InvalidPermission.NotFound',
          'ec2 revoke-security-group-egress',
          'SecurityGroupRule',
        ),
        create(
          'sg-revoke-6',
          'SecurityGroup',
          'InvalidPermission.NotFound',
          'ec2 revoke-security-group-egress',
          'SecurityGroupRule',
        ),
        create(
          'sg-authorize-80',
          'SecurityGroup',
          'InvalidPermission.Duplicate',
          'ec2 authorize-security-group-egress',
          'SecurityGroupRule',
        ),
        create(
          'sg-authorize-443',
          'SecurityGroup',
          'InvalidPermission.Duplicate',
          'ec2 authorize-security-group-egress',
          'SecurityGroupRule',
        ),
        call('sg-tag', 'SecurityGroup', 'ec2 create-tags'),
        'p outputs SecurityGroup',
      ])} || exit $?; done < "$d/names"`,
    );
  } else {
    for (const [id, resource] of Object.entries(template.Resources)) {
      const p = resource.Properties ?? {};
      /** @type {string[]} */
      const resourceSteps = [];
      switch (resource.Type) {
        case 'AWS::Logs::LogGroup':
          resourceSteps.push(
            create('log-create', id, 'ResourceAlreadyExistsException', 'logs create-log-group'),
            call('log-protect', id, 'logs put-log-group-deletion-protection'),
            call('log-retention', id, 'logs put-retention-policy'),
            call('log-tag', id, 'logs tag-resource'),
          );
          break;
        case 'AWS::IAM::Role':
          resourceSteps.push(
            create('role-create', id, 'EntityAlreadyExists', 'iam create-role'),
            call('role-trust', id, 'iam update-assume-role-policy'),
            call('role-tag', id, 'iam tag-role'),
          );
          for (let i = 0; i < (p.Policies?.length ?? 0); i++)
            resourceSteps.push(
              chain([
                payload('role-policy', id, String(i)),
                'aws iam put-role-policy --cli-input-json "file://$d/request.json"',
              ]),
            );
          for (let i = 0; i < (p.ManagedPolicyArns?.length ?? 0); i++)
            resourceSteps.push(
              chain([
                payload('role-attach', id, String(i)),
                'aws iam attach-role-policy --cli-input-json "file://$d/request.json"',
              ]),
            );
          break;
        case 'AWS::IAM::InstanceProfile':
          resourceSteps.push(
            create('profile-create', id, 'EntityAlreadyExists', 'iam create-instance-profile'),
            `n=$(p value ${id})`,
            `aws iam get-instance-profile --instance-profile-name "$n" > "$d/${id}.json"`,
            payload('profile-add', id),
            'if [ "$(cat "$d/request.json")" != null ]; then aws iam add-role-to-instance-profile --cli-input-json "file://$d/request.json"; fi',
            call('profile-tag', id, 'iam tag-instance-profile'),
          );
          break;
        case 'AWS::Logs::ResourcePolicy':
          resourceSteps.push(call('log-policy', id, 'logs put-resource-policy'));
          break;
        case 'AWS::Logs::DeliveryDestination':
          resourceSteps.push(
            call('delivery-put', id, 'logs put-delivery-destination', `"$d/${id}.json"`),
            call('delivery-tag', id, 'logs tag-resource'),
          );
          break;
        case 'AWS::WAFv2::WebACL':
          resourceSteps.push(
            create('waf-create', id, 'WAFDuplicateItemException', 'wafv2 create-web-acl'),
            'if [ "$created" = 0 ]; then aws wafv2 list-web-acls --scope REGIONAL > "$d/waf-list.json"; fi',
            call('waf-get', id, 'wafv2 get-web-acl', `"$d/${id}.json"`),
            call('waf-update', id, 'wafv2 update-web-acl'),
            call('waf-tag', id, 'wafv2 tag-resource'),
          );
          break;
        case 'AWS::WAFv2::LoggingConfiguration':
          resourceSteps.push(call('waf-logging', id, 'wafv2 put-logging-configuration'));
          break;
        case 'AWS::SQS::Queue':
          resourceSteps.push(create('queue-create', id, 'QueueNameExists', 'sqs create-queue'));
          resourceSteps.push(
            `if [ "$created" = 0 ]; then aws sqs get-queue-url --queue-name "$NAME" > "$d/${id}.json"; fi`,
            call('queue-set', id, 'sqs set-queue-attributes'),
            call('queue-tag', id, 'sqs tag-queue'),
          );
          break;
        case 'AWS::SQS::QueuePolicy':
          resourceSteps.push(call('queue-policy', id, 'sqs set-queue-attributes'));
          break;
        case 'AWS::IAM::ManagedPolicy':
          resourceSteps.push(
            create('policy-create', id, 'EntityAlreadyExists', 'iam create-policy'),
            `r=$(p arn ${id})`,
            `aws iam get-policy --policy-arn "$r" > "$d/${id}.json"`,
            `version=$(p field ${id} Policy.DefaultVersionId)`,
            `aws iam get-policy-version --policy-arn "$r" --version-id "$version" > "$d/${id}.json"`,
            `p policy-check ${id}`,
            call('policy-tag', id, 'iam tag-policy'),
            payload('policy-attach', id),
            'if [ "$(cat "$d/request.json")" != null ]; then aws iam attach-role-policy --cli-input-json "file://$d/request.json"; fi',
          );
          break;
        case 'AWS::S3::Bucket':
          resourceSteps.push(
            create('bucket-create', id, 'BucketAlreadyOwnedByYou', 's3api create-bucket'),
            call('bucket-public', id, 's3api put-public-access-block'),
            call('bucket-ownership', id, 's3api put-bucket-ownership-controls'),
            call('bucket-encryption', id, 's3api put-bucket-encryption'),
            call('bucket-versioning', id, 's3api put-bucket-versioning'),
            call('bucket-tag', id, 's3api put-bucket-tagging'),
          );
          break;
        case 'AWS::S3::BucketPolicy':
          resourceSteps.push(call('bucket-policy', id, 's3api put-bucket-policy'));
          break;
        case 'AWS::Config::ConfigurationRecorder':
          resourceSteps.push(
            chain([
              payload('config-put', id),
              'retry InvalidRoleException configservice put-configuration-recorder',
            ]),
            `n=$(p value ${id})`,
            `aws configservice describe-configuration-recorders --configuration-recorder-names "$n" > "$d/${id}.json"`,
            call('config-tag', id, 'configservice tag-resource'),
          );
          break;
        case 'AWS::Config::DeliveryChannel':
          resourceSteps.push(
            chain([
              payload('channel-put', id),
              'retry InsufficientDeliveryPolicyException configservice put-delivery-channel',
            ]),
            'aws configservice start-configuration-recorder --configuration-recorder-name "$NAME"',
          );
          break;
        case 'AWS::Lambda::Function':
          resourceSteps.push(
            create(
              'lambda-create',
              id,
              'ResourceConflictException',
              'lambda create-function --zip-file "fileb://$d/function.zip"',
            ),
            `n=$(p value ${id})`,
            `aws lambda wait function-active-v2 --function-name "$n"`,
            `if [ "$created" = 0 ]; then ${chain([
              call('lambda-update', id, 'lambda update-function-configuration'),
              'aws lambda wait function-updated-v2 --function-name "$n"',
              'aws lambda update-function-code --function-name "$n" --zip-file "fileb://$d/function.zip" > /dev/null',
              'aws lambda wait function-updated-v2 --function-name "$n"',
            ])}; fi`,
            call('lambda-concurrency', id, 'lambda put-function-concurrency'),
            call('lambda-tag', id, 'lambda tag-resource'),
          );
          break;
        case 'AWS::Lambda::EventInvokeConfig':
          resourceSteps.push(
            call('lambda-invoke-config', id, 'lambda put-function-event-invoke-config'),
          );
          break;
        case 'AWS::Events::Rule':
          resourceSteps.push(
            call('rule-put', id, 'events put-rule'),
            call('rule-tag', id, 'events tag-resource'),
            call('rule-targets', id, 'events put-targets', `"$d/${id}.json"`),
            `p targets-check ${id}`,
          );
          break;
        case 'AWS::Lambda::Permission':
          resourceSteps.push(
            create('lambda-permission', id, 'ResourceConflictException', 'lambda add-permission'),
            `if [ "$created" = 0 ]; then n=$(p value Collector) && aws lambda remove-permission --function-name "$n" --statement-id "$NAME-${id}" && aws lambda add-permission --cli-input-json "file://$d/request.json" > /dev/null; fi`,
          );
          break;
        case 'AWS::SNS::Topic':
          resourceSteps.push(
            call('topic-create', id, 'sns create-topic'),
            call('topic-tag', id, 'sns tag-resource'),
          );
          break;
        case 'AWS::SNS::TopicPolicy':
          resourceSteps.push(call('topic-policy', id, 'sns set-topic-attributes'));
          break;
        case 'AWS::CloudWatch::Alarm':
          resourceSteps.push(
            call('alarm-put', id, 'cloudwatch put-metric-alarm'),
            call('alarm-tag', id, 'cloudwatch tag-resource'),
          );
          break;
        default:
          throw new Error('No direct AWS CLI implementation for ' + resource.Type);
      }
      if (resource.Condition === 'CreateTopic')
        steps.push(`if [ -z "$TOPIC_ARN" ]; then ${chain(resourceSteps)}; fi`);
      else if (resource.Condition)
        throw new Error('Unsupported direct condition: ' + resource.Condition);
      else steps.push(...resourceSteps);
    }
    steps.push('p outputs');
  }
  return `NAME="\${NAME:-quickstart-${kind}-cli}" ${fixedSettings(kind)} TAG_KEY="\${TAG_KEY:-Project}" TAG_VALUE="\${TAG_VALUE-quickstart}" bash -c ${shellQuote(chain(steps))}`;
}

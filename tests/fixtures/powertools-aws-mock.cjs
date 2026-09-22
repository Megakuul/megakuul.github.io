const fs = require('node:fs');
const args = process.argv.slice(2).filter(arg => arg !== '--no-cli-pager');
const option = name => args[args.indexOf(name) + 1];
let payload;
if (args.includes('--cli-input-json')) {
  const input = option('--cli-input-json');
  payload = JSON.parse(
    input.startsWith('file://') ? fs.readFileSync(input.slice(7), 'utf8') : input,
  );
}
const call = { service: args[0], operation: args[1], args, payload };
if (args.includes('--launch-template-data'))
  call.launchTemplate = JSON.parse(
    fs.readFileSync(option('--launch-template-data').slice(7), 'utf8'),
  );
fs.appendFileSync(process.env.MOCK_CALLS, JSON.stringify(call) + '\n');
if (args[1] === process.env.FAIL_OPERATION) process.exit(17);
const emit = value => console.log(typeof value === 'string' ? value : JSON.stringify(value));
const arn = 'arn:aws:iam::123456789012:role/mock';
switch (args[1]) {
  case 'describe-stacks':
    emit('i-new');
    break;
  case 'describe-subnets':
    emit(process.env.MOCK_SUBNET ?? 'subnet-first');
    break;
  case 'get-caller-identity':
    emit({ Account: '123456789012', Arn: arn });
    break;
  case 'get-role':
    emit(arn);
    break;
  case 'get':
    emit('eu-west-1');
    break;
  case 'list-detectors':
    emit(process.env.EXISTING_SECURITY ? 'detector-existing' : 'None');
    break;
  case 'list-analyzers':
    emit({
      analyzers: process.env.EXISTING_SECURITY
        ? [{ name: 'existing', type: 'ACCOUNT', status: 'ACTIVE', arn }]
        : [],
    });
    break;
  case 'create-detector':
    emit(args.includes('--query') ? 'detector-new' : { DetectorId: 'detector-new' });
    break;
  case 'create-analyzer':
    emit(args.includes('--query') ? arn : { arn });
    break;
  case 'list-publishing-destinations':
    emit(process.env.EXISTING_SECURITY ? 'destination-existing' : 'None');
    break;
  case 'describe-publishing-destination':
    emit(process.env.EXPORT_STATUS || 'PUBLISHING');
    break;
  case 'describe-instances':
    if (args.includes('--query')) {
      emit(process.env.MOCK_SSH_HOST ?? '198.51.100.20');
      break;
    }
    emit({
      Reservations: [
        {
          Instances: [
            { RootDeviceType: process.env.ROOT_TYPE || 'ebs', State: { Name: 'running' } },
          ],
        },
      ],
    });
    break;
  case 'get-launch-template-data':
    emit({
      InstanceType: 't4g.micro',
      EbsOptimized: true,
      IamInstanceProfile: { Arn: arn },
      UserData: 'ZWNobyBoZWxsbw==',
      MetadataOptions: { HttpTokens: 'optional' },
      SecurityGroupIds: ['sg-old'],
      BlockDeviceMappings: [{ SnapshotId: 'snap-old' }],
    });
    break;
  case 'create-image':
    emit('ami-new');
    break;
  case 'wait':
    break;
  default:
    emit({
      KeyMetadata: { KeyId: 'key-new', Arn: 'arn:aws:kms:eu-west-1:123456789012:key/key-new' },
      ServerId: 'server-new',
      deliveryDestination: { arn: 'arn:aws:logs:eu-west-1:123456789012:delivery-destination/mock' },
      QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/mock',
      Summary: { ARN: arn },
      ARN: arn,
      Id: 'id-new',
      id: 'id-new',
      DestinationId: 'destination-new',
      GroupId: 'sg-new',
      FailedEntryCount: 0,
    });
}

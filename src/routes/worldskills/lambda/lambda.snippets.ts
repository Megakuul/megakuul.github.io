import drivers from './database.snippets';

/** Raw Lambda snippet catalogue. Highlighted at build time in +page.server.ts.
 *
 * Rules for the JS blobs: no backticks and no backslashes so they survive being
 * stored inside template literals verbatim. String concat instead of template
 * literals, replaceAll instead of regex.
 *
 * Every AWS client and import lives once in the "Import everything" block. The rest
 * of the snippets assume those clients (s3, ddb, sqs, ...) already exist, so a
 * snippet pastes in right under the import block with nothing to wire up.
 */

export interface Snippet {
  id: string;
  title: string;
  /** Short plain-text hint rendered above the code. */
  note?: string;
  js: string;
  py: string;
  /** Override the highlight language for both blobs (used for the JSON envelope). */
  lang?: string;
}

export interface Group {
  nodeOnly?: boolean;
  downloads?: { title: string; href: string }[];
  id: string;
  title: string;
  blurb: string;
  snippets: Snippet[];
}

const common: Group = {
  id: 'common',
  title: 'Common',
  blurb: 'Shared SDK imports and bundled binaries.',
  snippets: [
    {
      id: 'imports',
      title: 'Import everything (the copy-paste block)',
      note: 'Paste this once at the top of your file, then every snippet below just uses these clients. Everything here ships in the runtime (AWS SDK v3 on Node, boto3 on Python), so nothing needs bundling. Snippets that pull a non-runtime dependency (like Kafka) carry their own import + a note on the layer to add.',
      js: `import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { Signer } from '@aws-sdk/rds-signer';
import { RedshiftDataClient, ExecuteStatementCommand as RedshiftExecuteStatementCommand, DescribeStatementCommand, GetStatementResultCommand } from '@aws-sdk/client-redshift-data';
import { NeptunedataClient, ExecuteOpenCypherQueryCommand } from '@aws-sdk/client-neptunedata';
import { TimestreamWriteClient, WriteRecordsCommand } from '@aws-sdk/client-timestream-write';
import { TimestreamQueryClient, QueryCommand as TimestreamQueryCommand } from '@aws-sdk/client-timestream-query';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { SQSClient, SendMessageCommand, SendMessageBatchCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SFNClient, StartExecutionCommand, StartSyncExecutionCommand, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { BatchClient, SubmitJobCommand } from '@aws-sdk/client-batch';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand, GetParametersByPathCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { AppConfigDataClient, StartConfigurationSessionCommand, GetLatestConfigurationCommand } from '@aws-sdk/client-appconfigdata';
import { AppConfigClient, CreateHostedConfigurationVersionCommand, StartDeploymentCommand } from '@aws-sdk/client-appconfig';
import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { KMSClient, EncryptCommand, DecryptCommand, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CognitoIdentityProviderClient, AdminGetUserCommand, AdminCreateUserCommand, AdminSetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const rdsData = new RDSDataClient({});
const redshiftData = new RedshiftDataClient({});
const timestreamWrite = new TimestreamWriteClient({});
const timestreamQuery = new TimestreamQueryClient({});
const sqs = new SQSClient({});
const sns = new SNSClient({});
const bus = new EventBridgeClient({});
const sfn = new SFNClient({});
const lambda = new LambdaClient({});
const batchClient = new BatchClient({});
const kinesis = new KinesisClient({});
const secrets = new SecretsManagerClient({});
const ssm = new SSMClient({});
const appconfigdata = new AppConfigDataClient({});
const appconfig = new AppConfigClient({});
const sts = new STSClient({});
const kms = new KMSClient({});
const ses = new SESv2Client({});
const cw = new CloudWatchClient({});
const bedrock = new BedrockRuntimeClient({});
const idp = new CognitoIdentityProviderClient({});`,
      py: `import boto3, json, base64, gzip, os, shutil, subprocess, time
from datetime import datetime, timezone
from urllib.parse import unquote_plus
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer

s3 = boto3.client("s3")
ddb = boto3.resource("dynamodb")
rds_data = boto3.client("rds-data")
rds = boto3.client("rds")
redshift_data = boto3.client("redshift-data")
timestream_write = boto3.client("timestream-write")
timestream_query = boto3.client("timestream-query")
sqs = boto3.client("sqs")
sns = boto3.client("sns")
bus = boto3.client("events")
sfn = boto3.client("stepfunctions")
lam = boto3.client("lambda")
batch_client = boto3.client("batch")
kinesis = boto3.client("kinesis")
secrets = boto3.client("secretsmanager")
ssm = boto3.client("ssm")
appconfigdata = boto3.client("appconfigdata")
appconfig = boto3.client("appconfig")
sts = boto3.client("sts")
kms = boto3.client("kms")
ses = boto3.client("sesv2")
cw = boto3.client("cloudwatch")
bedrock = boto3.client("bedrock-runtime")
idp = boto3.client("cognito-idp")

deserialize = TypeDeserializer().deserialize
unmarshall = lambda img: {k: deserialize(v) for k, v in img.items()}`,
    },
    {
      id: 'exec-binary',
      title: 'Execute a bundled / layer binary',
      note: 'Layer files land in /opt, directly bundled files in $LAMBDA_TASK_ROOT. Both are read-only, so copy to /tmp (the only writable dir), chmod +x, run.',
      js: `const runBinary = (src, args = [], input) => {
  const bin = '/tmp/' + basename(src);
  copyFileSync(src, bin);
  chmodSync(bin, 0o755);
  const r = spawnSync(bin, args, { input, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr || 'exit ' + r.status);
  return r.stdout;
};

export const handler = async (event) => {
  const out = runBinary('/opt/bin/mytool', ['--flag', event.arg ?? ''], event.stdin);
  return { out };
};`,
      py: `def run_binary(src, args=None, stdin=None):
    dst = "/tmp/" + os.path.basename(src)
    shutil.copyfile(src, dst)
    os.chmod(dst, 0o755)
    r = subprocess.run([dst, *(args or [])], input=stdin, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or f"exit {r.returncode}")
    return r.stdout

def handler(event, context):
    return {"out": run_binary("/opt/bin/mytool", ["--flag", event.get("arg", "")], event.get("stdin"))}`,
    },
  ],
};

const incoming: Group = {
  id: 'incoming',
  title: 'Incoming events',
  blurb: 'One tight example per trigger, each touching every field worth knowing.',
  snippets: [
    {
      id: 'in-apigw-rest',
      title: 'API Gateway REST (proxy / v1)',
      js: `export const handler = async (event) => {
  const { httpMethod, path, resource, pathParameters, queryStringParameters, headers, body, isBase64Encoded, requestContext } = event;
  const raw = isBase64Encoded ? Buffer.from(body, 'base64').toString() : body;
  const user = requestContext.authorizer?.claims?.sub ?? requestContext.identity?.sourceIp;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ httpMethod, path, resource, pathParameters, queryStringParameters, trace: headers?.['x-trace'], stage: requestContext.stage, user, raw }),
  };
};`,
      py: `def handler(event, context):
    ctx = event["requestContext"]
    raw = base64.b64decode(event["body"]).decode() if event.get("isBase64Encoded") else event.get("body")
    user = (ctx.get("authorizer") or {}).get("claims", {}).get("sub") or (ctx.get("identity") or {}).get("sourceIp")
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({
            "httpMethod": event["httpMethod"],
            "path": event["path"],
            "resource": event["resource"],
            "pathParameters": event.get("pathParameters"),
            "query": event.get("queryStringParameters"),
            "trace": (event.get("headers") or {}).get("x-trace"),
            "stage": ctx["stage"],
            "user": user,
            "raw": raw,
        }),
    }`,
    },
    {
      id: 'in-apigw-http',
      title: 'API Gateway HTTP API (v2) + Function URL',
      note: 'Function URLs use the exact same payload 2.0 shape. Cookies arrive as an array, method lives under requestContext.http.',
      js: `export const handler = async (event) => {
  const { rawPath, rawQueryString, routeKey, cookies, headers, pathParameters, queryStringParameters, body, isBase64Encoded, requestContext } = event;
  const { method, sourceIp } = requestContext.http;
  const raw = isBase64Encoded ? Buffer.from(body, 'base64').toString() : body;
  return {
    statusCode: 200,
    cookies: ['seen=1; HttpOnly'],
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, routeKey, rawPath, rawQueryString, pathParameters, queryStringParameters, cookies, sourceIp, agent: headers?.['user-agent'], raw }),
  };
};`,
      py: `def handler(event, context):
    http = event["requestContext"]["http"]
    raw = base64.b64decode(event["body"]).decode() if event.get("isBase64Encoded") else event.get("body")
    return {
        "statusCode": 200,
        "cookies": ["seen=1; HttpOnly"],
        "headers": {"content-type": "application/json"},
        "body": json.dumps({
            "method": http["method"],
            "routeKey": event.get("routeKey"),
            "rawPath": event["rawPath"],
            "rawQueryString": event["rawQueryString"],
            "pathParameters": event.get("pathParameters"),
            "query": event.get("queryStringParameters"),
            "cookies": event.get("cookies"),
            "sourceIp": http["sourceIp"],
            "agent": (event.get("headers") or {}).get("user-agent"),
            "raw": raw,
        }),
    }`,
    },
    {
      id: 'in-alb',
      title: 'Application Load Balancer target',
      note: 'ALB leaves query parameters URL-encoded. Multivalue target groups supply multiValueHeaders/multiValueQueryStringParameters and require multiValueHeaders in the response. Use the HTTP router on the Gadgets page for routing and decoding.',
      js: `export const handler = async (event) => {
  const { httpMethod, path, body, isBase64Encoded, requestContext } = event;
  const multi = Object.hasOwn(event, 'multiValueHeaders');
  const headers = multi ? event.multiValueHeaders : event.headers;
  const query = multi ? event.multiValueQueryStringParameters : event.queryStringParameters;
  const raw = isBase64Encoded ? Buffer.from(body, 'base64').toString() : body;
  return {
    statusCode: 200,
    statusDescription: '200 OK',
    isBase64Encoded: false,
    ...(multi
      ? { multiValueHeaders: { 'content-type': ['application/json'], 'set-cookie': ['seen=1'] } }
      : { headers: { 'content-type': 'application/json', 'set-cookie': 'seen=1' } }),
    body: JSON.stringify({ httpMethod, path, query, host: headers?.host, targetGroup: requestContext.elb.targetGroupArn, raw }),
  };
};`,
      py: `def handler(event, context):
    multi = "multiValueHeaders" in event
    headers = (event.get("multiValueHeaders") if multi else event.get("headers")) or {}
    query = event.get("multiValueQueryStringParameters") if multi else event.get("queryStringParameters")
    raw = base64.b64decode(event["body"]).decode() if event.get("isBase64Encoded") else event.get("body")
    return {
        "statusCode": 200,
        "statusDescription": "200 OK",
        "isBase64Encoded": False,
        **({"multiValueHeaders": {"content-type": ["application/json"], "set-cookie": ["seen=1"]}}
           if multi else {"headers": {"content-type": "application/json", "set-cookie": "seen=1"}}),
        "body": json.dumps({
            "httpMethod": event["httpMethod"],
            "path": event["path"],
            "query": query,
            "host": headers.get("host"),
            "targetGroup": event["requestContext"]["elb"]["targetGroupArn"],
            "raw": raw,
        }),
    }`,
    },
    {
      id: 'in-apigw-nonproxy',
      title: 'API Gateway non-proxy (custom integration)',
      note: 'The event is whatever your mapping template built, e.g. { "id": "$input.params(\'id\')", "action": "$input.path(\'$.action\')", "ip": "$context.identity.sourceIp" }. Return a plain object; map errors to status via regex on the thrown message.',
      js: `export const handler = async (event) => {
  const { id, action, ip } = event;
  if (!id) throw new Error('400 id required');
  return { id, action, ip, ts: Date.now() };
};`,
      py: `def handler(event, context):
    if not event.get("id"):
        raise Exception("400 id required")
    return {"id": event["id"], "action": event.get("action"), "ip": event.get("ip"), "ts": int(time.time() * 1000)}`,
    },
    {
      id: 'in-authorizer-rest',
      title: 'Lambda Authorizer (REST — IAM policy)',
      note: 'TOKEN authorizers get authorizationToken, REQUEST authorizers get the full request. Return an IAM policy; context is forwarded to the integration.',
      js: `export const handler = async (event) => {
  const token = event.authorizationToken ?? event.headers?.authorization ?? event.identitySource?.[0];
  const effect = token === 'Bearer let-me-in' ? 'Allow' : 'Deny';
  return {
    principalId: 'user-42',
    policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: event.methodArn }] },
    context: { role: 'admin', tenant: 'acme' },
    usageIdentifierKey: 'api-key-123',
  };
};`,
      py: `def handler(event, context):
    token = event.get("authorizationToken") or (event.get("headers") or {}).get("authorization")
    effect = "Allow" if token == "Bearer let-me-in" else "Deny"
    return {
        "principalId": "user-42",
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {"Action": "execute-api:Invoke", "Effect": effect, "Resource": event["methodArn"]},
            ],
        },
        "context": {"role": "admin", "tenant": "acme"},
        "usageIdentifierKey": "api-key-123",
    }`,
    },
    {
      id: 'in-authorizer-http',
      title: 'Lambda Authorizer (HTTP v2 — simple)',
      note: 'HTTP APIs accept a simple boolean response when enableSimpleResponses is on.',
      js: `export const handler = async (event) => {
  const token = event.headers.authorization ?? event.identitySource?.[0];
  return {
    isAuthorized: token === 'Bearer let-me-in',
    context: { role: 'admin', tenant: event.headers['x-tenant'] },
  };
};`,
      py: `def handler(event, context):
    token = event["headers"].get("authorization")
    return {
        "isAuthorized": token == "Bearer let-me-in",
        "context": {"role": "admin", "tenant": event["headers"].get("x-tenant")},
    }`,
    },
    {
      id: 'in-s3',
      title: 'S3 object event',
      js: `export const handler = async (event) => {
  for (const r of event.Records) {
    const bucket = r.s3.bucket.name;
    const key = decodeURIComponent(r.s3.object.key.replaceAll('+', ' '));
    console.log(r.eventName, r.awsRegion, bucket, key, r.s3.object.size, r.s3.object.eTag, r.eventTime);
  }
};`,
      py: `def handler(event, context):
    for r in event["Records"]:
        obj = r["s3"]["object"]
        key = unquote_plus(obj["key"])
        print(r["eventName"], r["awsRegion"], r["s3"]["bucket"]["name"], key, obj["size"], obj.get("eTag"), r["eventTime"])`,
    },
    {
      id: 'in-sqs',
      title: 'SQS queue (partial batch failure)',
      note: 'Report only the failed messageIds so the rest get deleted. Needs ReportBatchItemFailures on the event source mapping.',
      js: `export const handler = async (event) => {
  const batchItemFailures = [];
  for (const r of event.Records) {
    try {
      const msg = JSON.parse(r.body);
      console.log(r.messageId, msg, r.attributes.ApproximateReceiveCount, r.messageAttributes?.trace?.stringValue, r.eventSourceARN);
    } catch {
      batchItemFailures.push({ itemIdentifier: r.messageId });
    }
  }
  return { batchItemFailures };
};`,
      py: `def handler(event, context):
    failures = []
    for r in event["Records"]:
        try:
            msg = json.loads(r["body"])
            attr = r.get("messageAttributes", {}).get("trace", {}).get("stringValue")
            print(r["messageId"], msg, r["attributes"]["ApproximateReceiveCount"], attr, r["eventSourceARN"])
        except Exception:
            failures.append({"itemIdentifier": r["messageId"]})
    return {"batchItemFailures": failures}`,
    },
    {
      id: 'in-sns',
      title: 'SNS topic notification',
      js: `export const handler = async (event) => {
  for (const r of event.Records) {
    const { TopicArn, Subject, Message, Timestamp, MessageAttributes } = r.Sns;
    console.log(TopicArn, Subject, Timestamp, MessageAttributes?.trace?.Value, JSON.parse(Message));
  }
};`,
      py: `def handler(event, context):
    for r in event["Records"]:
        sns_rec = r["Sns"]
        attr = sns_rec.get("MessageAttributes", {}).get("trace", {}).get("Value")
        print(sns_rec["TopicArn"], sns_rec.get("Subject"), sns_rec["Timestamp"], attr, json.loads(sns_rec["Message"]))`,
    },
    {
      id: 'in-ddb-streams',
      title: 'DynamoDB Streams',
      note: 'unmarshall (from the import block) turns the wire format back into plain objects; NewImage/OldImage depend on StreamViewType.',
      js: `export const handler = async (event) => {
  for (const r of event.Records) {
    const key = unmarshall(r.dynamodb.Keys);
    const before = r.dynamodb.OldImage && unmarshall(r.dynamodb.OldImage);
    const after = r.dynamodb.NewImage && unmarshall(r.dynamodb.NewImage);
    console.log(r.eventName, key, before, after, r.dynamodb.SequenceNumber);
  }
};`,
      py: `def handler(event, context):
    for r in event["Records"]:
        rec = r["dynamodb"]
        before = unmarshall(rec["OldImage"]) if "OldImage" in rec else None
        after = unmarshall(rec["NewImage"]) if "NewImage" in rec else None
        print(r["eventName"], unmarshall(rec["Keys"]), before, after, rec["SequenceNumber"])`,
    },
    {
      id: 'in-kinesis',
      title: 'Kinesis Data Streams',
      note: 'Record data is base64. One Lambda invoke covers many records of one shard.',
      js: `export const handler = async (event) => {
  for (const r of event.Records) {
    const data = Buffer.from(r.kinesis.data, 'base64').toString();
    console.log(r.kinesis.partitionKey, r.kinesis.sequenceNumber, r.kinesis.approximateArrivalTimestamp, data);
  }
};`,
      py: `def handler(event, context):
    for r in event["Records"]:
        k = r["kinesis"]
        data = base64.b64decode(k["data"]).decode()
        print(k["partitionKey"], k["sequenceNumber"], k["approximateArrivalTimestamp"], data)`,
    },
    {
      id: 'in-eventbridge',
      title: 'EventBridge (rules, scheduled, custom bus)',
      note: 'Scheduled rules arrive with source "aws.events" and detail-type "Scheduled Event" and an empty detail.',
      js: `export const handler = async (event) => {
  const { id, source, 'detail-type': type, detail, time, region, resources, account } = event;
  console.log(id, source, type, account, region, resources, time, detail);
};`,
      py: `def handler(event, context):
    print(event["id"], event["source"], event["detail-type"], event["account"],
          event["region"], event.get("resources"), event["time"], event.get("detail"))`,
    },
    {
      id: 'in-cwlogs',
      title: 'CloudWatch Logs subscription',
      note: 'Payload is gzipped then base64. Great for shipping logs onward.',
      js: `export const handler = async (event) => {
  const payload = JSON.parse(gunzipSync(Buffer.from(event.awslogs.data, 'base64')).toString());
  for (const e of payload.logEvents) {
    console.log(payload.logGroup, payload.logStream, e.id, e.timestamp, e.message);
  }
};`,
      py: `def handler(event, context):
    payload = json.loads(gzip.decompress(base64.b64decode(event["awslogs"]["data"])))
    for e in payload["logEvents"]:
        print(payload["logGroup"], payload["logStream"], e["id"], e["timestamp"], e["message"])`,
    },
    {
      id: 'in-kafka',
      title: 'MSK / self-managed Kafka',
      note: 'Records are grouped by "topic-partition"; key and value are base64.',
      js: `export const handler = async (event) => {
  for (const [topicPartition, records] of Object.entries(event.records)) {
    for (const r of records) {
      const value = Buffer.from(r.value, 'base64').toString();
      const key = r.key && Buffer.from(r.key, 'base64').toString();
      console.log(topicPartition, r.partition, r.offset, r.timestamp, key, value);
    }
  }
};`,
      py: `def handler(event, context):
    for topic_partition, records in event["records"].items():
        for r in records:
            value = base64.b64decode(r["value"]).decode()
            key = base64.b64decode(r["key"]).decode() if r.get("key") else None
            print(topic_partition, r["partition"], r["offset"], r["timestamp"], key, value)`,
    },
    {
      id: 'in-cognito',
      title: 'Cognito trigger',
      note: 'Same handler covers every trigger; branch on triggerSource. You mutate event.response and return the whole event.',
      js: `export const handler = async (event) => {
  console.log(event.triggerSource, event.userPoolId, event.userName, event.request.userAttributes);
  if (event.triggerSource === 'PreSignUp_SignUp') {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }
  if (event.triggerSource.startsWith('TokenGeneration')) {
    event.response.claimsOverrideDetails = {
      claimsToAddOrOverride: { tenant: 'acme' },
      groupOverrideDetails: { groupsToOverride: ['admin'] },
    };
  }
  return event;
};`,
      py: `def handler(event, context):
    src = event["triggerSource"]
    print(src, event["userPoolId"], event.get("userName"), event["request"]["userAttributes"])
    if src == "PreSignUp_SignUp":
        event["response"]["autoConfirmUser"] = True
        event["response"]["autoVerifyEmail"] = True
    if src.startswith("TokenGeneration"):
        event["response"]["claimsOverrideDetails"] = {
            "claimsToAddOrOverride": {"tenant": "acme"},
            "groupOverrideDetails": {"groupsToOverride": ["admin"]}}
    return event`,
    },
    {
      id: 'in-stepfunctions',
      title: 'Step Functions task',
      note: 'Plain JSON in, plain JSON out. The state machine passes the Parameters you configured.',
      js: `export const handler = async (event) => {
  const { orderId, items } = event;
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  return { orderId, total, status: 'PRICED' };
};`,
      py: `def handler(event, context):
    total = sum(i["price"] * i["qty"] for i in event["items"])
    return {"orderId": event["orderId"], "total": total, "status": "PRICED"}`,
    },
    {
      id: 'in-websocket',
      title: 'API Gateway WebSocket',
      note: 'Routes $connect / $disconnect / $default plus your custom actions come through requestContext.routeKey.',
      js: `export const handler = async (event) => {
  const { connectionId, routeKey, domainName, stage } = event.requestContext;
  if (routeKey === '$connect' || routeKey === '$disconnect') return { statusCode: 200 };
  const msg = JSON.parse(event.body ?? '{}');
  console.log(connectionId, routeKey, domainName, stage, msg);
  return { statusCode: 200, body: 'ok' };
};`,
      py: `def handler(event, context):
    ctx = event["requestContext"]
    if ctx["routeKey"] in ("$connect", "$disconnect"):
        return {"statusCode": 200}
    msg = json.loads(event.get("body") or "{}")
    print(ctx["connectionId"], ctx["routeKey"], ctx["domainName"], ctx["stage"], msg)
    return {"statusCode": 200, "body": "ok"}`,
    },
    {
      id: 'in-edge',
      title: 'CloudFront (Lambda@Edge)',
      note: 'Runs in us-east-1, no env vars, small size limits. Mutate and return the request (or response) object.',
      js: `export const handler = async (event) => {
  const req = event.Records[0].cf.request;
  req.headers['x-edge'] = [{ key: 'X-Edge', value: '1' }];
  console.log(req.method, req.uri, req.querystring, req.clientIp);
  return req;
};`,
      py: `def handler(event, context):
    req = event["Records"][0]["cf"]["request"]
    req["headers"]["x-edge"] = [{"key": "X-Edge", "value": "1"}]
    print(req["method"], req["uri"], req["querystring"], req["clientIp"])
    return req`,
    },
    {
      id: 'in-direct',
      title: 'Direct invoke (SDK / CLI / test)',
      note: 'Arbitrary JSON in. The context object carries the request id, deadline and function metadata.',
      js: `export const handler = async (event, context) => {
  console.log(context.awsRequestId, context.functionName, context.functionVersion, context.getRemainingTimeInMillis());
  return { echo: event, at: new Date().toISOString() };
};`,
      py: `def handler(event, context):
    print(context.aws_request_id, context.function_name, context.function_version, context.get_remaining_time_in_millis())
    return {"echo": event, "at": datetime.now(timezone.utc).isoformat()}`,
    },
  ],
};

const outgoing: Group = {
  id: 'outgoing',
  title: 'Outgoing events',
  blurb: 'What you hand back to the caller, and the events you fire off yourself.',
  snippets: [
    {
      id: 'out-apigw-rest',
      title: 'API Gateway REST (proxy) response',
      note: 'Binary bodies must be base64 with isBase64Encoded, and multiValueHeaders is how you set multiple Set-Cookie headers.',
      js: `export const handler = async () => ({
  statusCode: 200,
  isBase64Encoded: true,
  headers: { 'content-type': 'image/png' },
  multiValueHeaders: { 'set-cookie': ['a=1; HttpOnly', 'b=2'] },
  body: pngBuffer.toString('base64'),
});`,
      py: `def handler(event, context):
    return {
        "statusCode": 200,
        "isBase64Encoded": True,
        "headers": {"content-type": "image/png"},
        "multiValueHeaders": {"set-cookie": ["a=1; HttpOnly", "b=2"]},
        "body": base64.b64encode(png_bytes).decode(),
    }`,
    },
    {
      id: 'out-apigw-http',
      title: 'API Gateway HTTP (v2) response',
      note: 'Return a bare object or string and v2 auto-wraps it as 200 JSON/text. The explicit form lets you set cookies as an array.',
      js: `export const handler = async () => ({
  statusCode: 201,
  cookies: ['session=abc; HttpOnly; Secure', 'theme=dark'],
  headers: { 'content-type': 'application/json' },
  isBase64Encoded: false,
  body: JSON.stringify({ ok: true }),
});`,
      py: `def handler(event, context):
    return {
        "statusCode": 201,
        "cookies": ["session=abc; HttpOnly; Secure", "theme=dark"],
        "headers": {"content-type": "application/json"},
        "isBase64Encoded": False,
        "body": json.dumps({"ok": True}),
    }`,
    },
    {
      id: 'out-alb',
      title: 'ALB response',
      note: 'Match the target group format: use multiValueHeaders when enabled, headers otherwise. Include a statusDescription matching the status code.',
      js: `export const handler = async (event) => ({
  statusCode: 200,
  statusDescription: '200 OK',
  isBase64Encoded: false,
  ...(Object.hasOwn(event, 'multiValueHeaders')
    ? { multiValueHeaders: { 'content-type': ['text/html'] } }
    : { headers: { 'content-type': 'text/html' } }),
  body: '<h1>ok</h1>',
});`,
      py: `def handler(event, context):
    return {
        "statusCode": 200,
        "statusDescription": "200 OK",
        "isBase64Encoded": False,
        **({"multiValueHeaders": {"content-type": ["text/html"]}}
           if "multiValueHeaders" in event else {"headers": {"content-type": "text/html"}}),
        "body": "<h1>ok</h1>",
    }`,
    },
    {
      id: 'out-batch',
      title: 'Partial batch response (SQS / Kinesis / DDB)',
      note: 'Same envelope for all three stream/queue sources with ReportBatchItemFailures enabled, but the identifier is messageId for SQS and SequenceNumber for Kinesis/DynamoDB Streams.',
      js: `export const handler = async (event) => {
  const failed = event.Records.filter(shouldRetry);
  return { batchItemFailures: failed.map((r) => ({
    itemIdentifier: r.messageId ?? r.kinesis?.sequenceNumber ?? r.dynamodb?.SequenceNumber,
  })) };
};`,
      py: `def handler(event, context):
    failed = [r for r in event["Records"] if should_retry(r)]
    return {"batchItemFailures": [{
        "itemIdentifier": r.get("messageId") or r.get("kinesis", {}).get("sequenceNumber") or r.get("dynamodb", {}).get("SequenceNumber")
    } for r in failed]}`,
    },
    {
      id: 'out-eventbridge',
      title: 'Emit to EventBridge',
      js: `await bus.send(new PutEventsCommand({
  Entries: [{ EventBusName: 'default', Source: 'app.orders', DetailType: 'OrderPlaced', Detail: JSON.stringify({ orderId: '42', total: 9.99 }) }],
}));`,
      py: `bus.put_events(Entries=[
    {
        "EventBusName": "default",
        "Source": "app.orders",
        "DetailType": "OrderPlaced",
        "Detail": json.dumps({"orderId": "42", "total": 9.99}),
    },
])`,
    },
    {
      id: 'out-sns',
      title: 'Publish to SNS',
      js: `await sns.send(new PublishCommand({
  TopicArn: process.env.TOPIC,
  Subject: 'order placed',
  Message: JSON.stringify({ orderId: '42' }),
  MessageAttributes: { trace: { DataType: 'String', StringValue: 'abc' } },
}));`,
      py: `sns.publish(
    TopicArn=os.environ["TOPIC"],
    Subject="order placed",
    Message=json.dumps({"orderId": "42"}),
    MessageAttributes={"trace": {"DataType": "String", "StringValue": "abc"}},
)`,
    },
    {
      id: 'out-sqs',
      title: 'Send to SQS',
      note: 'This example targets a FIFO queue. Remove MessageGroupId / MessageDeduplicationId for a standard queue. Batch send takes up to 10 entries per call and reports per-entry failures instead of throwing.',
      js: `await sqs.send(new SendMessageCommand({
  QueueUrl: process.env.QUEUE,
  MessageBody: JSON.stringify({ job: 'resize' }),
  MessageAttributes: { trace: { DataType: 'String', StringValue: 'abc' } },
  MessageGroupId: 'g1',
  MessageDeduplicationId: 'd1',
}));

const batch = await sqs.send(new SendMessageBatchCommand({
  QueueUrl: process.env.QUEUE,
  Entries: [
    { Id: '1', MessageBody: JSON.stringify({ job: 'resize' }), MessageGroupId: 'g1', MessageDeduplicationId: 'd1' },
    { Id: '2', MessageBody: JSON.stringify({ job: 'thumbnail' }), MessageGroupId: 'g1', MessageDeduplicationId: 'd2' },
  ],
}));
const failed = batch.Failed;`,
      py: `sqs.send_message(
    QueueUrl=os.environ["QUEUE"],
    MessageBody=json.dumps({"job": "resize"}),
    MessageAttributes={"trace": {"DataType": "String", "StringValue": "abc"}},
    MessageGroupId="g1",
    MessageDeduplicationId="d1",
)

batch = sqs.send_message_batch(
    QueueUrl=os.environ["QUEUE"],
    Entries=[
        {"Id": "1", "MessageBody": json.dumps({"job": "resize"}), "MessageGroupId": "g1", "MessageDeduplicationId": "d1"},
        {"Id": "2", "MessageBody": json.dumps({"job": "thumbnail"}), "MessageGroupId": "g1", "MessageDeduplicationId": "d2"},
    ],
)
failed = batch.get("Failed", [])`,
    },
    {
      id: 'out-sfn',
      title: 'Step Functions task token (callback)',
      note: 'For the .waitForTaskToken pattern: resume the paused state machine with success or failure.',
      js: `await sfn.send(new SendTaskSuccessCommand({ taskToken: event.taskToken, output: JSON.stringify({ done: true }) }));
await sfn.send(new SendTaskFailureCommand({ taskToken: event.taskToken, error: 'Nope', cause: 'validation failed' }));`,
      py: `sfn.send_task_success(taskToken=event["taskToken"], output=json.dumps({"done": True}))
sfn.send_task_failure(taskToken=event["taskToken"], error="Nope", cause="validation failed")`,
    },
    {
      id: 'out-kinesis',
      title: 'Put record to Kinesis',
      js: `await kinesis.send(new PutRecordCommand({
  StreamName: process.env.STREAM,
  PartitionKey: 'p1',
  Data: Buffer.from(JSON.stringify({ x: 1 })),
}));`,
      py: `kinesis.put_record(
    StreamName=os.environ["STREAM"],
    PartitionKey="p1",
    Data=json.dumps({"x": 1}).encode(),
)`,
    },
    {
      id: 'out-invoke',
      title: 'Invoke another Lambda',
      note: 'InvocationType Event = fire-and-forget async, RequestResponse = wait for the result.',
      js: `const res = await lambda.send(new InvokeCommand({
  FunctionName: 'worker',
  InvocationType: 'RequestResponse',
  Payload: JSON.stringify({ hi: 1 }),
}));
const out = JSON.parse(Buffer.from(res.Payload).toString());`,
      py: `res = lam.invoke(FunctionName="worker", InvocationType="RequestResponse", Payload=json.dumps({"hi": 1}))
out = json.loads(res["Payload"].read())`,
    },
    {
      id: 'out-submit-batch',
      title: 'Submit an AWS Batch job',
      note: 'Set BATCH_JOB_QUEUE and BATCH_JOB_DEFINITION (name:revision or ARN) for an existing queue and job definition. The Lambda execution role needs batch:SubmitJob on both the queue ARN and job-definition revision ARN. Returns a job ID once accepted; the job runs asynchronously. Container overrides below target a single-container ECS/EC2 or Fargate job definition using containerProperties. Repeated submissions can create duplicate jobs, even with the same jobName.',
      js: `const submitted = await batchClient.send(new SubmitJobCommand({
  jobName: 'process-input-' + Date.now(),
  jobQueue: process.env.BATCH_JOB_QUEUE,
  jobDefinition: process.env.BATCH_JOB_DEFINITION,
  containerOverrides: {
    command: ['python', 'worker.py', '--input', 's3://my-bucket/input.json'],
    environment: [{ name: 'OUTPUT_BUCKET', value: 'my-output-bucket' }],
  },
  retryStrategy: { attempts: 2 },
  timeout: { attemptDurationSeconds: 3600 },
  // Optional array job (2–10,000 children); worker reads AWS_BATCH_JOB_ARRAY_INDEX.
  // arrayProperties: { size: 10 },
  // Optional dependency: dependsOn: [{ jobId: 'previous-job-id' }],
}));
console.log('Batch job submitted', { jobId: submitted.jobId, jobArn: submitted.jobArn });`,
      py: `submitted = batch_client.submit_job(
    jobName="process-input-" + str(time.time_ns()),
    jobQueue=os.environ["BATCH_JOB_QUEUE"],
    jobDefinition=os.environ["BATCH_JOB_DEFINITION"],
    containerOverrides={
        "command": ["python", "worker.py", "--input", "s3://my-bucket/input.json"],
        "environment": [{"name": "OUTPUT_BUCKET", "value": "my-output-bucket"}],
    },
    retryStrategy={"attempts": 2},
    timeout={"attemptDurationSeconds": 3600},
    # Optional array job (2–10,000 children); worker reads AWS_BATCH_JOB_ARRAY_INDEX.
    # arrayProperties={"size": 10},
    # Optional dependency: dependsOn=[{"jobId": "previous-job-id"}],
)
print("Batch job submitted", submitted["jobId"], submitted.get("jobArn"))`,
    },
    {
      id: 'out-websocket',
      title: 'Push to a WebSocket client',
      note: 'The management client is the one exception to the import block: its endpoint is per-request, so build it from the event.',
      js: `export const handler = async (event) => {
  const { domainName, stage, connectionId } = event.requestContext;
  const api = new ApiGatewayManagementApiClient({ endpoint: 'https://' + domainName + '/' + stage });
  await api.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: JSON.stringify({ msg: 'hi' }) }));
  return { statusCode: 200 };
};`,
      py: `def handler(event, context):
    ctx = event["requestContext"]
    api = boto3.client("apigatewaymanagementapi", endpoint_url=f"https://{ctx['domainName']}/{ctx['stage']}")
    api.post_to_connection(ConnectionId=ctx["connectionId"], Data=json.dumps({"msg": "hi"}))
    return {"statusCode": 200}`,
    },
    {
      id: 'out-destinations',
      title: 'Async destinations (onSuccess / onFailure)',
      note: 'Configured on the function, not in code. The destination (SQS/SNS/EventBridge/Lambda) receives this envelope wrapping your input and result.',
      lang: 'json',
      js: `{
  "version": "1.0",
  "timestamp": "2026-07-31T12:00:00Z",
  "requestContext": { "requestId": "abc", "functionArn": "arn:...:function:fn", "condition": "Success", "approximateInvokeCount": 1 },
  "requestPayload": { "orderId": "42" },
  "responseContext": { "statusCode": 200, "executedVersion": "$LATEST" },
  "responsePayload": { "total": 9.99 }
}`,
      py: `{
  "version": "1.0",
  "timestamp": "2026-07-31T12:00:00Z",
  "requestContext": { "requestId": "abc", "functionArn": "arn:...:function:fn", "condition": "Success", "approximateInvokeCount": 1 },
  "requestPayload": { "orderId": "42" },
  "responseContext": { "statusCode": 200, "executedVersion": "$LATEST" },
  "responsePayload": { "total": 9.99 }
}`,
    },
  ],
};

const databases: Group = {
  id: 'databases',
  title: 'Database data operations',
  blurb:
    'Fast, copy-paste CRUD for every current AWS database family plus Redshift. SDK-only examples use the import block; protocol databases show the dependency to bundle and assume the table or collection already exists.',
  snippets: [
    {
      id: 'svc-dynamodb',
      title: 'DynamoDB (document client)',
      note: 'The document client marshals native JS types (and the boto3 resource does the same in Python). ExpressionAttributeNames aliases reserved words like name or count via a # prefix.',
      js: `const got = await ddb.send(new GetCommand({
  TableName: 'my-table',
  Key: { pk: 'user#42', sk: 'profile' },
  ConsistentRead: false,
  ProjectionExpression: '#n, email',
  ExpressionAttributeNames: { '#n': 'name' },
}));
const item = got.Item;

await ddb.send(new PutCommand({
  TableName: 'my-table',
  Item: { pk: 'user#42', sk: 'profile', name: 'Ann', email: 'a@b.ch', ts: Date.now() },
  ConditionExpression: 'attribute_not_exists(pk)',
}));

const upd = await ddb.send(new UpdateCommand({
  TableName: 'my-table',
  Key: { pk: 'user#42', sk: 'profile' },
  UpdateExpression: 'SET email = :e ADD #c :one',
  ConditionExpression: 'attribute_exists(pk)',
  ExpressionAttributeNames: { '#c': 'hits' },
  ExpressionAttributeValues: { ':e': 'a@b.ch', ':one': 1 },
  ReturnValues: 'ALL_NEW',
}));

await ddb.send(new DeleteCommand({
  TableName: 'my-table',
  Key: { pk: 'user#42', sk: 'profile' },
  ConditionExpression: 'attribute_exists(pk)',
}));

const q = await ddb.send(new QueryCommand({
  TableName: 'my-table',
  IndexName: 'gsi1',
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :s)',
  FilterExpression: 'active = :a',
  ExpressionAttributeValues: { ':pk': 'user#42', ':s': 'order#', ':a': true },
  ScanIndexForward: false,
  Limit: 25,
  ExclusiveStartKey: undefined,
}));
const items = q.Items;
const nextPage = q.LastEvaluatedKey;

const scanned = await ddb.send(new ScanCommand({
  TableName: 'my-table',
  FilterExpression: 'active = :a',
  ExpressionAttributeValues: { ':a': true },
  Limit: 100,
}));

let pending = { 'my-table': [
    { PutRequest: { Item: { pk: 'a', sk: '1' } } },
    { DeleteRequest: { Key: { pk: 'b', sk: '2' } } },
  ] };
do {
  const batch = await ddb.send(new BatchWriteCommand({ RequestItems: pending }));
  pending = batch.UnprocessedItems ?? {};
} while (Object.keys(pending).length);`,
      py: `table = ddb.Table("my-table")

got = table.get_item(
    Key={"pk": "user#42", "sk": "profile"},
    ConsistentRead=False,
    ProjectionExpression="#n, email",
    ExpressionAttributeNames={"#n": "name"},
)
item = got.get("Item")

table.put_item(
    Item={"pk": "user#42", "sk": "profile", "name": "Ann", "email": "a@b.ch"},
    ConditionExpression=Attr("pk").not_exists(),
)

upd = table.update_item(
    Key={"pk": "user#42", "sk": "profile"},
    UpdateExpression="SET email = :e ADD hits :one",
    ConditionExpression=Attr("pk").exists(),
    ExpressionAttributeValues={":e": "a@b.ch", ":one": 1},
    ReturnValues="ALL_NEW",
)

table.delete_item(
    Key={"pk": "user#42", "sk": "profile"},
    ConditionExpression=Attr("pk").exists(),
)

q = table.query(
    IndexName="gsi1",
    KeyConditionExpression=Key("pk").eq("user#42") & Key("sk").begins_with("order#"),
    FilterExpression=Attr("active").eq(True),
    ScanIndexForward=False,
    Limit=25,
)
items = q["Items"]
next_page = q.get("LastEvaluatedKey")

scanned = table.scan(FilterExpression=Attr("active").eq(True), Limit=100)

with table.batch_writer() as batch:
    batch.put_item(Item={"pk": "a", "sk": "1"})
    batch.delete_item(Key={"pk": "b", "sk": "2"})`,
    },
    {
      id: 'svc-rds-data-api',
      title: 'RDS Data API (Aurora — no VPC, no driver)',
      note: "AWS's simplest way to run SQL from Lambda when the database is Aurora (MySQL- or PostgreSQL-compatible): plain HTTPS calls, no VPC networking, no connection pool, no driver to bundle. Needs the Data API turned on for the cluster and a Secrets Manager secret holding the DB credentials. Standard (non-Aurora) RDS cannot use it, see RDS Proxy below for that.",
      js: `const resourceArn = 'arn:aws:rds:eu-central-1:111122223333:cluster:my-aurora-cluster';
const secretArn = 'arn:aws:secretsmanager:eu-central-1:111122223333:secret:my-db-secret';
const database = 'app';

await rdsData.send(new ExecuteStatementCommand({
  resourceArn, secretArn, database,
  sql: 'INSERT INTO users (id, name, email) VALUES (:id, :name, :email)',
  parameters: [
    { name: 'id', value: { longValue: 1 } },
    { name: 'name', value: { stringValue: 'Ann' } },
    { name: 'email', value: { stringValue: 'a@b.ch' } },
  ],
}));

const got = await rdsData.send(new ExecuteStatementCommand({
  resourceArn, secretArn, database,
  sql: 'SELECT id, name, email FROM users WHERE id = :id',
  parameters: [{ name: 'id', value: { longValue: 1 } }],
  formatRecordsAs: 'JSON',
}));
const rows = JSON.parse(got.formattedRecords);

await rdsData.send(new ExecuteStatementCommand({
  resourceArn, secretArn, database,
  sql: 'UPDATE users SET email = :email WHERE id = :id',
  parameters: [{ name: 'email', value: { stringValue: 'new@b.ch' } }, { name: 'id', value: { longValue: 1 } }],
}));

await rdsData.send(new ExecuteStatementCommand({
  resourceArn, secretArn, database,
  sql: 'DELETE FROM users WHERE id = :id',
  parameters: [{ name: 'id', value: { longValue: 1 } }],
}));`,
      py: `resource_arn = "arn:aws:rds:eu-central-1:111122223333:cluster:my-aurora-cluster"
secret_arn = "arn:aws:secretsmanager:eu-central-1:111122223333:secret:my-db-secret"
database = "app"

rds_data.execute_statement(
    resourceArn=resource_arn, secretArn=secret_arn, database=database,
    sql="INSERT INTO users (id, name, email) VALUES (:id, :name, :email)",
    parameters=[
        {"name": "id", "value": {"longValue": 1}},
        {"name": "name", "value": {"stringValue": "Ann"}},
        {"name": "email", "value": {"stringValue": "a@b.ch"}},
    ],
)

got = rds_data.execute_statement(
    resourceArn=resource_arn, secretArn=secret_arn, database=database,
    sql="SELECT id, name, email FROM users WHERE id = :id",
    parameters=[{"name": "id", "value": {"longValue": 1}}],
    formatRecordsAs="JSON",
)
rows = json.loads(got["formattedRecords"])

rds_data.execute_statement(
    resourceArn=resource_arn, secretArn=secret_arn, database=database,
    sql="UPDATE users SET email = :email WHERE id = :id",
    parameters=[{"name": "email", "value": {"stringValue": "new@b.ch"}}, {"name": "id", "value": {"longValue": 1}}],
)

rds_data.execute_statement(
    resourceArn=resource_arn, secretArn=secret_arn, database=database,
    sql="DELETE FROM users WHERE id = :id",
    parameters=[{"name": "id", "value": {"longValue": 1}}],
)`,
    },
    {
      id: 'svc-rds-proxy',
      title: 'RDS via RDS Proxy (MySQL / MariaDB IAM auth)',
      note: 'Use RDS Proxy for supported engines: MySQL, MariaDB, PostgreSQL, and SQL Server. It does not support Oracle or Db2, and SQL Server cannot use this password-token pattern. This is the MySQL/MariaDB IAM-auth shape; PostgreSQL is equivalent with pg. The role needs rds-db:connect and the driver must be bundled.',
      js: `// build + publish the driver as a layer once:
// mkdir -p layer/nodejs && npm install mysql2 --prefix layer/nodejs
// curl -o layer/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
// cd layer && zip -r mysql2-layer.zip nodejs global-bundle.pem
// aws lambda publish-layer-version --layer-name mysql2 --zip-file fileb://mysql2-layer.zip --compatible-runtimes nodejs20.x
// aws lambda update-function-configuration --function-name my-fn --layers arn:aws:lambda:eu-central-1:111122223333:layer:mysql2:1

import mysql from 'mysql2/promise'; // not in the runtime: the layer above

const signer = new Signer({
  hostname: process.env.DB_PROXY_HOST,
  port: 3306,
  username: process.env.DB_USER,
  region: 'eu-central-1',
});

const conn = await mysql.createConnection({
  host: process.env.DB_PROXY_HOST,
  port: 3306,
  user: process.env.DB_USER,
  database: 'app',
  password: await signer.getAuthToken(),
  ssl: { ca: readFileSync('/opt/global-bundle.pem') },
});

await conn.execute('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', [1, 'Ann', 'a@b.ch']);
const [rows] = await conn.execute('SELECT id, name, email FROM users WHERE id = ?', [1]);
await conn.execute('UPDATE users SET email = ? WHERE id = ?', ['new@b.ch', 1]);
await conn.execute('DELETE FROM users WHERE id = ?', [1]);
await conn.end();`,
      py: `# build + publish the driver as a layer once:
# mkdir -p layer/python && pip install pymysql -t layer/python
# curl -o layer/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
# cd layer && zip -r pymysql-layer.zip python global-bundle.pem
# aws lambda publish-layer-version --layer-name pymysql --zip-file fileb://pymysql-layer.zip --compatible-runtimes python3.13
# aws lambda update-function-configuration --function-name my-fn --layers arn:aws:lambda:eu-central-1:111122223333:layer:pymysql:1

import pymysql  # not in the runtime: the layer above

token = rds.generate_db_auth_token(
    DBHostname=os.environ["DB_PROXY_HOST"], Port=3306, DBUsername=os.environ["DB_USER"], Region="eu-central-1"
)

conn = pymysql.connect(
    host=os.environ["DB_PROXY_HOST"],
    port=3306,
    user=os.environ["DB_USER"],
    database="app",
    password=token,
    auth_plugin_map={"mysql_clear_password": None},
    ssl_ca="/opt/global-bundle.pem",
    ssl_verify_cert=True,
    ssl_verify_identity=True,
)

with conn.cursor() as cur:
    cur.execute("INSERT INTO users (id, name, email) VALUES (%s, %s, %s)", (1, "Ann", "a@b.ch"))
    cur.execute("SELECT id, name, email FROM users WHERE id = %s", (1,))
    rows = cur.fetchall()
    cur.execute("UPDATE users SET email = %s WHERE id = %s", ("new@b.ch", 1))
    cur.execute("DELETE FROM users WHERE id = %s", (1,))
conn.commit()
conn.close()`,
    },
    {
      id: 'db-dsql',
      title: 'Aurora DSQL (PostgreSQL wire protocol)',
      note: 'Bundle the AWS Aurora DSQL connector and its PostgreSQL peer driver. The connector creates short-lived IAM tokens automatically; the Lambda role needs dsql:DbConnectAdmin for user admin (use dsql:DbConnect for a mapped custom role).',
      js: `// npm install @aws/aurora-dsql-node-postgres-connector @aws-sdk/credential-providers @aws-sdk/dsql-signer pg
import { AuroraDSQLClient } from '@aws/aurora-dsql-node-postgres-connector';

const conn = new AuroraDSQLClient({
  host: process.env.DSQL_HOST,
  user: 'admin',
  database: 'postgres',
});

await conn.connect();
try {
  await conn.query('INSERT INTO users (id, name, email) VALUES ($1, $2, $3)', [1, 'Ann', 'a@b.ch']);
  const got = await conn.query('SELECT id, name, email FROM users WHERE id = $1', [1]);
  const rows = got.rows;
  await conn.query('UPDATE users SET email = $1 WHERE id = $2', ['new@b.ch', 1]);
  await conn.query('DELETE FROM users WHERE id = $1', [1]);
} finally {
  await conn.end();
}`,
      py: `# pip install aurora-dsql-python-connector "psycopg[binary]" into the function package or a layer
import aurora_dsql_psycopg as dsql

conn = dsql.connect(host=os.environ["DSQL_HOST"], region=os.environ["AWS_REGION"], user="admin", dbname="postgres")
try:
    with conn.cursor() as cur:
        cur.execute("INSERT INTO users (id, name, email) VALUES (%s, %s, %s)", (1, "Ann", "a@b.ch"))
        cur.execute("SELECT id, name, email FROM users WHERE id = %s", (1,))
        rows = cur.fetchall()
        cur.execute("UPDATE users SET email = %s WHERE id = %s", ("new@b.ch", 1))
        cur.execute("DELETE FROM users WHERE id = %s", (1,))
    conn.commit()
finally:
    conn.close()`,
    },
    {
      id: 'db-redshift',
      title: 'Amazon Redshift Data API (Serverless or provisioned)',
      note: 'No VPC attachment or SQL driver is needed. ExecuteStatement is asynchronous, so the helper waits for FINISHED before returning and fetches rows only for SELECT. Use WorkgroupName for Serverless; replace it with ClusterIdentifier plus DbUser or SecretArn for provisioned Redshift.',
      js: `const redshiftRun = async (Sql, Parameters = []) => {
  const submitted = await redshiftData.send(new RedshiftExecuteStatementCommand({
    WorkgroupName: 'my-workgroup',
    Database: 'dev',
    Sql,
    Parameters,
  }));
  let statement;
  do {
    await new Promise((resolve) => setTimeout(resolve, 200));
    statement = await redshiftData.send(new DescribeStatementCommand({ Id: submitted.Id }));
  } while (statement.Status === 'SUBMITTED' || statement.Status === 'PICKED' || statement.Status === 'STARTED');
  if (statement.Status !== 'FINISHED') throw new Error(statement.Error ?? statement.Status);
  return statement.HasResultSet
    ? redshiftData.send(new GetStatementResultCommand({ Id: submitted.Id }))
    : statement;
};

await redshiftRun('INSERT INTO users (id, name, email) VALUES (:id, :name, :email)', [
  { name: 'id', value: '1' }, { name: 'name', value: 'Ann' }, { name: 'email', value: 'a@b.ch' },
]);
const got = await redshiftRun('SELECT id, name, email FROM users WHERE id = :id', [{ name: 'id', value: '1' }]);
const rows = got.Records;
await redshiftRun('UPDATE users SET email = :email WHERE id = :id', [
  { name: 'email', value: 'new@b.ch' }, { name: 'id', value: '1' },
]);
await redshiftRun('DELETE FROM users WHERE id = :id', [{ name: 'id', value: '1' }]);`,
      py: `def redshift_run(sql, parameters=None):
    submitted = redshift_data.execute_statement(
        WorkgroupName="my-workgroup", Database="dev", Sql=sql, Parameters=parameters or []
    )
    while True:
        statement = redshift_data.describe_statement(Id=submitted["Id"])
        if statement["Status"] not in ("SUBMITTED", "PICKED", "STARTED"):
            break
        time.sleep(0.2)
    if statement["Status"] != "FINISHED":
        raise RuntimeError(statement.get("Error") or statement["Status"])
    return redshift_data.get_statement_result(Id=submitted["Id"]) if statement["HasResultSet"] else statement

redshift_run("INSERT INTO users (id, name, email) VALUES (:id, :name, :email)", [
    {"name": "id", "value": "1"}, {"name": "name", "value": "Ann"}, {"name": "email", "value": "a@b.ch"},
])
got = redshift_run("SELECT id, name, email FROM users WHERE id = :id", [{"name": "id", "value": "1"}])
rows = got["Records"]
redshift_run("UPDATE users SET email = :email WHERE id = :id", [
    {"name": "email", "value": "new@b.ch"}, {"name": "id", "value": "1"},
])
redshift_run("DELETE FROM users WHERE id = :id", [{"name": "id", "value": "1"}])`,
    },
    {
      id: 'db-documentdb',
      title: 'Amazon DocumentDB (MongoDB API)',
      note: 'Put mongodb / pymongo and the AWS global RDS CA bundle in a layer, attach Lambda to the cluster VPC, and store username/password/host in Secrets Manager. retryWrites must stay false because DocumentDB does not support retryable writes.',
      js: `// npm install mongodb; place global-bundle.pem at /opt/global-bundle.pem
import { MongoClient } from 'mongodb';

const cfg = JSON.parse((await secrets.send(new GetSecretValueCommand({ SecretId: 'prod/documentdb' }))).SecretString);
const uri = 'mongodb://' + encodeURIComponent(cfg.username) + ':' + encodeURIComponent(cfg.password) + '@' + cfg.host + ':27017/app';
const mongo = new MongoClient(uri, {
  tls: true,
  tlsCAFile: '/opt/global-bundle.pem',
  replicaSet: 'rs0',
  readPreference: 'primaryPreferred',
  retryWrites: false,
  authSource: 'admin',
});

await mongo.connect();
try {
  const users = mongo.db('app').collection('users');
  await users.insertOne({ _id: 'user#42', name: 'Ann', email: 'a@b.ch' });
  const item = await users.findOne({ _id: 'user#42' });
  await users.updateOne({ _id: 'user#42' }, { $set: { email: 'new@b.ch' } });
  await users.deleteOne({ _id: 'user#42' });
} finally {
  await mongo.close();
}`,
      py: `# pip install pymongo into the function package or a layer; place global-bundle.pem at /opt/global-bundle.pem
import pymongo
from urllib.parse import quote_plus

cfg = json.loads(secrets.get_secret_value(SecretId="prod/documentdb")["SecretString"])
uri = "mongodb://" + quote_plus(cfg["username"]) + ":" + quote_plus(cfg["password"]) + "@" + cfg["host"] + ":27017/app"
mongo = pymongo.MongoClient(
    uri, tls=True, tlsCAFile="/opt/global-bundle.pem", replicaSet="rs0",
    readPreference="primaryPreferred", retryWrites=False, authSource="admin",
)
try:
    users = mongo.app.users
    users.insert_one({"_id": "user#42", "name": "Ann", "email": "a@b.ch"})
    item = users.find_one({"_id": "user#42"})
    users.update_one({"_id": "user#42"}, {"$set": {"email": "new@b.ch"}})
    users.delete_one({"_id": "user#42"})
finally:
    mongo.close()`,
    },
    {
      id: 'db-keyspaces',
      title: 'Amazon Keyspaces (Cassandra / CQL)',
      note: "Bundle the Cassandra driver and CA bundle. This short version uses IAM service-specific credentials from Secrets Manager; for temporary Lambda-role credentials, bundle AWS's SigV4 Cassandra plugin instead. The regional endpoint is public unless you configure an interface VPC endpoint.",
      js: `// npm install cassandra-driver; place keyspaces-bundle.pem at /opt/keyspaces-bundle.pem
import cassandra from 'cassandra-driver';

const region = process.env.AWS_REGION;
const cfg = JSON.parse((await secrets.send(new GetSecretValueCommand({ SecretId: 'prod/keyspaces' }))).SecretString);
const keyspaces = new cassandra.Client({
  contactPoints: ['cassandra.' + region + '.amazonaws.com'],
  localDataCenter: region,
  authProvider: new cassandra.auth.PlainTextAuthProvider(cfg.username, cfg.password),
  sslOptions: { ca: [readFileSync('/opt/keyspaces-bundle.pem')], host: 'cassandra.' + region + '.amazonaws.com', rejectUnauthorized: true },
  protocolOptions: { port: 9142 },
});

await keyspaces.connect();
try {
  await keyspaces.execute('INSERT INTO app.users (id, name, email) VALUES (?, ?, ?)', ['42', 'Ann', 'a@b.ch'], { prepare: true });
  const got = await keyspaces.execute('SELECT id, name, email FROM app.users WHERE id = ?', ['42'], { prepare: true });
  const rows = got.rows;
  await keyspaces.execute('UPDATE app.users SET email = ? WHERE id = ?', ['new@b.ch', '42'], { prepare: true });
  await keyspaces.execute('DELETE FROM app.users WHERE id = ?', ['42'], { prepare: true });
} finally {
  await keyspaces.shutdown();
}`,
      py: `# pip install cassandra-driver into the function package or a layer; place keyspaces-bundle.pem at /opt/keyspaces-bundle.pem
from cassandra.auth import PlainTextAuthProvider
from cassandra.cluster import Cluster
from ssl import SSLContext, PROTOCOL_TLS_CLIENT

region = os.environ["AWS_REGION"]
cfg = json.loads(secrets.get_secret_value(SecretId="prod/keyspaces")["SecretString"])
tls = SSLContext(PROTOCOL_TLS_CLIENT)
tls.load_verify_locations("/opt/keyspaces-bundle.pem")
cluster = Cluster(
    ["cassandra." + region + ".amazonaws.com"], port=9142, ssl_context=tls,
    auth_provider=PlainTextAuthProvider(username=cfg["username"], password=cfg["password"]),
)
session = cluster.connect()
try:
    session.execute("INSERT INTO app.users (id, name, email) VALUES (%s, %s, %s)", ("42", "Ann", "a@b.ch"))
    rows = session.execute("SELECT id, name, email FROM app.users WHERE id = %s", ("42",)).all()
    session.execute("UPDATE app.users SET email = %s WHERE id = %s", ("new@b.ch", "42"))
    session.execute("DELETE FROM app.users WHERE id = %s", ("42",))
finally:
    cluster.shutdown()`,
    },
    {
      id: 'db-neptune',
      title: 'Amazon Neptune Database (openCypher Data API)',
      note: 'The SDK signs requests, so no graph driver is needed. Lambda still needs network access to the Neptune cluster endpoint and neptune-db read/write/delete query permissions. Retries are disabled because retrying a mutation that is still running can duplicate work.',
      js: `const neptune = new NeptunedataClient({
  endpoint: 'https://' + process.env.NEPTUNE_HOST + ':8182',
  maxAttempts: 1,
});
const cypher = (openCypherQuery, parameters = {}) => neptune.send(new ExecuteOpenCypherQueryCommand({
  openCypherQuery,
  parameters: JSON.stringify(parameters),
}));

await cypher('CREATE (u:User {id: $id, name: $name, email: $email})', { id: '42', name: 'Ann', email: 'a@b.ch' });
const got = await cypher('MATCH (u:User {id: $id}) RETURN u', { id: '42' });
const rows = got.results;
await cypher('MATCH (u:User {id: $id}) SET u.email = $email', { id: '42', email: 'new@b.ch' });
await cypher('MATCH (u:User {id: $id}) DETACH DELETE u', { id: '42' });`,
      py: `from botocore.config import Config

neptune = boto3.client(
    "neptunedata",
    endpoint_url="https://" + os.environ["NEPTUNE_HOST"] + ":8182",
    config=Config(read_timeout=None, retries={"total_max_attempts": 1}),
)

def cypher(query, parameters=None):
    return neptune.execute_open_cypher_query(
        openCypherQuery=query, parameters=json.dumps(parameters or {})
    )

cypher("CREATE (u:User {id: $id, name: $name, email: $email})", {"id": "42", "name": "Ann", "email": "a@b.ch"})
got = cypher("MATCH (u:User {id: $id}) RETURN u", {"id": "42"})
rows = got["results"]
cypher("MATCH (u:User {id: $id}) SET u.email = $email", {"id": "42", "email": "new@b.ch"})
cypher("MATCH (u:User {id: $id}) DETACH DELETE u", {"id": "42"})`,
    },
    {
      id: 'db-timestream',
      title: 'Amazon Timestream for LiveAnalytics',
      note: 'WriteRecords inserts and upserts time-series points; a larger Version wins for the same dimensions, measure name, and timestamp. Reads are eventually consistent and there is no record-level delete operation—expire data with retention or delete the table.',
      js: `const ts = String(Date.now());
const point = (value, version) => ({
  Dimensions: [{ Name: 'device_id', Value: 'sensor-42' }],
  MeasureName: 'temperature',
  MeasureValue: String(value),
  MeasureValueType: 'DOUBLE',
  Time: ts,
  TimeUnit: 'MILLISECONDS',
  Version: version,
});

await timestreamWrite.send(new WriteRecordsCommand({
  DatabaseName: 'app', TableName: 'readings', Records: [point(21.5, 1)],
}));
await timestreamWrite.send(new WriteRecordsCommand({
  DatabaseName: 'app', TableName: 'readings', Records: [point(22.0, 2)],
}));

const got = await timestreamQuery.send(new TimestreamQueryCommand({
  QueryString: "SELECT device_id, time, measure_value::double AS temperature FROM app.readings WHERE device_id = 'sensor-42' ORDER BY time DESC LIMIT 20",
}));
const rows = got.Rows;`,
      py: `ts = str(int(time.time() * 1000))

def point(value, version):
    return {
        "Dimensions": [{"Name": "device_id", "Value": "sensor-42"}],
        "MeasureName": "temperature",
        "MeasureValue": str(value),
        "MeasureValueType": "DOUBLE",
        "Time": ts,
        "TimeUnit": "MILLISECONDS",
        "Version": version,
    }

timestream_write.write_records(DatabaseName="app", TableName="readings", Records=[point(21.5, 1)])
timestream_write.write_records(DatabaseName="app", TableName="readings", Records=[point(22.0, 2)])

got = timestream_query.query(
    QueryString="SELECT device_id, time, measure_value::double AS temperature FROM app.readings WHERE device_id = 'sensor-42' ORDER BY time DESC LIMIT 20"
)
rows = got["Rows"]`,
    },
    {
      id: 'db-elasticache',
      title: 'Amazon ElastiCache (Valkey / Redis OSS)',
      note: 'Bundle redis / redis-py and run Lambda in the cache VPC. This targets ElastiCache Serverless or a cluster-mode-disabled primary endpoint with TLS and password auth; for cluster mode enabled, use createCluster / RedisCluster with the configuration endpoint.',
      js: `// npm install redis into the function package or a layer
import { createClient } from 'redis';

const redis = createClient({
  url: 'rediss://' + encodeURIComponent(process.env.CACHE_USER) + ':' + encodeURIComponent(process.env.CACHE_PASSWORD) + '@' + process.env.CACHE_HOST + ':6379',
});
redis.on('error', (err) => console.error(err));
await redis.connect();
try {
  await redis.set('user:42', JSON.stringify({ name: 'Ann', email: 'a@b.ch' }), { EX: 3600 });
  const item = JSON.parse(await redis.get('user:42'));
  await redis.hSet('user:42:profile', { name: 'Ann', email: 'new@b.ch' });
  const profile = await redis.hGetAll('user:42:profile');
  await redis.del('user:42', 'user:42:profile');
} finally {
  await redis.close();
}`,
      py: `# pip install redis into the function package or a layer
import redis

cache = redis.Redis(
    host=os.environ["CACHE_HOST"], port=6379, ssl=True,
    username=os.environ["CACHE_USER"], password=os.environ["CACHE_PASSWORD"],
    decode_responses=True,
)
cache.set("user:42", json.dumps({"name": "Ann", "email": "a@b.ch"}), ex=3600)
item = json.loads(cache.get("user:42"))
cache.hset("user:42:profile", mapping={"name": "Ann", "email": "new@b.ch"})
profile = cache.hgetall("user:42:profile")
cache.delete("user:42", "user:42:profile")
cache.close()`,
    },
    {
      id: 'db-elasticache-memcached',
      title: 'Amazon ElastiCache (Memcached)',
      note: 'Bundle memcache-client / pymemcache and run Lambda in the cache VPC. The serverless cache endpoint requires TLS; set overwrites an existing key, so it doubles as the update operation.',
      js: `// npm install memcache-client into the function package or a layer
import { MemcacheClient } from 'memcache-client';

const cache = new MemcacheClient({
  server: process.env.MEMCACHED_HOST + ':11211',
  tls: {},
});
await cache.set('user:42', JSON.stringify({ name: 'Ann', email: 'a@b.ch' }), { lifetime: 3600 });
const item = JSON.parse((await cache.get('user:42')).value);
await cache.set('user:42', JSON.stringify({ name: 'Ann', email: 'new@b.ch' }), { lifetime: 3600 });
await cache.delete('user:42');
cache.shutdown();`,
      py: `# pip install pymemcache into the function package or a layer
import ssl
from pymemcache.client.base import Client

cache = Client((os.environ["MEMCACHED_HOST"], 11211), tls_context=ssl.create_default_context())
cache.set("user:42", json.dumps({"name": "Ann", "email": "a@b.ch"}), expire=3600, noreply=False)
item = json.loads(cache.get("user:42"))
cache.set("user:42", json.dumps({"name": "Ann", "email": "new@b.ch"}), expire=3600, noreply=False)
cache.delete("user:42", noreply=False)
cache.close()`,
    },
    {
      id: 'db-memorydb',
      title: 'Amazon MemoryDB (Valkey / Redis OSS)',
      note: 'Bundle redis / redis-py and run Lambda in the MemoryDB VPC. MemoryDB is cluster-mode enabled, so use a cluster-aware client against the cluster endpoint. This concise version uses an ACL username/password; IAM auth can replace the password with a 15-minute signed token.',
      js: `// npm install redis into the function package or a layer
import { createCluster } from 'redis';

const memorydb = createCluster({
  rootNodes: [{ url: 'rediss://' + encodeURIComponent(process.env.MEMORYDB_USER) + ':' + encodeURIComponent(process.env.MEMORYDB_PASSWORD) + '@' + process.env.MEMORYDB_HOST + ':6379' }],
  defaults: { socket: { tls: true } },
});
memorydb.on('error', (err) => console.error(err));
await memorydb.connect();
try {
  await memorydb.set('user:42', JSON.stringify({ name: 'Ann', email: 'a@b.ch' }));
  const item = JSON.parse(await memorydb.get('user:42'));
  await memorydb.hSet('user:42:profile', { name: 'Ann', email: 'new@b.ch' });
  const profile = await memorydb.hGetAll('user:42:profile');
  await memorydb.del('user:42', 'user:42:profile');
} finally {
  await memorydb.close();
}`,
      py: `# pip install redis into the function package or a layer
from redis.cluster import RedisCluster

memorydb = RedisCluster(
    host=os.environ["MEMORYDB_HOST"], port=6379, ssl=True,
    username=os.environ["MEMORYDB_USER"], password=os.environ["MEMORYDB_PASSWORD"],
    decode_responses=True,
)
memorydb.set("user:42", json.dumps({"name": "Ann", "email": "a@b.ch"}))
item = json.loads(memorydb.get("user:42"))
memorydb.hset("user:42:profile", mapping={"name": "Ann", "email": "new@b.ch"})
profile = memorydb.hgetall("user:42:profile")
memorydb.delete("user:42", "user:42:profile")
memorydb.close()`,
    },
  ],
};

const services: Group = {
  id: 'services',
  title: 'Other service usage',
  blurb:
    'Drop-in SDK calls for the other services you reach from a handler. They use clients from the import block; paste that once and any call below drops straight in.',
  snippets: [
    {
      id: 'svc-s3',
      title: 'S3 objects',
      note: 'In v3 the Body is a stream, so transformToString / transformToByteArray to read it. getSignedUrl (from the import block) mints a time-limited URL.',
      js: `const got = await s3.send(new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'path/file.json',
  Range: 'bytes=0-1023',
}));
const text = await got.Body.transformToString();

await s3.send(new PutObjectCommand({
  Bucket: 'my-bucket',
  Key: 'path/file.json',
  Body: JSON.stringify({ ok: true }),
  ContentType: 'application/json',
  CacheControl: 'max-age=60',
  Metadata: { owner: 'ann' },
}));

await s3.send(new DeleteObjectCommand({ Bucket: 'my-bucket', Key: 'path/file.json' }));

const list = await s3.send(new ListObjectsV2Command({
  Bucket: 'my-bucket',
  Prefix: 'path/',
  Delimiter: '/',
  MaxKeys: 1000,
  ContinuationToken: undefined,
}));
const keys = (list.Contents ?? []).map((o) => o.Key);

await s3.send(new CopyObjectCommand({ Bucket: 'my-bucket', Key: 'dst.json', CopySource: 'my-bucket/path/file.json' }));

const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: 'my-bucket', Key: 'path/file.json' }), { expiresIn: 3600 });`,
      py: `got = s3.get_object(Bucket="my-bucket", Key="path/file.json")  # Range="bytes=0-1023"
text = got["Body"].read().decode()

s3.put_object(
    Bucket="my-bucket",
    Key="path/file.json",
    Body=json.dumps({"ok": True}),
    ContentType="application/json",
    CacheControl="max-age=60",
    Metadata={"owner": "ann"},
)

s3.delete_object(Bucket="my-bucket", Key="path/file.json")

lst = s3.list_objects_v2(Bucket="my-bucket", Prefix="path/", Delimiter="/", MaxKeys=1000)
keys = [o["Key"] for o in lst.get("Contents", [])]

s3.copy_object(Bucket="my-bucket", Key="dst.json", CopySource="my-bucket/path/file.json")

url = s3.generate_presigned_url("get_object", Params={"Bucket": "my-bucket", "Key": "path/file.json"}, ExpiresIn=3600)`,
    },
    {
      id: 'svc-sqs-receive',
      title: 'SQS manual receive + delete',
      note: 'For when you poll a queue yourself instead of using an event source mapping. WaitTimeSeconds turns on long polling; delete each message once handled or it comes back.',
      js: `const recv = await sqs.send(new ReceiveMessageCommand({
  QueueUrl: process.env.QUEUE,
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 20,
  VisibilityTimeout: 30,
  MessageAttributeNames: ['All'],
  AttributeNames: ['All'],
}));
for (const m of recv.Messages ?? []) {
  console.log(m.MessageId, m.Body, m.Attributes, m.MessageAttributes);
  await sqs.send(new DeleteMessageCommand({ QueueUrl: process.env.QUEUE, ReceiptHandle: m.ReceiptHandle }));
}`,
      py: `recv = sqs.receive_message(
    QueueUrl=os.environ["QUEUE"],
    MaxNumberOfMessages=10,
    WaitTimeSeconds=20,
    VisibilityTimeout=30,
    MessageAttributeNames=["All"],
    AttributeNames=["All"],
)
for m in recv.get("Messages", []):
    print(m["MessageId"], m["Body"], m.get("Attributes"), m.get("MessageAttributes"))
    sqs.delete_message(QueueUrl=os.environ["QUEUE"], ReceiptHandle=m["ReceiptHandle"])`,
    },
    {
      id: 'svc-secrets',
      title: 'Secrets Manager · getSecret(name or ARN)',
      js: `import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secrets = new SecretsManagerClient({});

async function getSecret(id) {
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: id }));
  if (res.SecretString !== undefined) return res.SecretString;
  if (res.SecretBinary !== undefined) return Buffer.from(res.SecretBinary);
  throw new Error('Secret has no value');
}

const value = await getSecret('prod/api-key');
const credentials = JSON.parse(await getSecret('prod/db'));`,
      py: `import boto3
import json

secrets = boto3.client("secretsmanager")

def getSecret(id):
    res = secrets.get_secret_value(SecretId=id)
    if "SecretString" in res:
        return res["SecretString"]
    if "SecretBinary" in res:
        return res["SecretBinary"]
    raise ValueError("Secret has no value")

value = getSecret("prod/api-key")
credentials = json.loads(getSecret("prod/db"))`,
    },
    {
      id: 'svc-ssm-reader',
      title: 'SSM Parameter Store · getParam(name or ARN)',
      js: `import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

async function getParam(id) {
  const res = await ssm.send(new GetParameterCommand({ Name: id, WithDecryption: true }));
  if (res.Parameter?.Value !== undefined) return res.Parameter.Value;
  throw new Error('Parameter has no value');
}

const value = await getParam('/app/db/url');
const config = JSON.parse(await getParam('/app/config'));`,
      py: `import boto3
import json

ssm = boto3.client("ssm")

def getParam(id):
    return ssm.get_parameter(Name=id, WithDecryption=True)["Parameter"]["Value"]

value = getParam("/app/db/url")
config = json.loads(getParam("/app/config"))`,
    },
    {
      id: 'svc-ssm',
      title: 'SSM Parameter Store',
      note: 'WithDecryption is needed for SecureString params. GetParametersByPath pages 10 at a time, follow NextToken for more.',
      js: `const p = await ssm.send(new GetParameterCommand({ Name: '/app/db/url', WithDecryption: true }));
const value = p.Parameter.Value;

const many = await ssm.send(new GetParametersByPathCommand({
  Path: '/app/',
  Recursive: true,
  WithDecryption: true,
}));

await ssm.send(new PutParameterCommand({ Name: '/app/flag', Value: 'on', Type: 'String', Overwrite: true }));`,
      py: `value = ssm.get_parameter(Name="/app/db/url", WithDecryption=True)["Parameter"]["Value"]

many = ssm.get_parameters_by_path(Path="/app/", Recursive=True, WithDecryption=True)["Parameters"]

ssm.put_parameter(Name="/app/flag", Value="on", Type="String", Overwrite=True)`,
    },
    {
      id: 'svc-appconfig',
      title: 'AppConfig (feature flags / config profiles)',
      note: 'Live reload: cache the token + config at module scope (outside the handler) so a warm container reuses them, and only poll again once RequiredMinimumPollIntervalInSeconds has passed. An empty Configuration on a poll means nothing changed, keep the cached value. Writing a new version and rolling it out goes through the AppConfigClient control plane instead.',
      js: `let token, config, nextPollAt = 0;

const getConfig = async () => {
  if (!token) {
    const session = await appconfigdata.send(new StartConfigurationSessionCommand({
      ApplicationIdentifier: 'my-app',
      EnvironmentIdentifier: 'prod',
      ConfigurationProfileIdentifier: 'feature-flags',
      RequiredMinimumPollIntervalInSeconds: 15,
    }));
    token = session.InitialConfigurationToken;
  }
  if (Date.now() < nextPollAt) return config;

  const cfg = await appconfigdata.send(new GetLatestConfigurationCommand({ ConfigurationToken: token }));
  token = cfg.NextPollConfigurationToken;
  nextPollAt = Date.now() + (cfg.NextPollIntervalInSeconds ?? 15) * 1000;
  if (cfg.Configuration?.length) config = JSON.parse(Buffer.from(cfg.Configuration).toString());
  return config;
};

export const handler = async (event) => {
  const cfg = await getConfig();
  return { enabled: cfg.enableBeta };
};

// deploying a new version is a control-plane call, not something the handler above does
const version = await appconfig.send(new CreateHostedConfigurationVersionCommand({
  ApplicationId: 'app-id',
  ConfigurationProfileId: 'profile-id',
  ContentType: 'application/json',
  Content: Buffer.from(JSON.stringify({ enableBeta: true })),
}));

await appconfig.send(new StartDeploymentCommand({
  ApplicationId: 'app-id',
  EnvironmentId: 'env-id',
  DeploymentStrategyId: 'AppConfig.AllAtOnce',
  ConfigurationProfileId: 'profile-id',
  ConfigurationVersion: String(version.VersionNumber),
}));`,
      py: `token = None
config = None
next_poll_at = 0

def get_config():
    global token, config, next_poll_at
    if not token:
        session = appconfigdata.start_configuration_session(
            ApplicationIdentifier="my-app",
            EnvironmentIdentifier="prod",
            ConfigurationProfileIdentifier="feature-flags",
            RequiredMinimumPollIntervalInSeconds=15,
        )
        token = session["InitialConfigurationToken"]
    if time.time() < next_poll_at:
        return config

    cfg = appconfigdata.get_latest_configuration(ConfigurationToken=token)
    token = cfg["NextPollConfigurationToken"]
    next_poll_at = time.time() + cfg.get("NextPollIntervalInSeconds", 15)
    body = cfg["Configuration"].read()
    if body:
        config = json.loads(body)
    return config

def handler(event, context):
    cfg = get_config()
    return {"enabled": cfg["enableBeta"]}

# deploying a new version is a control-plane call, not something the handler above does
version = appconfig.create_hosted_configuration_version(
    ApplicationId="app-id",
    ConfigurationProfileId="profile-id",
    ContentType="application/json",
    Content=json.dumps({"enableBeta": True}).encode(),
)

appconfig.start_deployment(
    ApplicationId="app-id",
    EnvironmentId="env-id",
    DeploymentStrategyId="AppConfig.AllAtOnce",
    ConfigurationProfileId="profile-id",
    ConfigurationVersion=str(version["VersionNumber"]),
)`,
    },
    {
      id: 'svc-ses',
      title: 'SES v2 send email',
      note: 'While the account is in the sandbox both sender and recipient must be verified. Drop Html or Text if you only send one.',
      js: `await ses.send(new SendEmailCommand({
  FromEmailAddress: 'no-reply@my.ch',
  Destination: { ToAddresses: ['to@x.ch'], CcAddresses: [], BccAddresses: [] },
  ReplyToAddresses: ['reply@my.ch'],
  Content: { Simple: {
    Subject: { Data: 'Hello' },
    Body: { Text: { Data: 'plain text' }, Html: { Data: '<b>hi</b>' } },
  } },
}));`,
      py: `ses.send_email(
    FromEmailAddress="no-reply@my.ch",
    Destination={"ToAddresses": ["to@x.ch"], "CcAddresses": [], "BccAddresses": []},
    ReplyToAddresses=["reply@my.ch"],
    Content={"Simple": {
        "Subject": {"Data": "Hello"},
        "Body": {"Text": {"Data": "plain text"}, "Html": {"Data": "<b>hi</b>"}},
    }},
)`,
    },
    {
      id: 'svc-cloudwatch',
      title: 'CloudWatch custom metric',
      note: 'Dimensions make a metric filterable. For hot paths skip the SDK and print an EMF JSON log line instead, the platform turns it into a metric for free.',
      js: `await cw.send(new PutMetricDataCommand({
  Namespace: 'MyApp',
  MetricData: [{
    MetricName: 'OrdersPlaced',
    Value: 1,
    Unit: 'Count',
    Timestamp: new Date(),
    Dimensions: [{ Name: 'env', Value: 'prod' }],
  }],
}));`,
      py: `cw.put_metric_data(
    Namespace="MyApp",
    MetricData=[{
        "MetricName": "OrdersPlaced",
        "Value": 1,
        "Unit": "Count",
        "Dimensions": [{"Name": "env", "Value": "prod"}],
    }],
)`,
    },
    {
      id: 'svc-kms',
      title: 'KMS encrypt / decrypt',
      note: 'EncryptionContext must match on decrypt or it fails. Plaintext caps at 4 KB, use GenerateDataKey for envelope-encrypting larger payloads.',
      js: `const enc = await kms.send(new EncryptCommand({
  KeyId: 'alias/my-key',
  Plaintext: Buffer.from('secret'),
  EncryptionContext: { app: 'orders' },
}));
const blob = enc.CiphertextBlob;

const dec = await kms.send(new DecryptCommand({
  CiphertextBlob: blob,
  EncryptionContext: { app: 'orders' },
}));
const plain = Buffer.from(dec.Plaintext).toString();`,
      py: `enc = kms.encrypt(KeyId="alias/my-key", Plaintext=b"secret", EncryptionContext={"app": "orders"})
blob = enc["CiphertextBlob"]

dec = kms.decrypt(CiphertextBlob=blob, EncryptionContext={"app": "orders"})
plain = dec["Plaintext"].decode()`,
    },
    {
      id: 'svc-sts',
      title: 'STS identity and assume role',
      note: 'GetCallerIdentity is the who-am-I check. Feed the returned Credentials into a fresh client to act as the assumed cross-account role.',
      js: `const me = await sts.send(new GetCallerIdentityCommand({}));
console.log(me.Account, me.Arn, me.UserId);

const role = await sts.send(new AssumeRoleCommand({
  RoleArn: 'arn:aws:iam::111122223333:role/cross',
  RoleSessionName: 'lambda',
  DurationSeconds: 3600,
  ExternalId: 'shared-secret',
}));
const c = role.Credentials;

const s3assumed = new S3Client({ credentials: {
  accessKeyId: c.AccessKeyId,
  secretAccessKey: c.SecretAccessKey,
  sessionToken: c.SessionToken,
} });`,
      py: `me = sts.get_caller_identity()
print(me["Account"], me["Arn"], me["UserId"])

role = sts.assume_role(
    RoleArn="arn:aws:iam::111122223333:role/cross",
    RoleSessionName="lambda",
    DurationSeconds=3600,
    ExternalId="shared-secret",
)
c = role["Credentials"]

s3_assumed = boto3.client("s3",
    aws_access_key_id=c["AccessKeyId"],
    aws_secret_access_key=c["SecretAccessKey"],
    aws_session_token=c["SessionToken"])`,
    },
    {
      id: 'svc-stepfunctions',
      title: 'Step Functions start execution',
      note: 'StartExecution is async fire-and-forget. StartSyncExecution only works on EXPRESS state machines and returns the output inline.',
      js: `const exec = await sfn.send(new StartExecutionCommand({
  stateMachineArn: 'arn:aws:states:eu-central-1:111122223333:stateMachine:flow',
  name: 'run-' + Date.now(),
  input: JSON.stringify({ orderId: '42' }),
}));

const sync = await sfn.send(new StartSyncExecutionCommand({
  stateMachineArn: 'arn:aws:states:eu-central-1:111122223333:stateMachine:express',
  input: JSON.stringify({ orderId: '42' }),
}));
const out = JSON.parse(sync.output);`,
      py: `sfn.start_execution(
    stateMachineArn="arn:aws:states:eu-central-1:111122223333:stateMachine:flow",
    name="run-" + str(int(time.time())),
    input=json.dumps({"orderId": "42"}),
)

sync = sfn.start_sync_execution(
    stateMachineArn="arn:aws:states:eu-central-1:111122223333:stateMachine:express",
    input=json.dumps({"orderId": "42"}),
)
out = json.loads(sync["output"])`,
    },
    {
      id: 'svc-bedrock',
      title: 'Bedrock invoke model',
      note: 'The body is the provider schema, this is the Amazon Nova format (schemaVersion messages-v1). Swap modelId for amazon.nova-micro-v1:0 / amazon.nova-pro-v1:0; other providers use their own body shape. InvokeModelWithResponseStream streams tokens.',
      js: `const res = await bedrock.send(new InvokeModelCommand({
  modelId: 'amazon.nova-lite-v1:0',
  contentType: 'application/json',
  accept: 'application/json',
  body: JSON.stringify({
    schemaVersion: 'messages-v1',
    messages: [{ role: 'user', content: [{ text: 'Say hi' }] }],
    inferenceConfig: { maxTokens: 512, temperature: 0.7 },
  }),
}));
const out = JSON.parse(Buffer.from(res.body).toString());
const text = out.output.message.content[0].text;`,
      py: `res = bedrock.invoke_model(
    modelId="amazon.nova-lite-v1:0",
    contentType="application/json",
    accept="application/json",
    body=json.dumps({
        "schemaVersion": "messages-v1",
        "messages": [{"role": "user", "content": [{"text": "Say hi"}]}],
        "inferenceConfig": {"maxTokens": 512, "temperature": 0.7},
    }),
)
out = json.loads(res["body"].read())
text = out["output"]["message"]["content"][0]["text"]`,
    },
    {
      id: 'svc-kafka',
      title: 'Kafka produce (MSK / self-managed)',
      note: 'kafkajs / kafka-python are not in the Lambda runtime, so this snippet keeps its own import and producer. Ship the dep as a layer or bundle it. Connect once then reuse the producer across invokes.',
      js: `import { Kafka } from 'kafkajs'; // not in the runtime: add a kafkajs layer (nodejs/node_modules/kafkajs) or bundle it
const kafka = new Kafka({ clientId: 'lambda', brokers: (process.env.BROKERS ?? '').split(',') });
const producer = kafka.producer();

await producer.connect();
await producer.send({
  topic: 'orders',
  acks: -1,
  messages: [
    { key: 'order-42', value: JSON.stringify({ orderId: '42' }), partition: 0, headers: { trace: 'abc' } },
  ],
});`,
      py: `from kafka import KafkaProducer  # not in the runtime: add a kafka-python layer (python/kafka) or bundle it
producer = KafkaProducer(bootstrap_servers=os.environ.get("BROKERS", "").split(","))

producer.send(
    "orders",
    key=b"order-42",
    value=json.dumps({"orderId": "42"}).encode(),
    partition=0,
    headers=[("trace", b"abc")],
)
producer.flush()`,
    },
    {
      id: 'svc-cognito',
      title: 'Cognito admin APIs',
      note: 'Admin calls run with the function role, no user session needed. MessageAction SUPPRESS skips the invite email so you can set the password yourself.',
      js: `const UserPoolId = 'eu-central-1_abc123';

const user = await idp.send(new AdminGetUserCommand({ UserPoolId, Username: 'ann@x.ch' }));

await idp.send(new AdminCreateUserCommand({
  UserPoolId,
  Username: 'ann@x.ch',
  UserAttributes: [{ Name: 'email', Value: 'ann@x.ch' }, { Name: 'email_verified', Value: 'true' }],
  MessageAction: 'SUPPRESS',
  DesiredDeliveryMediums: ['EMAIL'],
}));

await idp.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: 'ann@x.ch', Password: 'S3cret-pw', Permanent: true }));`,
      py: `pool = "eu-central-1_abc123"

user = idp.admin_get_user(UserPoolId=pool, Username="ann@x.ch")

idp.admin_create_user(
    UserPoolId=pool,
    Username="ann@x.ch",
    UserAttributes=[{"Name": "email", "Value": "ann@x.ch"}, {"Name": "email_verified", "Value": "true"}],
    MessageAction="SUPPRESS",
    DesiredDeliveryMediums=["EMAIL"],
)

idp.admin_set_user_password(UserPoolId=pool, Username="ann@x.ch", Password="S3cret-pw", Permanent=True)`,
    },
  ],
};

export const groups: Group[] = [common, incoming, outgoing, databases, services, drivers];

export default groups;

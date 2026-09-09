import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { escapeHtml } from './local-logs.mjs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import {
  RedshiftDataClient,
  ExecuteStatementCommand as RedshiftExecuteStatementCommand,
  DescribeStatementCommand,
  GetStatementResultCommand,
} from '@aws-sdk/client-redshift-data';
import { NeptunedataClient, ExecuteOpenCypherQueryCommand } from '@aws-sdk/client-neptunedata';
import {
  TimestreamQueryClient,
  QueryCommand as TimestreamQueryCommand,
} from '@aws-sdk/client-timestream-query';
import { TimestreamWriteClient, WriteRecordsCommand } from '@aws-sdk/client-timestream-write';
import { Signer } from '@aws-sdk/rds-signer';

const secrets = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const rdsData = new RDSDataClient({});
const redshift = new RedshiftDataClient({});
const timestreamQuery = new TimestreamQueryClient({});
const timestreamWrite = new TimestreamWriteClient({});
const secretCache = new Map();
let connectionCache;

const EXAMPLES = {
  dynamodb: '{\n  "operation": "scan",\n  "input": { "Limit": 25 }\n}',
  'rds-data': 'SELECT id, name, email FROM users ORDER BY id DESC LIMIT 25',
  dsql: 'SELECT id, name, email FROM users ORDER BY id DESC LIMIT 25',
  redshift: 'SELECT id, name, email FROM users ORDER BY id DESC LIMIT 25',
  'rds-proxy-mysql': 'SELECT id, name, email FROM users ORDER BY id DESC LIMIT 25',
  'rds-proxy-postgres': 'SELECT id, name, email FROM users ORDER BY id DESC LIMIT 25',
  documentdb:
    '{\n  "operation": "find",\n  "collection": "users",\n  "filter": {},\n  "options": { "limit": 25 }\n}',
  keyspaces: 'SELECT id, name, email FROM app.users LIMIT 25',
  neptune: 'MATCH (u:User) RETURN u.id, u.name, u.email LIMIT 25',
  timestream:
    'SELECT device_id, time, measure_value::double AS value\nFROM app.readings\nORDER BY time DESC LIMIT 25',
  elasticache: '["GET", "user:42"]',
  memcached: '{ "operation": "get", "key": "user:42" }',
  memorydb: '["GET", "user:42"]',
};

const LANGUAGE = {
  dynamodb: 'DynamoDB JSON',
  'rds-data': 'PostgreSQL / MySQL SQL',
  dsql: 'PostgreSQL SQL',
  redshift: 'Redshift SQL',
  'rds-proxy-mysql': 'MySQL SQL',
  'rds-proxy-postgres': 'PostgreSQL SQL',
  documentdb: 'MongoDB JSON',
  keyspaces: 'CQL',
  neptune: 'openCypher',
  timestream: 'Timestream SQL / WriteRecords JSON',
  elasticache: 'Redis command',
  memcached: 'Memcached JSON',
  memorydb: 'Redis command',
};

function json(value) {
  return JSON.stringify(value, (_, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Uint8Array) return Buffer.from(item).toString('base64');
    if (item instanceof Date) return item.toISOString();
    return item;
  });
}

async function getSecret(id) {
  if (!id) return {};
  if (!secretCache.has(id)) {
    const response = await secrets.send(new GetSecretValueCommand({ SecretId: id }));
    secretCache.set(id, JSON.parse(response.SecretString));
  }
  return secretCache.get(id);
}

async function connections(signal) {
  if (connectionCache) return connectionCache;
  if (process.env.DB_CONNECTIONS) connectionCache = JSON.parse(process.env.DB_CONNECTIONS);
  else if (process.env.DB_CONNECTIONS_SECRET) {
    const response = await secrets.send(
      new GetSecretValueCommand({ SecretId: process.env.DB_CONNECTIONS_SECRET }),
      { abortSignal: signal },
    );
    connectionCache = JSON.parse(response.SecretString);
  } else connectionCache = [];
  if (!Array.isArray(connectionCache)) throw new Error('DB connections must be a JSON array');
  return connectionCache;
}

function safeConnections(items) {
  return items.map(({ id, label, type, dialect, readOnly }) => ({
    id,
    label: label ?? id,
    type,
    dialect,
    readOnly: Boolean(readOnly),
    language: LANGUAGE[type] ?? type,
    example: EXAMPLES[type] ?? '',
  }));
}

function assertWritable(connection, statement) {
  if (!connection.readOnly) return;
  const mutation =
    /\b(insert|update|delete|create|drop|alter|truncate|merge|copy|unload|set|remove|write|put|batchwrite)\b/i;
  if (mutation.test(statement)) throw new Error(connection.label + ' is configured as read-only');
}

function parameters(value) {
  if (value == null || value === '') return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error('Parameters must be a JSON array');
  return parsed;
}

async function runDynamo(connection, statement) {
  const request = JSON.parse(statement);
  const operation = String(request.operation ?? '').toLowerCase();
  const Commands = {
    get: GetCommand,
    put: PutCommand,
    update: UpdateCommand,
    delete: DeleteCommand,
    query: QueryCommand,
    scan: ScanCommand,
    batchwrite: BatchWriteCommand,
  };
  const Command = Commands[operation];
  if (!Command)
    throw new Error(
      'DynamoDB operation must be get, put, update, delete, query, scan, or batchWrite',
    );
  const input = {
    ...(connection.table ? { TableName: connection.table } : {}),
    ...(request.input ?? {}),
  };
  return ddb.send(new Command(input));
}

async function runRdsData(connection, statement, params) {
  const output = await rdsData.send(
    new ExecuteStatementCommand({
      resourceArn: connection.resourceArn,
      secretArn: connection.secretArn,
      database: connection.database,
      sql: statement,
      parameters: params,
      formatRecordsAs: 'JSON',
      includeResultMetadata: true,
    }),
  );
  return output.formattedRecords ? JSON.parse(output.formattedRecords) : output;
}

async function runDsql(connection, statement, params) {
  const { AuroraDSQLClient } = await import('@aws/aurora-dsql-node-postgres-connector');
  const client = new AuroraDSQLClient({
    host: connection.host,
    user: connection.user ?? 'admin',
    database: connection.database ?? 'postgres',
  });
  await client.connect();
  try {
    const output = await client.query(
      statement,
      params.map(item => item.value ?? item),
    );
    return {
      rows: output.rows,
      rowCount: output.rowCount,
      fields: output.fields?.map(field => field.name),
    };
  } finally {
    await client.end();
  }
}

async function runRedshift(connection, statement, params) {
  const submitted = await redshift.send(
    new RedshiftExecuteStatementCommand({
      Database: connection.database,
      WorkgroupName: connection.workgroupName,
      ClusterIdentifier: connection.clusterIdentifier,
      DbUser: connection.dbUser,
      SecretArn: connection.secretArn,
      Sql: statement,
      Parameters: params,
    }),
  );
  let status;
  do {
    await new Promise(resolve => setTimeout(resolve, 250));
    status = await redshift.send(new DescribeStatementCommand({ Id: submitted.Id }));
  } while (['SUBMITTED', 'PICKED', 'STARTED'].includes(status.Status));
  if (status.Status !== 'FINISHED') throw new Error(status.Error ?? status.Status);
  if (!status.HasResultSet) return status;

  const rows = [];
  let columns = [];
  let nextToken;
  const maxRows = Number(process.env.DB_WORKBENCH_MAX_ROWS ?? 5000);
  do {
    const page = await redshift.send(
      new GetStatementResultCommand({ Id: submitted.Id, NextToken: nextToken }),
    );
    columns = page.ColumnMetadata?.map((column, index) => column.name ?? String(index)) ?? columns;
    for (const record of page.Records ?? []) {
      rows.push(
        Object.fromEntries(
          record.map((field, index) => [
            columns[index] ?? String(index),
            Object.values(field).find(value => value !== undefined),
          ]),
        ),
      );
    }
    nextToken = page.NextToken;
  } while (nextToken && rows.length < maxRows);

  return { rows, columns, truncated: Boolean(nextToken), nextToken };
}

async function runMysql(connection, statement, params) {
  const imported = await import('mysql2/promise');
  const mysql = imported.default ?? imported;
  const credential = await getSecret(connection.secretId);
  const user = connection.user ?? credential.username;
  const password = connection.iam
    ? await new Signer({
        hostname: connection.host,
        port: connection.port ?? 3306,
        username: user,
        region: process.env.AWS_REGION,
      }).getAuthToken()
    : credential.password;
  const client = await mysql.createConnection({
    host: connection.host,
    port: connection.port ?? 3306,
    user,
    password,
    database: connection.database,
    ssl: connection.ca ? { ca: readFileSync(connection.ca) } : undefined,
  });
  try {
    const [rows, fields] = await client.execute(
      statement,
      params.map(item => item.value ?? item),
    );
    return { rows, fields: fields?.map(field => field.name) };
  } finally {
    await client.end();
  }
}

async function runPostgres(connection, statement, params) {
  const imported = await import('pg');
  const Client = imported.Client ?? imported.default?.Client;
  const credential = await getSecret(connection.secretId);
  const user = connection.user ?? credential.username;
  const password = connection.iam
    ? await new Signer({
        hostname: connection.host,
        port: connection.port ?? 5432,
        username: user,
        region: process.env.AWS_REGION,
      }).getAuthToken()
    : credential.password;
  const client = new Client({
    host: connection.host,
    port: connection.port ?? 5432,
    user,
    password,
    database: connection.database,
    ssl: connection.ca ? { ca: readFileSync(connection.ca), rejectUnauthorized: true } : true,
  });
  await client.connect();
  try {
    const output = await client.query(
      statement,
      params.map(item => item.value ?? item),
    );
    return {
      rows: output.rows,
      rowCount: output.rowCount,
      fields: output.fields?.map(field => field.name),
    };
  } finally {
    await client.end();
  }
}

async function runDocumentDb(connection, statement) {
  const { MongoClient } = await import('mongodb');
  const credential = await getSecret(connection.secretId);
  const uri =
    'mongodb://' +
    encodeURIComponent(credential.username) +
    ':' +
    encodeURIComponent(credential.password) +
    '@' +
    connection.host +
    ':27017/';
  const client = new MongoClient(uri, {
    tls: true,
    tlsCAFile: connection.ca,
    replicaSet: 'rs0',
    readPreference: 'primaryPreferred',
    retryWrites: false,
    authSource: 'admin',
  });
  const request = JSON.parse(statement);
  await client.connect();
  try {
    const collection = client
      .db(request.database ?? connection.database)
      .collection(request.collection);
    if (request.operation === 'find')
      return collection
        .find(request.filter ?? {}, request.options ?? {})
        .limit(request.options?.limit ?? 100)
        .toArray();
    if (request.operation === 'findOne')
      return collection.findOne(request.filter ?? {}, request.options ?? {});
    if (request.operation === 'insertOne')
      return collection.insertOne(request.document, request.options ?? {});
    if (request.operation === 'updateOne')
      return collection.updateOne(request.filter ?? {}, request.update, request.options ?? {});
    if (request.operation === 'deleteOne')
      return collection.deleteOne(request.filter ?? {}, request.options ?? {});
    throw new Error(
      'DocumentDB operation must be find, findOne, insertOne, updateOne, or deleteOne',
    );
  } finally {
    await client.close();
  }
}

async function runKeyspaces(connection, statement, params) {
  const imported = await import('cassandra-driver');
  const cassandra = imported.default ?? imported;
  const credential = await getSecret(connection.secretId);
  const region = process.env.AWS_REGION;
  const host = connection.host ?? 'cassandra.' + region + '.amazonaws.com';
  const client = new cassandra.Client({
    contactPoints: [host],
    localDataCenter: region,
    authProvider: new cassandra.auth.PlainTextAuthProvider(
      credential.username,
      credential.password,
    ),
    sslOptions: { ca: [readFileSync(connection.ca)], host, rejectUnauthorized: true },
    protocolOptions: { port: 9142 },
  });
  await client.connect();
  try {
    const output = await client.execute(
      statement,
      params.map(item => item.value ?? item),
      { prepare: true },
    );
    return { rows: output.rows, pageState: output.pageState?.toString('base64') };
  } finally {
    await client.shutdown();
  }
}

async function runNeptune(connection, statement, params) {
  const client = new NeptunedataClient({
    endpoint: 'https://' + connection.host + ':' + (connection.port ?? 8182),
    maxAttempts: 1,
  });
  return client.send(
    new ExecuteOpenCypherQueryCommand({
      openCypherQuery: statement,
      parameters: JSON.stringify(
        Object.fromEntries(
          params.map((item, index) => [item.name ?? String(index), item.value ?? item]),
        ),
      ),
    }),
  );
}

async function runTimestream(connection, statement) {
  if (statement.trimStart().startsWith('{')) {
    const request = JSON.parse(statement);
    return timestreamWrite.send(
      new WriteRecordsCommand({
        DatabaseName: request.DatabaseName ?? connection.database,
        TableName: request.TableName ?? connection.table,
        CommonAttributes: request.CommonAttributes,
        Records: request.Records,
      }),
    );
  }
  return timestreamQuery.send(new TimestreamQueryCommand({ QueryString: statement }));
}

async function runRedis(connection, statement) {
  const redis = await import('redis');
  const credential = await getSecret(connection.secretId);
  const auth = credential.username
    ? encodeURIComponent(credential.username) + ':' + encodeURIComponent(credential.password) + '@'
    : credential.password
      ? ':' + encodeURIComponent(credential.password) + '@'
      : '';
  const url = 'rediss://' + auth + connection.host + ':' + (connection.port ?? 6379);
  const client =
    connection.cluster || connection.type === 'memorydb'
      ? redis.createCluster({ rootNodes: [{ url }], defaults: { socket: { tls: true } } })
      : redis.createClient({ url });
  await client.connect();
  try {
    const command = JSON.parse(statement);
    if (!Array.isArray(command) || !command.length)
      throw new Error('Redis statement must be a JSON command array');
    return client.sendCommand(command.map(String));
  } finally {
    await client.close();
  }
}

async function runMemcached(connection, statement) {
  const { MemcacheClient } = await import('memcache-client');
  const client = new MemcacheClient({
    server: connection.host + ':' + (connection.port ?? 11211),
    tls: {},
  });
  const request = JSON.parse(statement);
  try {
    if (request.operation === 'get') return await client.get(request.key);
    if (request.operation === 'set')
      return await client.set(request.key, request.value, { lifetime: request.ttl ?? 60 });
    if (request.operation === 'delete') return await client.delete(request.key);
    throw new Error('Memcached operation must be get, set, or delete');
  } finally {
    client.shutdown();
  }
}

async function execute(request) {
  const all = await connections();
  const connection = all.find(item => item.id === request.connectionId);
  if (!connection) throw new Error('Unknown connection: ' + request.connectionId);
  const statement = String(request.statement ?? '');
  if (!statement.trim()) throw new Error('Statement is empty');
  assertWritable(connection, statement);
  const params = parameters(request.parameters);
  const started = performance.now();
  let result;

  if (connection.type === 'dynamodb') result = await runDynamo(connection, statement);
  else if (connection.type === 'rds-data') result = await runRdsData(connection, statement, params);
  else if (connection.type === 'dsql') result = await runDsql(connection, statement, params);
  else if (connection.type === 'redshift')
    result = await runRedshift(connection, statement, params);
  else if (connection.type === 'rds-proxy-mysql')
    result = await runMysql(connection, statement, params);
  else if (connection.type === 'rds-proxy-postgres')
    result = await runPostgres(connection, statement, params);
  else if (connection.type === 'documentdb') result = await runDocumentDb(connection, statement);
  else if (connection.type === 'keyspaces')
    result = await runKeyspaces(connection, statement, params);
  else if (connection.type === 'neptune') result = await runNeptune(connection, statement, params);
  else if (connection.type === 'timestream') result = await runTimestream(connection, statement);
  else if (connection.type === 'elasticache' || connection.type === 'memorydb')
    result = await runRedis(connection, statement);
  else if (connection.type === 'memcached') result = await runMemcached(connection, statement);
  else throw new Error('Unsupported connection type: ' + connection.type);

  return {
    result,
    meta: {
      connectionId: connection.id,
      connectionType: connection.type,
      language: LANGUAGE[connection.type],
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      requestId: request.requestId,
    },
  };
}

function generatedLambdaCode(request) {
  const payload = JSON.stringify(
    {
      gadget: 'database-query',
      connectionId: request.connectionId,
      statement: request.statement,
      parameters: request.parameters ? JSON.parse(request.parameters) : [],
    },
    null,
    2,
  );
  return `import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});
const payload = ${payload};

const invocation = await lambda.send(new InvokeCommand({
  FunctionName: process.env.DB_WORKBENCH_FUNCTION,
  InvocationType: 'RequestResponse',
  Payload: Buffer.from(JSON.stringify(payload)),
}));

if (invocation.FunctionError) throw new Error(Buffer.from(invocation.Payload).toString());
const response = JSON.parse(Buffer.from(invocation.Payload).toString());
if (!response.ok) throw new Error(response.error.message);

const result = response.result;
console.log('query metadata', response.meta);
console.log('query result', result);`;
}

function http(event = {}) {
  if (!event.requestContext?.http && !event.httpMethod) return null;
  return {
    method: event.requestContext?.http?.method ?? event.httpMethod,
    path: event.rawPath ?? event.path ?? '/',
    headers: event.headers ?? {},
    body:
      event.body == null
        ? ''
        : event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString()
          : event.body,
  };
}

function authorized(event) {
  const password = process.env.DB_WORKBENCH_PASSWORD;
  if (!password) return true;
  const user = process.env.DB_WORKBENCH_USER ?? 'database';
  const expected = 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
  return (event.headers?.authorization ?? event.headers?.Authorization) === expected;
}

function jsonResponse(value, statusCode = 200) {
  const body = json(value);
  if (Buffer.byteLength(body) > 5_500_000) {
    return jsonResponse(
      {
        ok: false,
        error: {
          name: 'ResultTooLarge',
          message: 'Result exceeded 5.5 MB. Add LIMIT or projection.',
        },
      },
      413,
    );
  }
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body,
  };
}

function htmlResponse(body, statusCode = 200, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
    body,
  };
}

function inlineJson(value) {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}

function dashboardPage(model) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lambda Database Workbench</title>
<style>:root{color-scheme:dark;--bg:#080a0f;--panel:#10141d;--line:#293142;--text:#edf3ff;--muted:#8994a8;--green:#69e6ad;--blue:#73cfff;--purple:#b39aff;--red:#ff728b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -20%,#26315a,transparent 38rem),var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,sans-serif}button,textarea,input{font:inherit}.app{max-width:1700px;margin:auto;padding:22px}.head{display:flex;justify-content:space-between;align-items:start;gap:20px;margin-bottom:18px}.eyebrow{font-size:11px;letter-spacing:.17em;text-transform:uppercase;color:var(--green);font-weight:800}.head h1{font-size:clamp(26px,4vw,42px);margin:3px 0}.muted{color:var(--muted)}.status{padding:8px 11px;border:1px solid #315c4d;background:#10251e;border-radius:999px;color:var(--green)}.grid{display:grid;grid-template-columns:290px minmax(0,1fr);gap:13px}.panel{background:#0e131dcc;border:1px solid var(--line);border-radius:16px;overflow:hidden;backdrop-filter:blur(12px)}.panel-head{padding:13px 15px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}.connections{max-height:calc(100vh - 170px);overflow:auto}.connection{width:100%;display:flex;gap:11px;align-items:center;border:0;border-bottom:1px solid #202838;background:transparent;color:inherit;text-align:left;padding:12px 14px;cursor:pointer}.connection:hover,.connection.active{background:#172033}.connection.active{box-shadow:inset 3px 0 var(--green)}.db{width:34px;height:34px;display:grid;place-items:center;border:1px solid #34415a;border-radius:10px;color:var(--blue);font-weight:800}.connection b,.connection span{display:block}.connection span{font-size:11px;color:var(--muted)}.workspace{display:grid;gap:13px}.editor-head,.actions,.tabs{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.editor-head{justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--line)}.badge{padding:4px 8px;border-radius:999px;background:#202a3d;color:var(--blue);font-size:11px;font-weight:800}.editor-grid{display:grid;grid-template-columns:1fr 1fr;min-height:330px}.editor-grid>div{min-width:0}.editor-grid>div+div{border-left:1px solid var(--line)}label{display:block;padding:9px 13px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.source{width:100%;height:280px;resize:vertical;background:#090c12;color:#f2f5fb;border:0;border-top:1px solid #202838;padding:14px;outline:none;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}.preview{height:280px;overflow:auto;background:#090c12;border-top:1px solid #202838;padding:14px;margin:0;white-space:pre-wrap;word-break:break-word;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.params{height:90px}.foot{padding:12px 14px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:8px;align-items:center}.btn{border:1px solid var(--line);background:#171e2b;color:var(--text);border-radius:9px;padding:9px 12px;cursor:pointer}.btn:hover{border-color:#52627e}.run{background:linear-gradient(135deg,#4f78ff,#8159e8);border:0;font-weight:800}.tabs{border-bottom:1px solid var(--line);padding:0 13px}.tab{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);padding:11px;cursor:pointer}.tab.active{color:var(--text);border-color:var(--purple)}.output{padding:14px;min-height:230px;overflow:auto}.code{background:#080b11;border:1px solid #252e40;border-radius:11px;padding:13px;overflow:auto;max-height:520px}.code pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}.kw{color:#c7a0ff;font-weight:700}.str{color:#9be083}.num{color:#ffc66d}.key{color:#75d4ff}.comment{color:#657087}.result-meta{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:12px}.metric{padding:7px 9px;background:#171f2e;border-radius:8px;color:var(--muted)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #242d3e;vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase}.history{padding:10px 14px;border-top:1px solid var(--line)}.history button{margin:3px}.error{color:#ffb1be;border:1px solid #743548;background:#29131b;padding:11px;border-radius:10px}.empty{text-align:center;color:var(--muted);padding:50px 20px}.toast{position:fixed;right:20px;bottom:20px;background:#eef8ff;color:#08101a;padding:10px 14px;border-radius:9px;font-weight:800;opacity:0;transform:translateY(10px);transition:.2s}.toast.show{opacity:1;transform:none}@media(max-width:950px){.grid{grid-template-columns:1fr}.connections{display:flex;max-height:none;overflow:auto}.connection{min-width:230px}.editor-grid{grid-template-columns:1fr}.editor-grid>div+div{border-left:0;border-top:1px solid var(--line)}}@media(max-width:560px){.app{padding:12px}.head{display:block}.status{display:inline-block;margin-top:9px}.foot{align-items:stretch;flex-direction:column}.actions .btn{flex:1}}</style></head>
<body><main class="app"><header class="head"><div><h1>Database Workbench</h1><div class="muted">Run queries and inspect results.</div></div><a class="btn" href="${escapeHtml(model.logsPath)}">Local logs</a><div class="status">● active</div></header><div class="grid"><aside class="panel"><div class="panel-head"><b>Connections</b><span class="muted" id="count"></span></div><div class="connections" id="connections"></div></aside><section class="workspace"><article class="panel"><div class="editor-head"><div><b id="title">Select a connection</b> <span class="badge" id="language"></span></div><div class="actions"><button class="btn" id="example">Reset example</button><button class="btn" id="copy-query">Copy query</button></div></div><div class="editor-grid"><div><label>Statement · Ctrl/⌘ + Enter to run</label><textarea class="source" id="statement" spellcheck="false"></textarea><label>Parameters · JSON array</label><textarea class="source params" id="parameters" spellcheck="false">[]</textarea></div><div><label>Highlighted preview</label><pre class="preview" id="preview"></pre></div></div><div class="foot"><span class="muted" id="safety"></span><button class="btn run" id="run">Run query ▶</button></div><div class="history"><span class="muted">Recent: </span><span id="history"></span></div></article><article class="panel"><div class="tabs"><button class="tab active" data-tab="result">Result</button><button class="tab" data-tab="code">Generated Lambda</button><button class="tab" data-tab="raw">Raw response</button></div><div class="output" id="output"><div class="empty">Query results will appear here.</div></div></article></section></div></main><div class="toast" id="toast">Copied</div><script id="model" type="application/json">${inlineJson(model)}</script>
<script>const model=JSON.parse(document.getElementById('model').textContent),$=id=>document.getElementById(id);let current=model.connections[0],last=null,tab='result';const history=JSON.parse(localStorage.getItem('db-workbench-history')||'[]');const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pretty=v=>JSON.stringify(v,null,2);function color(source,language){let out=h(source);if(/JSON|Redis|Memcached/.test(language)){out=out.replace(/(&quot;.*?&quot;)(\\s*:)?/g,(m,s,c)=>'<span class="'+(c?'key':'str')+'">'+s+'</span>'+(c||'')).replace(/\\b(true|false|null)\\b/g,'<span class="kw">$1</span>').replace(/\\b(-?\\d+(?:\\.\\d+)?)\\b/g,'<span class="num">$1</span>');return out}const words=language==='JavaScript'?'import|from|const|let|await|async|new|if|else|throw|Error|process|Buffer|JSON|console|return':language==='openCypher'?'MATCH|RETURN|WHERE|CREATE|MERGE|SET|DELETE|DETACH|WITH|UNWIND|OPTIONAL|LIMIT|ORDER|BY|ASC|DESC':language==='CQL'?'SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|KEYSPACE|TABLE|PRIMARY|KEY|LIMIT|ALLOW|FILTERING': 'SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|DROP|ALTER|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|NULL|IS|DISTINCT|RETURNING|WITH|UNION|ALL';out=out.replace(new RegExp('\\\\b('+words+')\\\\b','gi'),'<span class="kw">$1</span>').replace(/('(?:''|[^'])*')/g,'<span class="str">$1</span>').replace(/\\b(\\d+(?:\\.\\d+)?)\\b/g,'<span class="num">$1</span>').replace(/(--.*)$/gm,'<span class="comment">$1</span>');return out}function renderConnections(){$('count').textContent=model.connections.length;$('connections').innerHTML=model.connections.length?model.connections.map(c=>'<button class="connection '+(c.id===current?.id?'active':'')+'" data-id="'+h(c.id)+'"><span class="db">'+h(c.type.slice(0,2).toUpperCase())+'</span><span><b>'+h(c.label)+'</b><span>'+h(c.type)+'</span></span></button>').join(''):'<div class="empty">Configure DB_CONNECTIONS_SECRET.</div>';$('connections').querySelectorAll('button').forEach(el=>el.onclick=()=>select(model.connections.find(c=>c.id===el.dataset.id)))}function select(c){current=c;$('title').textContent=c.label;$('language').textContent=c.language;$('safety').textContent=c.readOnly?'Read-only guard enabled':'Writes are allowed for this profile';$('statement').value=c.example;$('parameters').value='[]';renderConnections();preview()}function preview(){$('preview').innerHTML=color($('statement').value,current?.language||'SQL')}function copy(value){navigator.clipboard.writeText(value);$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),900)}function rows(value){if(Array.isArray(value))return value;if(Array.isArray(value?.rows))return value.rows;if(Array.isArray(value?.Items))return value.Items;if(Array.isArray(value?.Records))return value.Records;if(Array.isArray(value?.results))return value.results;if(Array.isArray(value?.Rows))return value.Rows;return null}function renderOutput(){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));if(!last){$('output').innerHTML='<div class="empty">Query results will appear here.</div>';return}if(last.error){$('output').innerHTML='<div class="error">'+h(last.error.name+': '+last.error.message)+'</div>';return}let value=tab==='code'?last.lambdaCode:tab==='raw'?last:last.result;if(tab==='code'){$('output').innerHTML='<div class="actions"><button class="btn" id="copy-code">Copy generated code</button></div><br><div class="code"><pre>'+color(value,'JavaScript')+'</pre></div>';$('copy-code').onclick=()=>copy(value);return}const list=rows(value);let body='<div class="code"><pre>'+color(pretty(value),'JSON')+'</pre></div>';if(tab==='result'&&list?.length&&list.every(x=>x&&typeof x==='object'&&!Array.isArray(x))){const cols=[...new Set(list.flatMap(Object.keys))].slice(0,40);body='<div class="code"><table><thead><tr>'+cols.map(c=>'<th>'+h(c)+'</th>').join('')+'</tr></thead><tbody>'+list.slice(0,250).map(r=>'<tr>'+cols.map(c=>'<td>'+h(typeof r[c]==='object'?pretty(r[c]):r[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}$('output').innerHTML='<div class="result-meta"><span class="metric">'+h(last.meta.connectionType)+'</span><span class="metric">'+h(last.meta.durationMs)+' ms</span><span class="metric">request '+h(last.meta.requestId)+'</span></div>'+body}async function run(){if(!current)return;$('run').disabled=true;$('run').textContent='Running…';try{const response=await fetch('/web/api/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId:current.id,statement:$('statement').value,parameters:$('parameters').value})});last=await response.json();if(!response.ok&&!last.error)last={error:{name:'HTTP '+response.status,message:'Workbench request failed'}};history.unshift({connectionId:current.id,statement:$('statement').value,parameters:$('parameters').value,at:Date.now()});history.splice(8);localStorage.setItem('db-workbench-history',JSON.stringify(history));tab='result';renderHistory();renderOutput()}catch(error){last={error:{name:error.name,message:error.message}};renderOutput()}finally{$('run').disabled=false;$('run').textContent='Run query ▶'}}function renderHistory(){$('history').innerHTML=history.map((x,i)=>'<button class="btn" data-history="'+i+'">'+h(model.connections.find(c=>c.id===x.connectionId)?.label||x.connectionId)+' · '+new Date(x.at).toLocaleTimeString()+'</button>').join('');$('history').querySelectorAll('button').forEach(el=>el.onclick=()=>{const x=history[Number(el.dataset.history)],c=model.connections.find(c=>c.id===x.connectionId);if(c)select(c);$('statement').value=x.statement;$('parameters').value=x.parameters;preview()})}$('statement').oninput=preview;$('statement').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')run()};$('run').onclick=run;$('example').onclick=()=>select(current);$('copy-query').onclick=()=>copy($('statement').value);document.querySelectorAll('.tab').forEach(el=>el.onclick=()=>{tab=el.dataset.tab;renderOutput()});renderConnections();renderHistory();if(current)select(current);</script></body></html>`;
}

export async function databaseWorkbench(event, context = {}) {
  const request = http(event);
  if (!request && event?.gadget !== 'database-query') return null;

  if (!request) {
    try {
      const output = await execute({ ...event, requestId: randomUUID() });
      return { ok: true, ...output };
    } catch (error) {
      console.error('Database invocation failed', error);
      return { ok: false, error: { name: error.name, message: error.message } };
    }
  }

  if (request.path !== '/web' && request.path !== '/web/' && request.path !== '/web/api/query')
    return null;
  if (!authorized(event))
    return htmlResponse('<h1>Authentication required</h1>', 401, {
      'www-authenticate': 'Basic realm="Database workbench"',
    });

  if (request.method === 'GET') {
    try {
      return htmlResponse(
        dashboardPage({
          connections: safeConnections(await connections(context.gadgetAbortSignal)),
          logsPath: request.path.replace(/\/$/, '') + '/logs',
        }),
      );
    } catch (error) {
      console.error('Database dashboard failed', error);
      return htmlResponse(
        '<h1>Workbench configuration error</h1><pre>' +
          escapeHtml(error.message) +
          '</pre><a href="' +
          escapeHtml(request.path.replace(/\/$/, '') + '/logs') +
          '">View local logs</a>',
        500,
      );
    }
  }

  if (request.method === 'POST' && request.path === '/web/api/query') {
    let body;
    try {
      body = JSON.parse(request.body || '{}');
      const output = await execute({ ...body, requestId: randomUUID() });
      return jsonResponse({ ok: true, ...output, lambdaCode: generatedLambdaCode(body) });
    } catch (error) {
      console.error('Database query failed', error);
      return jsonResponse({ ok: false, error: { name: error.name, message: error.message } }, 400);
    }
  }

  return jsonResponse(
    {
      ok: false,
      error: { name: 'MethodNotAllowed', message: 'Use GET /web or POST /web/api/query' },
    },
    405,
  );
}

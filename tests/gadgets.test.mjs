import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

// Exercise the copyable files with an isolated /tmp buffer and a fake CloudWatch service.
// No AWS credentials, network, or dependency installation is needed.
const directory = mkdtempSync(join(tmpdir(), 'gadget-tests-'));
cpSync(new URL('../src/routes/worldskills/gadgets/snippets/', import.meta.url), directory, {
  recursive: true,
});
const file = join(directory, 'buffer.jsonl');
const loggerFile = join(directory, 'local-logs.mjs');
writeFileSync(
  loggerFile,
  readFileSync(loggerFile, 'utf8').replace("'/tmp/lambda-gadget-logs.jsonl'", JSON.stringify(file)),
);
const sdk = join(directory, 'node_modules/@aws-sdk/client-cloudwatch-logs');
mkdirSync(sdk, { recursive: true });
writeFileSync(
  join(sdk, 'package.json'),
  JSON.stringify({ type: 'module', exports: './index.mjs' }),
);
writeFileSync(
  join(sdk, 'index.mjs'),
  `
export class CloudWatchLogsClient { send(command, options) { return globalThis.cloudWatchSend(command.input, options); } }
export class FilterLogEventsCommand { constructor(input) { this.input = input; } }
`,
);
const levels = ['debug', 'info', 'log', 'warn', 'error', 'trace'];
const originals = Object.fromEntries(levels.map(level => [level, console[level]]));
for (const level of levels) console[level] = () => {};
const { withLocalLogs } = await import(pathToFileURL(loggerFile));
const { handler: standalone } = await import(
  pathToFileURL(join(directory, 'local-logs-index.mjs'))
);
const { handler: diagnostics } = await import(pathToFileURL(join(directory, 'index.mjs')));
const { handler: ecr } = await import(pathToFileURL(join(directory, 'ecr-index.mjs')));
const { handler: database } = await import(pathToFileURL(join(directory, 'database-index.mjs')));
const { handler: routedDiagnostics } = await import(
  pathToFileURL(join(directory, 'router-diagnostic-index.mjs'))
);
const context = { awsRequestId: 'request-123', getRemainingTimeInMillis: () => 30_000 };
const http = (path = '/web', headers = {}) => ({
  rawPath: path,
  requestContext: { http: { method: 'GET', path } },
  headers,
});
const entries = response =>
  JSON.parse(
    response.body.match(/<script id="logs" type="application\/json">([\s\S]*?)<\/script>/)[1],
  );
const model = response =>
  JSON.parse(
    response.body.match(
      /<script id="diagnostic-data" type="application\/json">([\s\S]*?)<\/script>/,
    )[1],
  );
const envKeys = [
  'DIAGNOSTIC_PASSWORD',
  'DIAGNOSTIC_USER',
  'ECR_MANAGER_PASSWORD',
  'DB_WORKBENCH_PASSWORD',
];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  rmSync(file, { force: true, recursive: true });
  rmSync(file + '.1', { force: true });
  globalThis.cloudWatchSend = async () => ({ events: [] });
});

test('router composes with diagnostics and local logs before falling through for non-HTTP events', async () => {
  const response = await routedDiagnostics(http('/users/42'), context);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { id: '42' });
  assert.deepEqual(await routedDiagnostics(http('/missing'), context), { ok: true });
  assert.equal((await routedDiagnostics(http('/web'), context)).statusCode, 200);
  assert.ok(entries(await routedDiagnostics(http('/web/logs'), context)).length > 0);
  assert.deepEqual(await routedDiagnostics({ Records: [] }, context), { ok: true });
});
after(() => {
  Object.assign(console, originals);
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  delete globalThis.cloudWatchSend;
  rmSync(directory, { recursive: true, force: true });
});

test('standalone captures application logs and request IDs without AWS calls', async () => {
  globalThis.cloudWatchSend = () => {
    throw new Error('Must not query AWS');
  };
  await standalone(
    { hello: 'world', password: 'hidden', nested: { token: 'also-hidden' } },
    context,
  );
  const response = await standalone(http(), context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const rows = entries(response);
  assert.ok(
    rows.some(row => row.message.includes('hello') && row.requestId === context.awsRequestId),
  );
  assert.match(JSON.stringify(rows), /REDACTED/);
  assert.doesNotMatch(JSON.stringify(rows), /hidden/);
  const before = readFileSync(file, 'utf8');
  await standalone(http('/web/'), context);
  assert.equal(
    readFileSync(file, 'utf8'),
    before,
    'viewer requests should not evict application logs',
  );
  const script = response.body.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Script(script); // Check the actual rendered browser script, including template escaping.
});

test('viewer authentication works for v1/v2, mixed-case headers, and trailing slashes', async () => {
  process.env.DIAGNOSTIC_PASSWORD = 'private';
  assert.equal((await standalone(http(), context)).statusCode, 401);
  assert.equal(
    (await standalone(http('/web', { Authorization: 'Basic wrong' }), context)).statusCode,
    401,
  );
  const auth = 'Basic ' + Buffer.from('diagnostic:private').toString('base64');
  assert.equal(
    (
      await standalone(
        { httpMethod: 'GET', path: '/web/', headers: { AUTHORIZATION: auth } },
        context,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await standalone(
        { ...http('/web', { authorization: auth }), requestContext: { http: { method: 'POST' } } },
        context,
      )
    ).statusCode,
    405,
  );
});

test('console formatting handles errors, cycles, bigint, and script injection safely', async () => {
  const value = {
    n: 42n,
    error: new Error('useful stack'),
    message: '</script><img src=x onerror=alert(1)>',
  };
  value.self = value;
  const handler = withLocalLogs(async () => {
    console.warn('result %o', value);
    return { statusCode: 200, body: 'ok' };
  });
  await handler({}, context);
  const response = await handler(http('/web/logs'), context);
  const text = JSON.stringify(entries(response));
  assert.match(text, /useful stack/);
  assert.match(text, /Circular/);
  assert.match(text, /42n/);
  assert.doesNotMatch(response.body, /<img src=x/);
});

test('logs persist across warm calls, rotate on disk, and keep the latest entry', async () => {
  const handler = withLocalLogs(async () => {
    for (let i = 0; i < 200; i++) console.log('entry-' + i, '<&'.repeat(4000));
    console.log('newest-entry');
    return { statusCode: 200, body: 'ok' };
  });
  await handler({}, context);
  assert.ok(statSync(file).size <= 256 * 1024);
  assert.ok(statSync(file + '.1').size <= 256 * 1024);
  const response = await handler(http('/web/logs'), context);
  assert.match(JSON.stringify(entries(response)), /newest-entry/);
  assert.doesNotMatch(JSON.stringify(entries(response)), /entry-0 /);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 5_500_000);
  const albResponse = await handler(
    { httpMethod: 'GET', path: '/web/logs', requestContext: { elb: {} } },
    context,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(albResponse)) < 900_000);
});

test('oversized console messages are truncated and a partial file does not break the viewer', async () => {
  const handler = withLocalLogs(async () => {
    console.error('\u0000'.repeat(100_000));
    return {};
  });
  await handler({}, context);
  const rows = entries(await handler(http('/web/logs'), context));
  assert.ok(rows.some(row => row.message.includes('[truncated]')));
  for (const line of readFileSync(file, 'utf8').trim().split('\n'))
    assert.ok(Buffer.byteLength(line) <= 16 * 1024);
  writeFileSync(file, '{incomplete\n', { flag: 'a' });
  assert.equal((await handler(http('/web/logs'), context)).statusCode, 200);
});

test('filesystem errors do not fail the application and are visible in the viewer', async () => {
  mkdirSync(file);
  const handler = withLocalLogs(async () => {
    console.log('cannot write');
    return { statusCode: 201, body: 'ok' };
  });
  assert.equal((await handler({}, context)).statusCode, 201);
  const response = await handler(http('/web/logs'), context);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Log storage:/);
});

test('HTTP failures produce readable errors, while event failures still reject for retries', async () => {
  const error = new Error('<broken>');
  const handler = withLocalLogs(async () => {
    throw error;
  });
  const response = await handler(http(), context);
  assert.equal(response.statusCode, 500);
  assert.match(response.body, /&lt;broken&gt;/);
  assert.match(response.body, /request-123/);
  assert.match(JSON.stringify(entries(await handler(http('/web/logs'), context))), /broken/);
  await assert.rejects(handler({ Records: [] }, context), error);
});

test('wrapped applications retain the original Lambda context', async () => {
  const invocationContext = { ...context };
  const handler = withLocalLogs(async (_, received) => {
    assert.equal(received, invocationContext);
    received.callbackWaitsForEmptyEventLoop = false;
    return { ok: true };
  });
  await handler({}, invocationContext);
  assert.equal(invocationContext.callbackWaitsForEmptyEventLoop, false);
});

test('dashboard deadline returns before Lambda timeout and aborts service calls', async () => {
  let signal;
  const handler = withLocalLogs(async (_, ctx) => {
    signal = ctx.gadgetAbortSignal;
    return new Promise(() => {});
  });
  const response = await handler(http(), { ...context, getRemainingTimeInMillis: () => 780 });
  assert.equal(response.statusCode, 504);
  assert.equal(signal.aborted, true);
  assert.match(response.body, /Dashboard timed out/);
  assert.match(
    JSON.stringify(entries(await handler(http('/web/logs'), context))),
    /DashboardTimeout/,
  );
});

test('oversized HTTP results produce an error response instead of a rejected Lambda payload', async () => {
  const handler = withLocalLogs(async () => ({ statusCode: 200, body: 'x'.repeat(6_000_000) }));
  const response = await handler(http(), context);
  assert.equal(response.statusCode, 500);
  assert.match(response.body, /response is too large/);
});

test('missing service packages are captured and local viewer remains available', async () => {
  for (const handler of [ecr, database]) {
    const response = await handler(http(), context);
    assert.equal(response.statusCode, 500);
    assert.match(response.body, /Cannot find package/);
    const logs = await handler(http('/web/logs'), context);
    assert.equal(logs.statusCode, 200);
    assert.match(JSON.stringify(entries(logs)), /Cannot find package/);
  }
  process.env.ECR_MANAGER_PASSWORD = 'ecr-secret';
  assert.equal((await ecr(http('/web/logs'), context)).statusCode, 401);
  process.env.DB_WORKBENCH_PASSWORD = 'db-secret';
  assert.equal((await database(http('/web/logs'), context)).statusCode, 401);
});

test('CloudWatch AccessDenied is displayed in the dashboard and stored locally', async () => {
  globalThis.cloudWatchSend = async () => {
    const error = new Error('Missing logs:FilterLogEvents');
    error.name = 'AccessDeniedException';
    throw error;
  };
  const response = await diagnostics(http(), context);
  assert.equal(response.statusCode, 200);
  assert.match(model(response).error, /AccessDeniedException/);
  assert.match(response.body, /href="\/web\/logs"/);
  assert.match(
    JSON.stringify(entries(await diagnostics(http('/web/logs'), context))),
    /AccessDeniedException/,
  );
});

test('CloudWatch calls receive a shared abort signal and integer query limits', async () => {
  let seen;
  globalThis.cloudWatchSend = async (input, options) => {
    seen = { input, options };
    return { events: [] };
  };
  const response = await diagnostics({ ...http(), rawQueryString: 'limit=20.7' }, context);
  assert.equal(response.statusCode, 200);
  assert.equal(seen.input.limit, 80);
  assert.ok(seen.options.abortSignal instanceof AbortSignal);
  new Script(response.body.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
});

test('stalled CloudWatch reads abort and display the query error before the handler deadline', async () => {
  globalThis.cloudWatchSend = (_, { abortSignal }) =>
    new Promise((_, reject) => {
      abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    });
  const response = await diagnostics(http(), { ...context, getRemainingTimeInMillis: () => 1100 });
  assert.equal(response.statusCode, 200);
  assert.match(model(response).error, /TimeoutError/);
});

test('unexpected diagnostic failures on /web never fall through to the application', async () => {
  const response = await diagnostics({ ...http(), records: { 'topic-0': null } }, context);
  assert.equal(response.statusCode, 500);
  assert.match(response.body, /Lambda diagnostic error/);
  const logs = entries(await diagnostics(http('/web/logs'), context));
  assert.ok(logs.some(row => row.message.includes('unexpected error')));
  assert.ok(logs.every(row => !row.message.includes('Running custom handler')));
});

test('large diagnostic events are omitted before exceeding the serialized response limit', async () => {
  globalThis.cloudWatchSend = async () => ({
    events: Array.from({ length: 10 }, (_, i) => ({
      eventId: 'event-' + i,
      timestamp: i,
      message:
        'LAMBDA_GADGET_EVENT ' +
        JSON.stringify({
          id: 'event-' + i,
          at: i,
          kind: 'direct',
          recognized: [],
          event: { data: '<&'.repeat(100_000) },
        }),
    })),
  });
  const response = await diagnostics(http(), context);
  assert.equal(response.statusCode, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 5_500_000);
  assert.match(model(response).error, /events omitted/);
  assert.ok(model(response).entries.length < 10);
});

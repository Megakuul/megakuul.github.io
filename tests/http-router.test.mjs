import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import {
  createRouter,
  reply,
  rawReply,
} from '../src/routes/worldskills/gadgets/snippets/http-router.mjs';
import { handler as exampleHandler } from '../src/routes/worldskills/gadgets/snippets/router-index.mjs';
const root = new URL('../src/routes/worldskills/gadgets/snippets/', import.meta.url);
const pythonSource = readFileSync(new URL('http_router.py', root), 'utf8');
const defaultRoutes = () => [
  ['GET', '/health', request => reply(200, { ok: true, via: request.source })],
  ['GET', '/users/me', () => reply(200, { id: 'me' })],
  ['GET', '/users/{id}', request => reply(200, { id: request.params.id, query: request.query })],
  ['POST', '/users', request => reply(201, { created: request.json() })],
  ['GET', '/files/{path+}', request => reply(200, { path: request.params.path })],
];
const defaultMiddleware = () => [
  async (req, next) => {
    const response = await next();
    response.headers['x-request-id'] = req.requestId;
    return response;
  },
];
const pythonDefaults = `
routes = [
    ("GET", "/health", lambda req: reply(200, {"ok": True, "via": req["source"]})),
    ("GET", "/users/me", lambda req: reply(200, {"id": "me"})),
    ("GET", "/users/{id}", lambda req: reply(200, {"id": req["params"]["id"], "query": req["query"]})),
    ("POST", "/users", lambda req: reply(201, {"created": req["json"]()})),
    ("GET", "/files/{path+}", lambda req: reply(200, {"path": req["params"]["path"]})),
]
def request_id(req, next_handler):
    result = next_handler()
    result["headers"]["x-request-id"] = req["requestId"]
    return result
middleware = [request_id]
`;
const formats = ['function-url', 'http-v2', 'rest-proxy', 'http-v1', 'alb', 'alb-multi'];
const adapter = format =>
  format.includes('alb') ? 'alb' : ['function-url', 'http-v2'].includes(format) ? 'v2' : 'v1';

// Representative AWS event shapes, including null/absent pathParameters and proxy routes.
function eventFor(format, path, method = 'GET') {
  if (adapter(format) === 'v2')
    return {
      version: '2.0',
      routeKey: format === 'function-url' ? '$default' : 'ANY /{proxy+}',
      rawPath: path,
      rawQueryString: '',
      pathParameters: null,
      cookies: [],
      headers: {},
      requestContext: { requestId: 'gateway-id', stage: '$default', http: { method, path } },
      body: null,
      isBase64Encoded: false,
    };
  if (adapter(format) === 'v1')
    return {
      ...(format === 'http-v1' ? { version: '1.0', routeKey: 'ANY /{proxy+}' } : {}),
      httpMethod: method,
      path,
      resource: '/{proxy+}',
      pathParameters: { proxy: path.slice(1) },
      requestContext: { requestId: 'gateway-id', stage: 'prod' },
      headers: null,
      multiValueHeaders: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      body: null,
      isBase64Encoded: false,
    };
  return {
    httpMethod: method,
    path,
    requestContext: {
      elb: {
        targetGroupArn:
          'arn:aws:elasticloadbalancing:eu-central-1:123456789012:targetgroup/router/123',
      },
    },
    ...(format === 'alb-multi'
      ? { multiValueHeaders: {}, multiValueQueryStringParameters: {} }
      : { headers: {}, queryStringParameters: {} }),
    body: '',
    isBase64Encoded: false,
  };
}

const cases = [];
function add(format, name, path, expected, extra = {}) {
  const { method, event, ...rest } = extra;
  cases.push({
    name: format + ': ' + name,
    format,
    adapter: adapter(format),
    event: { ...eventFor(format, path, method), ...event },
    expected,
    ...rest,
  });
}

for (const format of formats) {
  add(
    format,
    'raw text is sent verbatim, including Unicode and newlines',
    '/raw',
    {
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: 'Hello "Jörg"\n☕',
    },
    { setup: 'rawText' },
  );
  add(
    format,
    'raw HTML honors a case-insensitive content type override',
    '/raw',
    {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Hello</h1>',
    },
    { setup: 'rawHtml' },
  );
  add(
    format,
    'pre-serialized JSON is not encoded twice',
    '/raw',
    {
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true}',
    },
    { setup: 'rawJson' },
  );
  add(
    format,
    'JSON reply still JSON-encodes strings',
    '/raw',
    {
      status: 200,
      data: 'Hello world',
      body: '"Hello world"',
    },
    { setup: 'jsonText' },
  );
  add(
    format,
    'empty raw text remains empty',
    '/raw',
    {
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '',
    },
    { setup: 'rawEmpty' },
  );
  add(
    format,
    'raw binary preserves bytes and cookies',
    '/raw',
    {
      status: 200,
      contentType: 'application/octet-stream',
      body: 'AP8B',
      binary: true,
      cookies: ['a=1'],
    },
    { setup: 'rawBinary' },
  );
  add(
    format,
    'raw byte-array view preserves its exact slice',
    '/raw',
    {
      status: 200,
      contentType: 'image/png',
      body: 'AP8B',
      binary: true,
    },
    { setup: 'rawView' },
  );
  add(
    format,
    'HEAD suppresses raw text',
    '/raw',
    {
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '',
    },
    { setup: 'rawText', method: 'HEAD' },
  );
  add(
    format,
    '204 suppresses a raw body',
    '/raw',
    {
      status: 204,
      contentType: 'text/plain; charset=utf-8',
      body: '',
    },
    { setup: 'rawNoContent' },
  );
  add(
    format,
    'invalid raw objects return a logged 500',
    '/raw',
    { status: 500 },
    { setup: 'rawInvalid' },
  );
  add(format, 'extracts a route parameter without AWS pathParameters', '/users/42', {
    status: 200,
    data: { id: '42', query: {} },
  });
  add(format, 'health route', '/health', {
    status: 200,
    data: {
      ok: true,
      via: adapter(format) === 'v2' ? 'http-v2' : adapter(format) === 'v1' ? 'apigw-v1' : 'alb',
    },
  });
  add(format, 'literal route precedes the parameter route', '/users/me', {
    status: 200,
    data: { id: 'me' },
  });
  add(format, 'greedy parameter consumes the remaining path', '/files/a/b.json', {
    status: 200,
    data: { path: 'a/b.json' },
  });
  add(format, 'greedy parameter requires a nonempty path', '/files/', { status: 404 });
  add(format, 'single parameter does not consume slashes', '/users/a/b', { status: 404 });
  add(format, 'does not collapse empty path segments', '/users//42', { status: 404 });
  add(format, 'trailing slash', '/users/42/', { status: 200, data: { id: '42', query: {} } });
  add(format, 'unknown path', '/unknown', { status: 404 });
  add(
    format,
    'method mismatch returns Allow',
    '/users/42',
    { status: 405, allow: 'GET, HEAD' },
    { method: 'DELETE' },
  );
  add(
    format,
    'HEAD falls back to GET without a response body',
    '/users/42',
    { status: 200, empty: true },
    { method: 'HEAD' },
  );
  add(
    format,
    'HEAD errors also have no response body',
    '/unknown',
    { status: 404, empty: true },
    { method: 'HEAD' },
  );
  add(
    format,
    'OPTIONS is explicit, not an implicit CORS policy',
    '/health',
    { status: 405, allow: 'GET, HEAD' },
    { method: 'OPTIONS' },
  );
  add(
    format,
    'parses base64 Unicode JSON',
    '/users',
    { status: 201, data: { created: { name: 'Jörg ☕' } } },
    {
      method: 'POST',
      event: {
        body: Buffer.from(JSON.stringify({ name: 'Jörg ☕' })).toString('base64'),
        isBase64Encoded: true,
      },
    },
  );
  add(
    format,
    'parses plain JSON',
    '/users',
    { status: 201, data: { created: { name: 'Ada' } } },
    {
      method: 'POST',
      event: { body: '{"name":"Ada"}' },
    },
  );
  for (const body of ['', '{broken', 'NaN'])
    add(
      format,
      'rejects invalid JSON ' + JSON.stringify(body),
      '/users',
      { status: 400 },
      { method: 'POST', event: { body } },
    );
  add(
    format,
    'rejects malformed base64',
    '/users',
    { status: 400 },
    { method: 'POST', event: { body: '@@@', isBase64Encoded: true } },
  );
  add(
    format,
    'rejects non-UTF8 JSON',
    '/users',
    { status: 400 },
    { method: 'POST', event: { body: '/w==', isBase64Encoded: true } },
  );
  add(format, 'literal plus in a path stays plus', '/users/a+b', {
    status: 200,
    data: { id: 'a+b', query: {} },
  });
  add(format, 'does not infer a stage prefix', '/prod/users/42', { status: 404 });
  add(
    format,
    'explicit prefix removal',
    '/api/users/42',
    { status: 200, data: { id: '42', query: {} } },
    { prefix: '/api' },
  );
  add(
    format,
    'prefix must end on a path boundary',
    '/apix/users/42',
    { status: 404 },
    { prefix: '/api' },
  );
  add(
    format,
    'ignores unrelated AWS route parameter names',
    '/users/42',
    { status: 200, data: { id: '42', query: {} } },
    {
      event: {
        routeKey: 'GET /users/{other}',
        resource: '/users/{other}',
        pathParameters: { other: '42', id: 'wrong' },
      },
    },
  );
  add(
    format,
    'middleware sees extracted params and can short circuit',
    '/users/42',
    { status: 403, data: { blocked: '42' } },
    { setup: 'middleware' },
  );
  add(
    format,
    'binary input is retained as bytes',
    '/bytes',
    { status: 200, data: { bytes: [0, 255, 1] } },
    {
      method: 'POST',
      event: { body: 'AP8B', isBase64Encoded: true },
      setup: 'bytes',
    },
  );
  add(
    format,
    'handler exception becomes a logged 500',
    '/fail',
    { status: 500 },
    { setup: 'error' },
  );
  add(
    format,
    'JSON serialization failure becomes a logged 500',
    '/serialize',
    { status: 500 },
    { setup: 'serialize' },
  );
  add(
    format,
    'one response cookie',
    '/cookies',
    { status: 200, cookies: ['session=one; HttpOnly'] },
    { setup: 'cookie' },
  );
  add(
    format,
    'two response cookies',
    '/cookies',
    {
      status: format === 'alb' ? 500 : 200,
      ...(format === 'alb' ? {} : { cookies: ['session=one; HttpOnly', 'theme=dark'] }),
    },
    { setup: 'cookies' },
  );
  add(format, 'empty success response', '/empty', { status: 204, empty: true }, { setup: 'empty' });
  add(
    format,
    'multiple named parameters',
    '/teams/7/users/42',
    { status: 200, data: { team: '7', id: '42' } },
    { setup: 'nested' },
  );
  add(format, 'root route', '/', { status: 200, data: { root: true } }, { setup: 'root' });
  add(
    format,
    'explicit HEAD overrides GET fallback',
    '/users/42',
    { status: 202, empty: true },
    { method: 'HEAD', setup: 'head' },
  );

  if (adapter(format) !== 'v1') {
    add(format, 'decodes percent-encoded Unicode once', '/users/J%C3%B6rg', {
      status: 200,
      data: { id: 'Jörg', query: {} },
    });
    add(format, 'encoded slash stays inside a single parameter', '/users/a%2Fb', {
      status: 200,
      data: { id: 'a/b', query: {} },
    });
    add(format, 'does not double-decode', '/users/%252F', {
      status: 200,
      data: { id: '%2F', query: {} },
    });
    for (const path of ['/users/%ZZ', '/users/%FF'])
      add(format, 'rejects malformed path ' + path, path, { status: 400 });
  } else {
    add(format, 'preserves already-decoded Unicode and percent escapes', '/users/Jörg%2F', {
      status: 200,
      data: { id: 'Jörg%2F', query: {} },
    });
    add(
      format,
      'multivalue query overrides single-value copy without decoding again',
      '/users/42',
      { status: 200, data: { id: '42', query: { tag: ['a,b', 'c'], q: ['a+b%20'], empty: [''] } } },
      {
        event: {
          queryStringParameters: { tag: 'c', q: 'a+b%20', empty: '' },
          multiValueQueryStringParameters: { tag: ['a,b', 'c'] },
        },
      },
    );
  }
  if (adapter(format) === 'v2')
    add(
      format,
      'raw query preserves repeats, commas, blanks, and encoded keys',
      '/users/42',
      {
        status: 200,
        data: {
          id: '42',
          query: {
            tag: ['a,b', 'c'],
            q: ['a+b c'],
            empty: [''],
            'na me': ['x'],
            ['__proto__']: ['safe'],
          },
        },
      },
      {
        event: {
          rawQueryString: 'tag=a%2Cb&tag=c&q=a%2Bb+c&empty=&na+me=x&__proto__=safe',
          queryStringParameters: { tag: 'a,b,c' },
        },
      },
    );
  if (adapter(format) === 'alb')
    add(
      format,
      'decodes ALB query keys and values once',
      '/users/42',
      {
        status: 200,
        data: { id: '42', query: { 'na me': ['a+b c'], literal: ['%2F'], empty: [''] } },
      },
      {
        event:
          format === 'alb'
            ? { queryStringParameters: { 'na+me': 'a%2Bb+c', literal: '%252F', empty: '' } }
            : {
                multiValueQueryStringParameters: {
                  'na+me': ['a%2Bb+c'],
                  literal: ['%252F'],
                  empty: [''],
                },
              },
      },
    );
}

const jsSetups = {
  rawText: 'routes.push(["GET", "/raw", () => rawReply(200, \'Hello "Jörg"\\n☕\')]);',
  rawHtml:
    'routes.push(["GET", "/raw", () => rawReply(200, "<h1>Hello</h1>", {"Content-Type": "text/html; charset=utf-8"})]);',
  rawJson:
    'routes.push(["GET", "/raw", () => rawReply(200, \'{"ok":true}\', {"content-type": "application/json"})]);',
  jsonText: 'routes.push(["GET", "/raw", () => reply(200, "Hello world")]);',
  rawEmpty: 'routes.push(["GET", "/raw", () => rawReply(200)]);',
  rawBinary:
    'routes.push(["GET", "/raw", () => rawReply(200, Buffer.from([0,255,1]), {}, ["a=1"])]);',
  rawView:
    'routes.push(["GET", "/raw", () => rawReply(200, new Uint8Array([42,0,255,1,42]).subarray(1,4), {"content-type": "image/png"})]);',
  rawNoContent: 'routes.push(["GET", "/raw", () => rawReply(204, "ignored")]);',
  rawInvalid: 'routes.push(["GET", "/raw", () => rawReply(200, {invalid:true})]);',
  middleware: 'middleware.unshift(async (req, next) => reply(403, { blocked: req.params.id }));',
  bytes: "routes.push(['POST', '/bytes', req => reply(200, { bytes: [...req.body] })]);",
  error: "routes.push(['GET', '/fail', () => { throw new Error('deliberate failure'); }]);",
  serialize:
    "routes.push(['GET', '/serialize', () => { const data = {}; data.self = data; return reply(200, data); }]);",
  cookie: "routes.push(['GET', '/cookies', () => reply(200, {}, {}, ['session=one; HttpOnly'])]);",
  cookies:
    "routes.push(['GET', '/cookies', () => reply(200, {}, {}, ['session=one; HttpOnly', 'theme=dark'])]);",
  empty: "routes.push(['GET', '/empty', () => reply(204, null)]);",
  nested: "routes.push(['GET', '/teams/{team}/users/{id}', req => reply(200, req.params)]);",
  root: "routes.push(['GET', '/', () => reply(200, { root: true })]);",
  head: "routes.push(['HEAD', '/users/{id}', () => reply(202, {})]);",
};
const pySetups = {
  rawText: 'routes.append(("GET", "/raw", lambda req: raw_reply(200, \'Hello "Jörg"\\n☕\')))',
  rawHtml:
    'routes.append(("GET", "/raw", lambda req: raw_reply(200, "<h1>Hello</h1>", {"Content-Type": "text/html; charset=utf-8"})))',
  rawJson:
    'routes.append(("GET", "/raw", lambda req: raw_reply(200, \'{"ok":true}\', {"content-type": "application/json"})))',
  jsonText: 'routes.append(("GET", "/raw", lambda req: reply(200, "Hello world")))',
  rawEmpty: 'routes.append(("GET", "/raw", lambda req: raw_reply(200)))',
  rawBinary:
    'routes.append(("GET", "/raw", lambda req: raw_reply(200, bytes([0,255,1]), cookies=["a=1"])))',
  rawView:
    'routes.append(("GET", "/raw", lambda req: raw_reply(200, bytearray([42,0,255,1,42])[1:4], {"content-type": "image/png"})))',
  rawNoContent: 'routes.append(("GET", "/raw", lambda req: raw_reply(204, "ignored")))',
  rawInvalid: 'routes.append(("GET", "/raw", lambda req: raw_reply(200, {"invalid": True})))',
  middleware:
    'middleware.insert(0, lambda req, next_handler: reply(403, {"blocked": req["params"]["id"]}))',
  bytes: 'routes.append(("POST", "/bytes", lambda req: reply(200, {"bytes": list(req["body"])})))',
  error:
    'def fail(req):\n    raise RuntimeError("deliberate failure")\nroutes.append(("GET", "/fail", fail))',
  serialize:
    'def circular(req):\n    data = {}\n    data["self"] = data\n    return reply(200, data)\nroutes.append(("GET", "/serialize", circular))',
  cookie:
    'routes.append(("GET", "/cookies", lambda req: reply(200, {}, cookies=["session=one; HttpOnly"])))',
  cookies:
    'routes.append(("GET", "/cookies", lambda req: reply(200, {}, cookies=["session=one; HttpOnly", "theme=dark"])))',
  empty: 'routes.append(("GET", "/empty", lambda req: reply(204, None)))',
  nested:
    'routes.append(("GET", "/teams/{team}/users/{id}", lambda req: reply(200, req["params"])))',
  root: 'routes.append(("GET", "/", lambda req: reply(200, {"root": True})))',
  head: 'routes.append(("HEAD", "/users/{id}", lambda req: reply(202, {})))',
};

const python = spawnSync(
  'python3',
  [
    '-c',
    `
import contextlib, io, json, sys, types
payload = json.load(sys.stdin)
results = []
for case in payload["cases"]:
    scope = {}
    exec(compile(payload["source"], "http_router.py", "exec"), scope)
    exec(payload["defaults"], scope)
    exec(payload["setups"].get(case.get("setup"), ""), scope)
    handler = scope["create_router"](scope["routes"], middleware=scope["middleware"], base_path=case.get("prefix", ""))
    logs = io.StringIO()
    with contextlib.redirect_stdout(logs), contextlib.redirect_stderr(logs):
        result = handler(case["event"], types.SimpleNamespace(aws_request_id="lambda-id"))
    results.append({"response": result, "logged": bool(logs.getvalue())})
json.dump(results, sys.stdout)
`,
  ],
  {
    input: JSON.stringify({
      cases,
      source: pythonSource,
      defaults: pythonDefaults,
      setups: pySetups,
    }),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  },
);
assert.equal(python.status, 0, python.stderr);
const pyResults = JSON.parse(python.stdout);

test('small handler example imports the gadget and extracts parameters in every format', async () => {
  const events = formats.map(format => eventFor(format, '/users/42/blub/ananas/99'));
  for (const event of events) {
    const response = await exampleHandler(event);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { id: '42', another_id: '99' });
  }
  const result = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      `
import json, sys
from router_index import handler
for event in json.load(sys.stdin):
    response = handler(event, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"id": "42", "another_id": "99"}
`,
    ],
    { cwd: root, input: JSON.stringify(events), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('non-HTTP events fall through and router instances have independent configuration', async () => {
  const route = createRouter([['GET', '/health', () => reply(200, {})]]);
  const prefixed = createRouter([['GET', '/health', () => reply(201, {})]], { basePath: '/api' });
  for (const event of [null, {}, { Records: [] }, { requestContext: { routeKey: '$connect' } }])
    assert.equal(await route(event), null);
  assert.equal((await route(eventFor('function-url', '/health'))).statusCode, 200);
  assert.equal((await prefixed(eventFor('function-url', '/health'))).statusCode, 404);
  assert.equal((await prefixed(eventFor('function-url', '/api/health'))).statusCode, 201);
  assert.equal((await route(eventFor('function-url', '/api/health'))).statusCode, 404);
  const result = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      `
from http_router import create_router, reply
route = create_router([("GET", "/health", lambda req: reply(200, {}))])
prefixed = create_router([("GET", "/health", lambda req: reply(201, {}))], base_path="/api")
for event in [None, {}, {"Records": []}, {"requestContext": {"routeKey": "$connect"}}]:
    assert route(event, None) is None
event = {"httpMethod": "GET", "path": "/health"}
assert route(event, None)["statusCode"] == 200
assert prefixed(event, None)["statusCode"] == 404
event["path"] = "/api/health"
assert prefixed(event, None)["statusCode"] == 201
assert route(event, None)["statusCode"] == 404
`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('fallback receives original events once and returns final responses unchanged', async () => {
  for (const format of formats) {
    const context = { awsRequestId: 'fallback-context' };
    let calls = [];
    let expected;
    const route = createRouter([['GET', '/hello', () => rawReply(200, 'handled')]], {
      fallback: async (event, receivedContext) => {
        calls.push(event);
        assert.equal(receivedContext, context);
        await Promise.resolve();
        return expected;
      },
    });
    for (const event of [
      { Records: [] },
      eventFor(format, '/missing'),
      eventFor(format, '/hello', 'POST'),
    ]) {
      // These must not be wrapped in JSON or converted to a proxy response.
      for (const output of [
        null,
        undefined,
        false,
        { batchItemFailures: [] },
        { statusCode: 202, body: 'already encoded' },
      ]) {
        expected = output;
        const before = calls.length;
        assert.equal(await route(event, context), output);
        assert.equal(calls.length, before + 1);
        assert.equal(calls.at(-1), event);
      }
    }
    const before = calls.length;
    assert.equal((await route(eventFor(format, '/hello'), context)).body, 'handled');
    assert.equal(calls.length, before, 'matched routes must not call fallback');
    const malformedBody = { ...eventFor(format, '/missing'), body: '@@@', isBase64Encoded: true };
    expected = 'delegated without parsing the body';
    assert.equal(await route(malformedBody, context), expected);
    const chained = createRouter([], { fallback: route });
    assert.equal((await chained(eventFor(format, '/hello'), context)).body, 'handled');
  }
});

test('fallback errors propagate, while matched HTTP failures do not fall through', async () => {
  const error = new Error('application failure');
  for (const fallback of [
    () => {
      throw error;
    },
    async () => {
      throw error;
    },
  ]) {
    const route = createRouter([], { fallback });
    await assert.rejects(route({ Records: [] }), error);
    await assert.rejects(route(eventFor('function-url', '/missing')), error);
  }
  let calls = 0;
  const route = createRouter([['POST', '/users', req => reply(200, req.json())]], {
    fallback: () => {
      calls++;
      return null;
    },
  });
  assert.equal(
    (await route({ ...eventFor('function-url', '/users', 'POST'), body: '{broken' })).statusCode,
    400,
  );
  assert.equal(calls, 0);
});

test('Python fallback preserves events, responses, exceptions, and matched routes', () => {
  const result = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      `
from http_router import create_router, raw_reply, reply
context = object()
calls = []
expected = None
def fallback(event, ctx):
    assert ctx is context
    calls.append(event)
    return expected
route = create_router([("GET", "/hello", lambda req: raw_reply(200, "handled"))], fallback=fallback)
events = [{"Records": []}, {"httpMethod": "GET", "path": "/missing"}, {"httpMethod": "POST", "path": "/hello"}]
for event in events:
    for output in [None, False, {"batchItemFailures": []}, {"statusCode": 202, "body": "already encoded"}]:
        expected = output
        before = len(calls)
        assert route(event, context) is output
        assert len(calls) == before + 1 and calls[-1] is event
before = len(calls)
assert route({"httpMethod": "GET", "path": "/hello"}, context)["body"] == "handled"
assert len(calls) == before
assert route({"httpMethod": "GET", "path": "/missing", "body": "@@@", "isBase64Encoded": True}, context) is expected
chained = create_router([], fallback=route)
assert chained({"httpMethod": "GET", "path": "/hello"}, context)["body"] == "handled"
error = RuntimeError("application failure")
def fail(event, ctx):
    raise error
for event in events:
    try:
        create_router([], fallback=fail)(event, context)
    except RuntimeError as caught:
        assert caught is error
    else:
        raise AssertionError("Fallback exception swallowed")
route = create_router([("POST", "/users", lambda req: reply(200, req["json"]()))], fallback=fallback)
before = len(calls)
assert route({"httpMethod": "POST", "path": "/users", "body": "{broken"}, context)["statusCode"] == 400
assert len(calls) == before
`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

function verify(response, scenario) {
  assert.equal(response.statusCode, scenario.expected.status);
  assert.equal(typeof response.body, 'string');
  assert.equal(response.isBase64Encoded, scenario.expected.binary ?? false);
  const multi = scenario.format === 'alb-multi';
  const headers = multi
    ? Object.fromEntries(
        Object.entries(response.multiValueHeaders).map(([key, values]) => [key, values[0]]),
      )
    : response.headers;
  assert.equal(headers['content-type'], scenario.expected.contentType ?? 'application/json');
  assert.equal(Object.keys(headers).filter(key => key.toLowerCase() === 'content-type').length, 1);
  if (Object.hasOwn(scenario.expected, 'body')) assert.equal(response.body, scenario.expected.body);
  if (scenario.adapter === 'alb') {
    assert.equal(response.statusDescription.startsWith(response.statusCode + ' '), true);
    assert.equal(Object.hasOwn(response, 'headers'), !multi);
    assert.equal(Object.hasOwn(response, 'multiValueHeaders'), multi);
    if (response.statusCode === 404) assert.equal(response.statusDescription, '404 Not Found');
  }
  if (scenario.expected.empty) assert.equal(response.body, '');
  else if (scenario.expected.data)
    assert.deepEqual(JSON.parse(response.body), scenario.expected.data);
  if (scenario.expected.allow) assert.equal(headers.allow, scenario.expected.allow);
  if (scenario.expected.cookies) {
    const cookies =
      scenario.adapter === 'v2'
        ? response.cookies
        : scenario.format === 'alb'
          ? [headers['set-cookie']]
          : response.multiValueHeaders['set-cookie'];
    assert.deepEqual(cookies, scenario.expected.cookies);
  }
  if (response.statusCode >= 200 && response.statusCode < 300)
    assert.equal(headers['x-request-id'], 'lambda-id');
}

test('router gadgets detect AWS formats and agree in JavaScript and Python', async t => {
  for (const [index, scenario] of cases.entries())
    await t.test(scenario.name, async () => {
      const routes = defaultRoutes();
      const middleware = defaultMiddleware();
      new Function('routes', 'middleware', 'reply', 'rawReply', jsSetups[scenario.setup] ?? '')(
        routes,
        middleware,
        reply,
        rawReply,
      );
      const handler = createRouter(routes, { middleware, basePath: scenario.prefix ?? '' });
      const original = console.error;
      let logged = false;
      let response;
      try {
        console.error = () => {
          logged = true;
        };
        response = await handler(scenario.event, { awsRequestId: 'lambda-id' });
      } finally {
        console.error = original;
      }
      verify(response, scenario);
      verify(pyResults[index].response, scenario);
      if (scenario.expected.status === 500) {
        assert.equal(logged, true);
        assert.equal(pyResults[index].logged, true);
      }
    });
});

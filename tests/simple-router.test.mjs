import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { handler } from '../src/routes/worldskills/gadgets/snippets/simple-router.mjs';

const pythonPath = new URL(
  '../src/routes/worldskills/gadgets/snippets/simple_router.py',
  import.meta.url,
).pathname;
const cases = [];
for (const format of [
  'function-url',
  'http-api-v2',
  'rest-api',
  'http-api-v1',
  'alb',
  'alb-multi',
]) {
  const v2 = ['function-url', 'http-api-v2'].includes(format);
  const alb = format.startsWith('alb');
  const event = (path, method = 'GET', extra = {}) => ({
    ...(v2
      ? {
          version: '2.0',
          rawPath: path,
          rawQueryString: '',
          requestContext: { http: { method, path } },
        }
      : {
          path,
          httpMethod: method,
          requestContext: alb ? { elb: { targetGroupArn: 'target' } } : { stage: 'prod' },
        }),
    ...(format === 'alb-multi' ? { multiValueHeaders: {} } : { headers: {} }),
    ...extra,
  });
  const add = (name, input, status, body) =>
    cases.push({ name: `${format}: ${name}`, input, status, body });
  add('root is plain text', event('/'), 200, 'Hello world');
  add('health is JSON', event('/health'), 200, { ok: true });
  add('parameter', event('/users/42'), 200, { id: '42' });
  add('decoded parameter', event('/users/' + (v2 || alb ? 'a%20b' : 'a b')), 200, { id: 'a b' });
  add('trailing slash', event('/users/42/'), 200, { id: '42' });
  add('JSON body', event('/echo', 'POST', { body: '{"ok":true}' }), 200, { ok: true });
  add(
    'base64 body',
    event('/echo', 'POST', {
      body: Buffer.from('{"ok":true}').toString('base64'),
      isBase64Encoded: true,
    }),
    200,
    { ok: true },
  );
  add('invalid JSON', event('/echo', 'POST', { body: '{bad' }), 400, 'Bad request');
  add('missing route', event('/missing'), 404, 'Not found');
  add('wrong method', event('/health', 'POST'), 405, 'Method not allowed');
  add('HEAD', event('/health', 'HEAD'), 200, '');
  add(
    'query',
    event(
      '/search',
      'GET',
      v2
        ? { rawQueryString: 'q=hello+world' }
        : format === 'alb-multi'
          ? { multiValueQueryStringParameters: { q: ['hello+world'] } }
          : { queryStringParameters: { q: alb ? 'hello+world' : 'hello world' } },
    ),
    200,
    { q: 'hello world' },
  );
}
cases.push({
  name: 'console event reports missing HTTP fields',
  input: {},
  status: 400,
  body: 'Expected an HTTP event with method and path',
});
const result = spawnSync(
  'python3',
  [
    '-B',
    '-c',
    `
import json,runpy,sys
handler=runpy.run_path(sys.argv[1])['handler']
print(json.dumps([handler(case['input'], None) for case in json.load(sys.stdin)]))
`,
    pythonPath,
  ],
  { input: JSON.stringify(cases), encoding: 'utf8' },
);
assert.equal(result.status, 0, result.stderr);
const pythonResponses = JSON.parse(result.stdout);
for (const [i, scenario] of cases.entries()) {
  test(scenario.name, async () => {
    for (const response of [await handler(scenario.input, {}), pythonResponses[i]]) {
      assert.equal(response.statusCode, scenario.status);
      assert.deepEqual(
        typeof scenario.body === 'string' ? response.body : JSON.parse(response.body),
        scenario.body,
      );
      const multi = scenario.input.requestContext?.elb && scenario.input.multiValueHeaders;
      assert.ok(
        multi ? response.multiValueHeaders['content-type'] : response.headers['content-type'],
      );
      if (multi) assert.equal(response.headers, undefined);
    }
  });
}

test('both source files stand alone', () => {
  assert.doesNotMatch(
    readFileSync(
      new URL('../src/routes/worldskills/gadgets/snippets/simple-router.mjs', import.meta.url),
      'utf8',
    ),
    /import .*from/,
  );
  assert.doesNotMatch(readFileSync(pythonPath, 'utf8'), /from http_router/);
});

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';

const root = new URL('../', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'database-zip-test-'));
after(() => rmSync(work, { recursive: true, force: true }));

test('function/layer ZIP contents, checksums and published snippets match', () => {
  execFileSync('python3', [
    '-c',
    `
import hashlib,json,pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
downloads=root/'static/downloads'
checksums=dict(line.split()[::-1] for line in (downloads/'nodejs-databases.sha256').read_text().splitlines())
manifest=json.loads((downloads/'nodejs-databases.manifest.json').read_text())
for kind in ('function','layer'):
    file=downloads/('nodejs-databases-'+kind+'.zip')
    assert hashlib.sha256(file.read_bytes()).hexdigest()==checksums[file.name]
    assert file.stat().st_size<50*1024*1024
    prefix='nodejs/' if kind=='layer' else ''
    with zipfile.ZipFile(file) as z:
        assert z.testzip() is None
        assert sum(info.file_size for info in z.infolist())<250*1024*1024
        assert not any(n.endswith(('.node','.dll','.so','.dylib')) for n in z.namelist())
        assert not any('/@clickhouse/' in n or '/sql.js/' in n for n in z.namelist())
        for removed in ('clickhouse.mjs','trino.mjs','trino-iceberg.sql','sqlite.mjs'):
            assert prefix+'examples/'+removed not in z.namelist()
        assert json.loads(z.read(prefix+'manifest.json'))==manifest
        assert z.read(prefix+'package-lock.json')==(root/'tools/lambda-databases/package-lock.json').read_bytes()
        assert z.read(prefix+'index.mjs')==(root/'tools/lambda-databases/index.mjs').read_bytes()
        for sample in (root/'src/routes/worldskills/lambda/database-examples').iterdir():
            assert z.read(prefix+'examples/'+sample.name)==sample.read_bytes(), sample.name
        assert b'BEGIN CERTIFICATE' in z.read('certs/rds.pem')
        assert b'BEGIN CERTIFICATE' in z.read('certs/keyspaces.pem')
        for package,version in manifest['dependencies'].items():
            assert json.loads(z.read(prefix+'node_modules/'+package+'/package.json'))['version']==version
        if kind=='function': z.extractall(target)
`,
    root,
    work,
  ]);
});

test('extracted upload imports every bundled driver without installation', async () => {
  const { handler } = await import(pathToFileURL(join(work, 'index.mjs')).href);
  const result = await handler({});
  assert.deepEqual(
    result.drivers,
    JSON.parse(readFileSync(join(root, 'static/downloads/nodejs-databases.manifest.json')))
      .dependencies,
  );
  await assert.rejects(handler({ database: 'toString' }), /Unknown database/);
});

test('every packaged handler parses as Node.js', () => {
  for (const name of [
    'opensearch',
    'opensearch-serverless',
    'redshift',
    'athena',
    'postgres',
    'mysql',
    'sqlserver',
    'oracle',
    'mongodb',
    'redis',
    'cassandra',
    'memcached',
    'dsql',
  ]) {
    execFileSync(process.execPath, ['--check', join(work, 'examples', name + '.mjs')]);
  }
});

test('Redshift batch parameters, polling, result paging and NULL decoding', async t => {
  const sdk = await import(
    pathToFileURL(join(work, 'node_modules/@aws-sdk/client-redshift-data/dist-cjs/index.js')).href
  );
  let polls = 0;
  const tokens = [];
  t.mock.method(sdk.RedshiftDataClient.prototype, 'send', async command => {
    if (command instanceof sdk.BatchExecuteStatementCommand) {
      assert.deepEqual(command.input.Parameters, [{ name: 'min', value: '2' }]);
      assert.ok(command.input.Sqls.some(sql => sql.startsWith('UPDATE')));
      assert.ok(command.input.Sqls.some(sql => sql.startsWith('DELETE')));
      return { Id: 'batch' };
    }
    if (command instanceof sdk.DescribeStatementCommand)
      return ++polls === 1
        ? { Status: 'STARTED' }
        : {
            Status: 'FINISHED',
            SubStatements: [
              { Id: 'batch:1', HasResultSet: false },
              { Id: 'batch:4', HasResultSet: true },
            ],
          };
    if (command instanceof sdk.GetStatementResultCommand) {
      tokens.push(command.input.NextToken);
      return {
        ColumnMetadata: [{ name: 'category' }, { name: 'revenue' }],
        Records: command.input.NextToken
          ? [[{ stringValue: 'bread' }, { isNull: true }]]
          : [[{ stringValue: 'fruit' }, { doubleValue: 7 }]],
        ...(!command.input.NextToken ? { NextToken: 'page-2' } : {}),
      };
    }
    throw new Error('Unexpected command');
  });
  const { handler } = await import(pathToFileURL(join(work, 'index.mjs')).href);
  const result = await handler({ database: 'redshift', minAmount: 2 });
  assert.deepEqual(result.results[0].rows, [
    { category: 'fruit', revenue: 7 },
    { category: 'bread', revenue: null },
  ]);
  assert.deepEqual(tokens, [undefined, 'page-2']);
});

test('Athena preserves rows after the first page and reports scan cost', async t => {
  const sdk = await import(
    pathToFileURL(join(work, 'node_modules/@aws-sdk/client-athena/dist-cjs/index.js')).href
  );
  t.mock.method(sdk.AthenaClient.prototype, 'send', async command => {
    if (command instanceof sdk.StartQueryExecutionCommand) {
      assert.deepEqual(command.input.ExecutionParameters, ['2']);
      return { QueryExecutionId: 'athena-query' };
    }
    if (command instanceof sdk.GetQueryExecutionCommand)
      return {
        QueryExecution: {
          Status: { State: 'SUCCEEDED' },
          Statistics: { DataScannedInBytes: 123, EngineExecutionTimeInMillis: 10 },
        },
      };
    if (command instanceof sdk.GetQueryResultsCommand)
      return {
        ResultSet: {
          ResultSetMetadata: { ColumnInfo: [{ Name: 'category' }, { Name: 'revenue' }] },
          Rows: command.input.NextToken
            ? [{ Data: [{ VarCharValue: 'bread' }, {}] }]
            : [
                { Data: [{ VarCharValue: 'category' }, { VarCharValue: 'revenue' }] },
                { Data: [{ VarCharValue: 'fruit' }, { VarCharValue: '7' }] },
              ],
        },
        ...(!command.input.NextToken ? { NextToken: 'page-2' } : {}),
      };
    throw new Error('Unexpected command');
  });
  const { handler } = await import(pathToFileURL(join(work, 'index.mjs')).href);
  const result = await handler({ database: 'athena', minAmount: 2 });
  assert.deepEqual(result.rows, [
    { category: 'fruit', revenue: '7' },
    { category: 'bread', revenue: null },
  ]);
  assert.equal(result.bytesScanned, 123);
});

test('Lambda time budget reaches analytics handlers and triggers cancellation', async t => {
  const sdk = await import(
    pathToFileURL(join(work, 'node_modules/@aws-sdk/client-redshift-data/dist-cjs/index.js')).href
  );
  let cancelled = false;
  t.mock.method(sdk.RedshiftDataClient.prototype, 'send', async command => {
    if (command instanceof sdk.BatchExecuteStatementCommand) return { Id: 'slow-query' };
    if (command instanceof sdk.DescribeStatementCommand) return { Status: 'STARTED' };
    if (command instanceof sdk.CancelStatementCommand) {
      cancelled = true;
      return {};
    }
    throw new Error('Unexpected command');
  });
  const { handler } = await import(pathToFileURL(join(work, 'index.mjs')).href);
  await assert.rejects(
    handler({ database: 'redshift' }, { getRemainingTimeInMillis: () => 0 }),
    /timed out/,
  );
  assert.equal(cancelled, true);
});
async function openSearchFixture(t, respond) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = { method: req.method, url: req.url, headers: req.headers, raw };
    requests.push(request);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(respond(request)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = { ...process.env };
  Object.assign(process.env, {
    AWS_REGION: 'eu-central-1',
    AWS_ACCESS_KEY_ID: 'fixture-access-key',
    AWS_SECRET_ACCESS_KEY: 'fixture-secret-key',
    AWS_SESSION_TOKEN: 'fixture-session-token',
    OPENSEARCH_URL: `http://127.0.0.1:${server.address().port}`,
    OPENSEARCH_SERVERLESS_URL: `http://127.0.0.1:${server.address().port}`,
    OPENSEARCH_INDEX: 'sales',
  });
  t.after(async () => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return requests;
}

test('OpenSearch signs CRUD requests and cleans up its own index, including bulk failure', async t => {
  let failBulk = false;
  const requests = await openSearchFixture(t, req => {
    if (req.url.includes('_bulk'))
      return failBulk
        ? { errors: true, items: [{ index: { error: { type: 'mapper_parsing_exception' } } }] }
        : { errors: false, items: [] };
    if (req.url.includes('_search'))
      return {
        hits: { hits: [{ _source: { name: 'Green apple' } }] },
        aggregations: { categories: { buckets: [] } },
      };
    if (req.method === 'GET') return { _source: { name: 'Green apple' } };
    return { acknowledged: true };
  });
  const { handler } = await import(pathToFileURL(join(work, 'examples/opensearch.mjs')).href);
  const result = await handler();
  assert.equal(result.item.name, 'Green apple');
  const index = requests[0].url.slice(1);
  assert.match(index, /^lambda-demo-[a-f0-9-]+$/);
  assert.equal(requests[0].method, 'PUT');
  assert.equal(JSON.parse(requests[0].raw).mappings.properties.category.type, 'keyword');
  assert.deepEqual(requests.at(-1).method, 'DELETE');
  assert.equal(requests.at(-1).url, '/' + index);
  assert.ok(requests.every(req => req.url.startsWith('/' + index)));
  assert.ok(
    requests.every(req => req.headers.authorization.includes('/eu-central-1/es/aws4_request')),
  );
  assert.ok(requests.every(req => req.headers['x-amz-security-token'] === 'fixture-session-token'));
  const bulk = requests.find(req => req.url.includes('_bulk'));
  assert.ok(bulk.url.includes('refresh=wait_for'));
  assert.equal(bulk.raw.trim().split('\n').length, 6);
  assert.ok(requests.some(req => req.url.includes('_update/1')));
  assert.ok(requests.some(req => req.method === 'DELETE' && req.url.includes('_doc/2')));
  assert.equal(requests.filter(req => req.url.includes('_search')).length, 2);
  failBulk = true;
  const start = requests.length;
  await assert.rejects(handler(), /mapper_parsing_exception/);
  assert.equal(requests.at(-1).method, 'DELETE');
  assert.equal(requests.at(-1).url, requests[start].url);
  assert.notEqual(requests[start].url, '/' + index);
});

test('OpenSearch Serverless signs with aoss and searches the selected index without mutations', async t => {
  const requests = await openSearchFixture(t, () => ({
    hits: { hits: [], total: { value: 0, relation: 'eq' } },
    aggregations: { categories: { buckets: [] } },
  }));
  const { handler } = await import(
    pathToFileURL(join(work, 'examples/opensearch-serverless.mjs')).href
  );
  const result = await handler({ search: 'apple | pear' });
  await handler();
  assert.equal(result.total.value, 0);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(req => req.method === 'POST' && req.url === '/sales/_search'));
  assert.ok(
    requests.every(req => req.headers.authorization.includes('/eu-central-1/aoss/aws4_request')),
  );
  const query = JSON.parse(requests[0].raw);
  assert.equal(query.query.simple_query_string.query, 'apple | pear');
  assert.equal(query.aggs.categories.aggs.revenue.sum.field, 'amount');
  assert.deepEqual(JSON.parse(requests[1].raw).query, { match_all: {} });
});

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, renameSync, statSync } from 'node:fs';
import { formatWithOptions } from 'node:util';

// No AWS SDK or execution-role permissions. Two rotating files use at most 512 KiB.
// Import this module before loading your application to capture its console output.
const FILE = '/tmp/lambda-gadget-logs.jsonl';
const FILE_BYTES = 256 * 1024;
const ENTRY_BYTES = 16 * 1024;
const requests = new AsyncLocalStorage();
const environmentId = process.env.AWS_LAMBDA_LOG_STREAM_NAME ?? randomUUID();
let storageError;

function sanitized(value) {
  const seen = new WeakSet();
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (/authorization|cookie|password|passwd|secret|token|x-api-key/i.test(key))
        return '[REDACTED]';
      if (typeof item === 'bigint') return String(item) + 'n';
      if (item instanceof Error)
        return { name: item.name, message: item.message, stack: item.stack };
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    }),
  );
}

function append(level, args) {
  try {
    const message = formatWithOptions(
      { colors: false, depth: 6, maxArrayLength: 100, maxStringLength: ENTRY_BYTES },
      ...args.map(value => (value && typeof value === 'object' ? sanitized(value) : value)),
    );
    const entry = {
      at: new Date().toISOString(),
      level,
      requestId: requests.getStore()?.requestId,
      message,
    };
    let line = JSON.stringify(entry) + '\n';
    if (Buffer.byteLength(line) > ENTRY_BYTES) {
      // Allow room for JSON escaping even when the message is all control characters.
      entry.message = Buffer.from(message).subarray(0, 2400).toString() + '\n[truncated]';
      line = JSON.stringify(entry) + '\n';
    }
    let size = 0;
    try {
      size = statSync(FILE).size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (size + Buffer.byteLength(line) > FILE_BYTES) renameSync(FILE, FILE + '.1');
    appendFileSync(FILE, line, { mode: 0o600 });
    storageError = undefined;
  } catch (error) {
    // Logging must never fail the application's invocation (including a full /tmp).
    storageError = error.message;
  }
}

for (const level of ['debug', 'info', 'log', 'warn', 'error', 'trace']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    append(level, args);
    original(...args);
  };
}

function readEntries() {
  const entries = [];
  for (const file of [FILE + '.1', FILE]) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') storageError = error.message;
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        storageError = 'Skipped an incomplete log entry.';
      }
    }
  }
  return entries.slice(-500).reverse();
}

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
}

function html(body, statusCode = 200, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
    body,
  };
}

function dashboard(maxBytes) {
  let bytes = 0;
  const entries = readEntries().filter(entry => {
    bytes += Buffer.byteLength(
      JSON.stringify(JSON.stringify(entry).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026')),
    );
    return bytes < maxBytes;
  });
  const model = JSON.stringify(entries).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026');
  return html(`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Lambda local logs</title>
<style> :root{color-scheme:dark}body{max-width:1200px;margin:32px auto;padding:0 20px;background:#080b12;color:#eef4ff;font:14px/1.5 system-ui}button,input,select{padding:10px;border:1px solid #344158;border-radius:8px;background:#151c2a;color:inherit}input{flex:1}nav{display:flex;gap:10px;flex-wrap:wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}article{border:1px solid #253047;border-radius:10px;padding:12px;margin:12px 0}small,p{color:#a7b4ca}.error{color:#ffb6c2}</style>
<h1>Lambda local logs</h1><p>Latest 500 entries · two rotating files, up to 512 KiB in /tmp.<br>
Only this execution environment: ${escapeHtml(environmentId)}. Refresh may reach another environment; history disappears when Lambda replaces it.</p>
${storageError ? '<p class="error">Log storage: ' + escapeHtml(storageError) + '</p>' : ''}
<nav><input id="search" placeholder="Search logs or request ID" aria-label="Search logs"><select id="level" aria-label="Log level"><option value="">All levels</option>${['debug', 'info', 'log', 'warn', 'error', 'trace'].map(level => '<option>' + level + '</option>').join('')}</select><button id="refresh">Refresh</button></nav>
<p id="count"></p><div id="entries"></div>
<script id="logs" type="application/json">${model}</script><script>
const entries=JSON.parse(document.getElementById('logs').textContent),$=id=>document.getElementById(id);
function render(){const query=$('search').value.toLowerCase(),level=$('level').value,rows=entries.filter(e=>(!level||e.level===level)&&(!query||JSON.stringify(e).toLowerCase().includes(query)));$('count').textContent=rows.length+' entries';$('entries').replaceChildren();for(const entry of rows){const row=document.createElement('article'),meta=document.createElement('small'),message=document.createElement('pre');meta.textContent=entry.at+' · '+entry.level+' · '+(entry.requestId||'initialization');message.textContent=entry.message;row.append(meta,message);$('entries').append(row)}if(!rows.length)$('entries').textContent='No matching logs in this execution environment.'}
$('search').oninput=render;$('level').onchange=render;$('refresh').onclick=()=>location.reload();render();
</script></html>`);
}

// Wrap the entire handler, including dynamic imports, to capture initialization failures.
// Console strings are stored as written; key-based redaction only applies to object arguments.
// Native/runtime START/END/REPORT logs and process crashes are outside this JS wrapper.
export function withLocalLogs(
  handler,
  {
    path = '/web/logs',
    userEnv = 'DIAGNOSTIC_USER',
    passwordEnv = 'DIAGNOSTIC_PASSWORD',
    defaultUser = 'diagnostic',
  } = {},
) {
  return async (event, context = {}) =>
    requests.run({ requestId: context.awsRequestId ?? randomUUID() }, async () => {
      const method = event?.requestContext?.http?.method ?? event?.httpMethod;
      const requestPath = event?.rawPath ?? event?.path ?? event?.requestContext?.http?.path;
      const isViewer = method && (requestPath === path || requestPath === path + '/');
      const isDashboard = method && (requestPath === '/web' || requestPath === '/web/');
      if (isViewer || isDashboard) {
        const password = process.env[passwordEnv];
        const expected =
          'Basic ' +
          Buffer.from((process.env[userEnv] ?? defaultUser) + ':' + password).toString('base64');
        const actual = Object.entries(event.headers ?? {}).find(
          ([key]) => key.toLowerCase() === 'authorization',
        )?.[1];
        if (password && actual !== expected)
          return html('<h1>Authentication required</h1>', 401, {
            'www-authenticate': 'Basic realm="Lambda gadget"',
          });
      }
      if (isViewer) {
        if (method !== 'GET') return html('<h1>Use GET to read logs</h1>', 405, { allow: 'GET' });
        return dashboard(event.requestContext?.elb ? 600_000 : 4_000_000);
      }

      let timer;
      const controller = new AbortController();
      try {
        console.info('Invocation started', { method, path: requestPath });
        const work = Promise.resolve().then(() =>
          handler(event, Object.assign(context, { gadgetAbortSignal: controller.signal })),
        );
        // Leave time to return a readable error before Lambda kills the invocation.
        const remaining = context.getRemainingTimeInMillis?.() ?? 30_000;
        const result =
          isDashboard && method === 'GET'
            ? await Promise.race([
                work,
                new Promise((_, reject) => {
                  timer = setTimeout(
                    () => {
                      const error = new Error(
                        'Dashboard timed out. Check service connectivity and permissions; local logs are at /web/logs.',
                      );
                      error.name = 'DashboardTimeout';
                      controller.abort(error);
                      reject(error);
                    },
                    Math.max(1, Math.min(8000, remaining - 750)),
                  );
                }),
              ])
            : await work;
        // Account for the complete proxy response, including JSON escaping of its body.
        if (
          method &&
          Buffer.byteLength(JSON.stringify(result) ?? '') >
            (event.requestContext?.elb ? 900_000 : 5_500_000)
        )
          throw new Error(
            'Gadget response is too large. Request fewer records or a shorter time window.',
          );
        console.info('Invocation completed', { statusCode: result?.statusCode });
        return result;
      } catch (error) {
        console.error('Invocation failed', error);
        if (!method) throw error; // Preserve asynchronous event retries / batch failure semantics.
        const requestId = requests.getStore().requestId;
        return html(
          '<h1>Lambda gadget error</h1><p>Request: ' +
            escapeHtml(requestId) +
            '</p>' +
            (isDashboard
              ? '<pre>' +
                escapeHtml(error?.stack ?? error) +
                '</pre><p><a href="' +
                escapeHtml(requestPath.replace(/\/$/, '') + '/logs') +
                '">View local logs</a></p>'
              : '<p>See the local log viewer for details.</p>'),
          error?.name === 'DashboardTimeout' ? 504 : 500,
        );
      } finally {
        clearTimeout(timer);
      }
    });
}

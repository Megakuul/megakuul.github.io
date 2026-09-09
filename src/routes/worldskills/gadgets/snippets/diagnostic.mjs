import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { randomUUID } from 'node:crypto';
import { escapeHtml } from './local-logs.mjs';

const logs = new CloudWatchLogsClient({ maxAttempts: 1 });
const MARKER = 'LAMBDA_GADGET_EVENT ';
const CHUNK_BYTES = 120_000;
const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|x-api-key/i;

function stringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, item) => {
    if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
    if (typeof item === 'bigint') return item.toString() + 'n';
    if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
    }
    return item;
  });
}

function emit(record) {
  const json = stringify(record);
  if (Buffer.byteLength(json) <= CHUNK_BYTES) {
    console.log(MARKER + json);
    return;
  }

  const encoded = Buffer.from(json).toString('base64');
  const total = Math.ceil(encoded.length / CHUNK_BYTES);
  for (let index = 0; index < total; index++) {
    console.log(
      MARKER +
        JSON.stringify({
          gadgetChunk: 1,
          id: record.id,
          index,
          total,
          data: encoded.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES),
        }),
    );
  }
}

function httpInfo(event = {}) {
  const context = event.requestContext ?? {};
  if (context.http) {
    const domain = context.domainName ?? '';
    return {
      version: '2.0',
      source: domain.includes('.lambda-url.') ? 'function-url' : 'http-api',
      method: context.http.method,
      path: event.rawPath ?? context.http.path,
      query: event.rawQueryString ?? '',
      headers: event.headers ?? {},
    };
  }
  if (event.httpMethod) {
    return {
      version: '1.0',
      source: context.elb ? 'alb' : 'rest-api',
      method: event.httpMethod,
      path: event.path,
      query: new URLSearchParams(event.queryStringParameters ?? {}).toString(),
      headers: event.headers ?? {},
    };
  }
  return null;
}

function classify(event = {}) {
  const first = event.Records?.[0];
  const source = first?.eventSource ?? first?.EventSource;
  if (source === 'aws:sqs') return 'sqs';
  if (source === 'aws:kinesis') return 'kinesis';
  if (source === 'aws:dynamodb') return 'dynamodb-stream';
  if (source === 'aws:s3') return 's3';
  if (source === 'aws:sns') return 'sns';
  if (source === 'aws:ses') return 'ses';
  if (event.awslogs?.data) return 'cloudwatch-logs';
  if (event.records && Object.keys(event.records).some(key => key.includes('-'))) return 'kafka';
  if (event['detail-type'] && event.source) return 'eventbridge';
  if (event.triggerSource) return 'cognito';
  if (event.requestContext?.routeKey && event.requestContext?.connectionId) return 'websocket';
  const http = httpInfo(event);
  if (http) return http.source;
  if (event.requestContext?.condition && 'requestPayload' in event) return 'lambda-destination';
  return 'direct';
}

function recordCount(event, kind) {
  if (Array.isArray(event?.Records)) return event.Records.length;
  if (kind === 'kafka')
    return Object.values(event.records ?? {}).reduce((n, rows) => n + rows.length, 0);
  return 1;
}

function summary(event, kind) {
  const first = event?.Records?.[0];
  const http = httpInfo(event);
  if (http) return http.method + ' ' + http.path;
  if (kind === 'sqs')
    return (
      recordCount(event, kind) +
      ' messages · ' +
      (first?.eventSourceARN?.split(':').at(-1) ?? 'queue')
    );
  if (kind === 'kinesis')
    return recordCount(event, kind) + ' records · shard ' + (first?.eventID?.split(':')[0] ?? '?');
  if (kind === 'dynamodb-stream')
    return recordCount(event, kind) + ' changes · ' + (first?.eventName ?? 'unknown');
  if (kind === 's3')
    return recordCount(event, kind) + ' objects · ' + (first?.s3?.bucket?.name ?? 'bucket');
  if (kind === 'sns')
    return (
      recordCount(event, kind) +
      ' notifications · ' +
      (first?.Sns?.TopicArn?.split(':').at(-1) ?? 'topic')
    );
  if (kind === 'eventbridge') return event.source + ' · ' + event['detail-type'];
  if (kind === 'cognito') return event.triggerSource + ' · ' + (event.userName ?? 'unknown user');
  if (kind === 'websocket')
    return event.requestContext.routeKey + ' · ' + event.requestContext.connectionId;
  if (kind === 'kafka')
    return recordCount(event, kind) + ' records · ' + Object.keys(event.records ?? {}).join(', ');
  if (kind === 'cloudwatch-logs') return 'compressed subscription payload';
  if (kind === 'lambda-destination') return event.requestContext.condition + ' · async invocation';
  return (
    Object.keys(event ?? {})
      .slice(0, 5)
      .join(', ') || 'empty event'
  );
}

function recognized(event, kind) {
  const first = event?.Records?.[0];
  const http = httpInfo(event);
  const rows = [
    ['Type', kind],
    ['Top-level keys', Object.keys(event ?? {}).join(', ') || '(none)'],
    ['Records', String(recordCount(event, kind))],
  ];
  if (http)
    rows.push(['Method', http.method], ['Path', http.path], ['Query', http.query || '(none)']);
  if (first?.eventSourceARN) rows.push(['Source ARN', first.eventSourceARN]);
  if (first?.awsRegion) rows.push(['Region', first.awsRegion]);
  if (first?.eventName) rows.push(['Event name', first.eventName]);
  if (event.source) rows.push(['Source', event.source]);
  if (event['detail-type']) rows.push(['Detail type', event['detail-type']]);
  if (event.account) rows.push(['Account', event.account]);
  return rows;
}

function dashboardRequest(event) {
  const http = httpInfo(event);
  return http && (http.path === '/web' || http.path === '/web/');
}

function dashboardAuthorized(event) {
  const password = process.env.DIAGNOSTIC_PASSWORD;
  if (!password) return true;
  const username = process.env.DIAGNOSTIC_USER ?? 'diagnostic';
  const expected = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  const actual = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  return actual === expected;
}

function response(body, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
    body,
  };
}

function parseMessage(message) {
  let text = message ?? '';
  try {
    const outer = JSON.parse(text);
    if (typeof outer.message === 'string') text = outer.message;
  } catch {}
  const at = text.indexOf(MARKER);
  if (at < 0) return null;
  const raw = text.slice(at + MARKER.length).trim();
  try {
    return { value: JSON.parse(raw), raw: message };
  } catch {
    return {
      value: null,
      raw: message,
      parseError: 'Diagnostic marker found but JSON was incomplete.',
    };
  }
}

async function queryOwnLogs({ hours, limit, signal }) {
  const logGroupName =
    process.env.DIAGNOSTIC_LOG_GROUP ?? '/aws/lambda/' + process.env.AWS_LAMBDA_FUNCTION_NAME;
  const found = [];
  let nextToken;
  let pages = 0;

  do {
    const page = await logs.send(
      new FilterLogEventsCommand({
        logGroupName,
        startTime: Date.now() - hours * 60 * 60 * 1000,
        filterPattern: '"LAMBDA_GADGET_EVENT"',
        interleaved: true,
        limit: Math.min(10_000, limit * 4),
        nextToken,
      }),
      { abortSignal: signal },
    );
    found.push(...(page.events ?? []));
    nextToken = page.nextToken;
    pages++;
  } while (nextToken && found.length < limit * 4 && pages < 10);

  const complete = [];
  const chunks = new Map();
  for (const item of found) {
    const parsed = parseMessage(item.message);
    if (!parsed) continue;
    if (!parsed.value) {
      complete.push({
        id: item.eventId,
        at: item.timestamp,
        kind: 'raw-log',
        summary: parsed.parseError,
        recognized: [['Type', 'raw-log']],
        event: { rawLog: item.message },
        rawLog: item.message,
      });
      continue;
    }
    if (parsed.value.gadgetChunk === 1) {
      const bucket = chunks.get(parsed.value.id) ?? {
        parts: [],
        total: parsed.value.total,
        raw: [],
      };
      bucket.parts[parsed.value.index] = parsed.value.data;
      bucket.raw.push(item.message);
      chunks.set(parsed.value.id, bucket);
      continue;
    }
    complete.push({ ...parsed.value, rawLog: item.message, cloudwatchEventId: item.eventId });
  }

  for (const [id, chunk] of chunks) {
    if (chunk.parts.filter(Boolean).length !== chunk.total) {
      complete.push({
        id,
        at: Date.now(),
        kind: 'raw-log',
        summary: 'Large diagnostic event is missing one or more log chunks.',
        recognized: [['Chunks found', chunk.parts.filter(Boolean).length + '/' + chunk.total]],
        event: { chunks: chunk.raw },
        rawLog: chunk.raw.join('\n'),
      });
      continue;
    }
    try {
      const value = JSON.parse(Buffer.from(chunk.parts.join(''), 'base64').toString());
      complete.push({ ...value, rawLog: chunk.raw.join('\n') });
    } catch (error) {
      complete.push({
        id,
        at: Date.now(),
        kind: 'raw-log',
        summary: 'Could not reassemble a chunked event: ' + error.message,
        recognized: [['Type', 'raw-log']],
        event: { chunks: chunk.raw },
        rawLog: chunk.raw.join('\n'),
      });
    }
  }

  return complete.sort((a, b) => b.at - a.at).slice(0, limit);
}

function inlineJson(value) {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}

function boundedDashboard(model, maxBytes) {
  let bytes = 0;
  let omitted = 0;
  const entries = [];
  for (const entry of model.entries) {
    // Count both inline-script escaping and Lambda's JSON response-envelope escaping.
    const size = Buffer.byteLength(JSON.stringify(inlineJson(entry)));
    if (bytes + size > maxBytes) {
      omitted++;
      continue;
    }
    entries.push(entry);
    bytes += size;
  }
  return renderDashboard({
    ...model,
    entries,
    error: [
      model.error,
      omitted
        ? omitted +
          ' events omitted to fit the response limit. Narrow the time window or use CloudWatch for large events.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  });
}

function renderDashboard(model) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Lambda Event Diagnostics</title>
  <style>
    :root{color-scheme:dark;--bg:#080b12;--panel:#101521;--line:#253047;--muted:#8a96aa;--text:#eef4ff;--cyan:#66e3ff;--violet:#a991ff;--green:#62e6a7;--red:#ff7188;--amber:#ffc56f}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% -10%,#1d2848 0,transparent 32rem),var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}button,input,select{font:inherit}.shell{max-width:1600px;margin:auto;padding:24px}.top{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;margin-bottom:18px}.eyebrow{color:var(--cyan);font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.top h1{font-size:clamp(25px,4vw,42px);margin:4px 0}.muted{color:var(--muted)}.live{display:flex;align-items:center;gap:8px;border:1px solid #315248;background:#10241f;padding:8px 11px;border-radius:999px;color:var(--green)}.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 16px var(--green)}.controls,.stats,.layout,.detail-grid{display:grid;gap:12px}.controls{grid-template-columns:minmax(220px,1fr) 190px auto auto;background:#0d121dcf;border:1px solid var(--line);padding:12px;border-radius:16px;backdrop-filter:blur(12px)}input,select,.btn{border:1px solid var(--line);background:#151c2a;color:var(--text);padding:10px 12px;border-radius:10px;outline:none}.btn{cursor:pointer;text-decoration:none}.btn:hover{border-color:#52617a}.stats{grid-template-columns:repeat(4,1fr);margin:12px 0}.stat,.panel{border:1px solid var(--line);background:linear-gradient(145deg,#121826dd,#0c111bdd);border-radius:16px}.stat{padding:15px}.stat b{display:block;font-size:24px}.layout{grid-template-columns:390px minmax(0,1fr);align-items:start}.panel{min-width:0;overflow:hidden}.panel-head{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}.event-list{max-height:calc(100vh - 300px);overflow:auto}.event{width:100%;border:0;border-bottom:1px solid #20293a;background:transparent;color:inherit;padding:13px 15px;text-align:left;cursor:pointer;display:grid;grid-template-columns:auto 1fr auto;gap:11px}.event:hover,.event.active{background:#172033}.event.active{box-shadow:inset 3px 0 var(--cyan)}.glyph{width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:#232d42;font-weight:800;color:var(--cyan)}.event-title{font-weight:700}.event-summary{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.time{color:#758198;font-size:11px}.empty{padding:50px 22px;text-align:center;color:var(--muted)}.detail{padding:18px}.detail-top{display:flex;gap:14px;justify-content:space-between;align-items:start}.detail h2{margin:0;font-size:22px}.badge{display:inline-flex;padding:4px 8px;border-radius:999px;background:#202b40;color:var(--cyan);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.detail-actions{display:flex;gap:8px;flex-wrap:wrap}.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:18px -18px 14px;padding:0 18px}.tab{border:0;background:transparent;color:var(--muted);padding:10px;cursor:pointer;border-bottom:2px solid transparent}.tab.active{color:var(--text);border-color:var(--violet)}.detail-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin:14px 0}.kv{border:1px solid #242f43;background:#0c111a;padding:11px;border-radius:10px;min-width:0}.kv small{display:block;color:var(--muted);margin-bottom:4px}.kv div{overflow-wrap:anywhere}.code{position:relative;background:#080b11;border:1px solid #242f43;border-radius:12px;padding:15px;max-height:58vh;overflow:auto}.code pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}.j-key{color:#8ed5ff}.j-string{color:#a9e98e}.j-number{color:#ffc66d}.j-bool{color:#d7a4ff}.records{display:flex;gap:7px;overflow:auto;padding-bottom:9px}.record{white-space:nowrap}.record.active{border-color:var(--cyan);color:var(--cyan)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #222c3e;vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase}.error{border:1px solid #733647;background:#29141b;color:#ffb6c2;padding:12px;border-radius:12px;margin-bottom:12px}.toast{position:fixed;right:20px;bottom:20px;background:#e9f7ff;color:#071018;padding:10px 14px;border-radius:10px;font-weight:700;opacity:0;transform:translateY(10px);transition:.2s}.toast.show{opacity:1;transform:none}@media(max-width:900px){.layout{grid-template-columns:1fr}.event-list{max-height:340px}.controls{grid-template-columns:1fr 1fr}.stats{grid-template-columns:1fr 1fr}.detail-grid{grid-template-columns:1fr}}@media(max-width:520px){.shell{padding:14px}.top{display:block}.live{width:max-content;margin-top:10px}.controls{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top"><div><h1>Lambda Event Diagnostics</h1><div class="muted" id="subtitle"></div><a class="btn" href="${model.logsPath}">Local logs (no AWS permissions)</a></div><div class="live"><span class="dot"></span> active</div></header>
    <section class="controls"><input id="search" type="search" placeholder="Search type, request id, ARN, body…"><select id="kind"><option value="">Every event type</option></select><select id="window"><option value="1">Last hour</option><option value="6">Last 6 hours</option><option value="24">Last 24 hours</option><option value="168">Last 7 days</option></select><button class="btn" id="refresh">Refresh logs</button></section>
    <section class="stats"><div class="stat"><span class="muted">Events loaded</span><b id="total">0</b></div><div class="stat"><span class="muted">Recognized types</span><b id="types">0</b></div><div class="stat"><span class="muted">Stream records</span><b id="records">0</b></div><div class="stat"><span class="muted">Visible bytes</span><b id="bytes">0</b></div></section>
    <div id="error"></div>
    <section class="layout"><aside class="panel"><div class="panel-head"><b>Invocation timeline</b><span class="muted" id="visible"></span></div><div class="event-list" id="events"></div></aside><article class="panel"><div class="detail" id="detail"><div class="empty">Pick an invocation to inspect it.</div></div></article></section>
  </main>
  <div class="toast" id="toast">Copied</div>
  <script id="diagnostic-data" type="application/json">${inlineJson(model)}</script>
  <script>
    const model=JSON.parse(document.getElementById('diagnostic-data').textContent);const $=id=>document.getElementById(id);let selected=null,tab='overview',recordIndex=0;const params=new URLSearchParams(location.search);const streamMode=params.get('mode')==='streams';
    const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const pretty=value=>JSON.stringify(value,null,2);const bytes=value=>new TextEncoder().encode(value).length;const size=n=>n>1048576?(n/1048576).toFixed(1)+' MB':n>1024?(n/1024).toFixed(1)+' KB':n+' B';
    const syntax=value=>h(pretty(value)).replace(/(&quot;.*?&quot;)(\\s*:)?/g,(m,s,colon)=>'<span class="'+(colon?'j-key':'j-string')+'">'+s+'</span>'+(colon||'')).replace(/\\b(true|false|null)\\b/g,'<span class="j-bool">$1</span>').replace(/\\b(-?\\d+(?:\\.\\d+)?)\\b/g,'<span class="j-number">$1</span>');
    const icon=kind=>({sqs:'SQ',kinesis:'KI','dynamodb-stream':'DB',s3:'S3',sns:'SN',eventbridge:'EB','function-url':'FU','http-api':'H2','rest-api':'H1',alb:'AL',websocket:'WS',cognito:'CO',kafka:'KA','cloudwatch-logs':'CW','lambda-destination':'LD','raw-log':'!!',direct:'λ'}[kind]||'λ');
    function payload(entry,index){const r=entry.event?.Records?.[index];if(!r)return entry.event;if(entry.kind==='sqs'){try{return JSON.parse(r.body)}catch{return r.body}}if(entry.kind==='kinesis'){try{const raw=Uint8Array.from(atob(r.kinesis.data),c=>c.charCodeAt(0));const text=new TextDecoder().decode(raw);try{return JSON.parse(text)}catch{return text}}catch{return r.kinesis?.data}}if(entry.kind==='dynamodb-stream')return r.dynamodb?.NewImage??r.dynamodb?.OldImage??r;return r}
    function schema(value,path='$',out=[]){const type=value===null?'null':Array.isArray(value)?'array':typeof value;out.push({path,type,example:type==='object'||type==='array'?'':String(value).slice(0,100)});if(type==='object')Object.entries(value).slice(0,100).forEach(([k,v])=>schema(v,path+'.'+k,out));if(type==='array'&&value.length)schema(value[0],path+'[]',out);return out}
    function reproduce(entry){return 'aws lambda invoke --function-name '+(model.functionName||'my-function')+' --cli-binary-format raw-in-base64-out --payload fileb://event.json response.json\\n\\n'+pretty(entry.event)}
    function copy(text){navigator.clipboard?.writeText(text).catch(()=>{const a=document.createElement('textarea');a.value=text;document.body.append(a);a.select();document.execCommand('copy');a.remove()});$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),1000)}
    function filtered(){const q=$('search').value.toLowerCase(),kind=$('kind').value;return model.entries.filter(e=>(!streamMode||e.kind==='sqs'||e.kind==='kinesis')&&(!kind||e.kind===kind)&&(!q||JSON.stringify(e).toLowerCase().includes(q)))}
    function renderList(){const rows=filtered();$('visible').textContent=rows.length+' shown';$('events').innerHTML=rows.length?rows.map(e=>'<button class="event '+(selected?.id===e.id?'active':'')+'" data-id="'+h(e.id)+'"><span class="glyph">'+icon(e.kind)+'</span><span><span class="event-title">'+h(e.kind)+'</span><span class="event-summary">'+h(e.summary)+'</span></span><time class="time">'+new Date(e.at).toLocaleTimeString()+'</time></button>').join(''):'<div class="empty">No matching diagnostic events.</div>';$('events').querySelectorAll('.event').forEach(el=>el.onclick=()=>{selected=model.entries.find(e=>e.id===el.dataset.id);tab='overview';recordIndex=0;render()});if(!selected&&rows[0]){selected=rows[0];renderDetail()}}
    function renderDetail(){if(!selected){$('detail').innerHTML='<div class="empty">Pick an invocation to inspect it.</div>';return}const e=selected,records=e.event?.Records??[],activePayload=payload(e,recordIndex);let content='';if(tab==='overview')content='<div class="detail-grid">'+e.recognized.map(x=>'<div class="kv"><small>'+h(x[0])+'</small><div>'+h(x[1])+'</div></div>').join('')+'</div><div class="code"><pre>'+syntax(activePayload)+'</pre></div>';if(tab==='raw')content='<div class="code"><pre>'+syntax(e.event)+'</pre></div><h3>Original CloudWatch log</h3><div class="code"><pre>'+h(e.rawLog)+'</pre></div>';if(tab==='schema'){const rows=schema(activePayload);content='<div class="code"><table><thead><tr><th>JSON path</th><th>Type</th><th>Example</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+h(x.path)+'</td><td>'+h(x.type)+'</td><td>'+h(x.example)+'</td></tr>').join('')+'</tbody></table></div>'}if(tab==='replay')content='<p class="muted">Replay this exact sanitized event through the Lambda CLI.</p><div class="code"><pre>'+h(reproduce(e))+'</pre></div>';
      const picker=records.length?'<div class="records">'+records.map((_,i)=>'<button class="btn record '+(i===recordIndex?'active':'')+'" data-record="'+i+'">Record '+(i+1)+'</button>').join('')+'</div>':'';
      $('detail').innerHTML='<div class="detail-top"><div><span class="badge">'+h(e.kind)+'</span><h2>'+h(e.summary)+'</h2><div class="muted">'+new Date(e.at).toLocaleString()+' · '+h(e.requestId||e.id)+'</div></div><div class="detail-actions"><button class="btn" id="copy-payload">Copy payload</button><button class="btn" id="copy-event">Copy event</button></div></div><div class="tabs"><button class="tab '+(tab==='overview'?'active':'')+'" data-tab="overview">Parsed</button><button class="tab '+(tab==='schema'?'active':'')+'" data-tab="schema">Schema</button><button class="tab '+(tab==='raw'?'active':'')+'" data-tab="raw">Raw + log</button><button class="tab '+(tab==='replay'?'active':'')+'" data-tab="replay">Replay</button></div>'+picker+content;
      $('copy-payload').onclick=()=>copy(pretty(activePayload));$('copy-event').onclick=()=>copy(pretty(e.event));$('detail').querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>{tab=el.dataset.tab;renderDetail()});$('detail').querySelectorAll('[data-record]').forEach(el=>el.onclick=()=>{recordIndex=Number(el.dataset.record);renderDetail()})}
    function render(){renderList();renderDetail()}const kinds=[...new Set(model.entries.map(e=>e.kind))].sort();$('kind').innerHTML+=[...kinds].map(k=>'<option>'+h(k)+'</option>').join('');$('window').value=String(model.hours);$('subtitle').textContent=(streamMode?'Stream dataset laboratory · ':'')+model.logGroup+' · '+model.hours+'h window';$('total').textContent=model.entries.length;$('types').textContent=kinds.length;$('records').textContent=model.entries.reduce((n,e)=>n+(e.event?.Records?.length??0),0);$('bytes').textContent=size(model.entries.reduce((n,e)=>n+bytes(JSON.stringify(e.event)),0));if(model.error)$('error').innerHTML='<div class="error">'+h(model.error)+'</div>';$('search').oninput=render;$('kind').onchange=render;$('refresh').onclick=()=>location.reload();$('window').onchange=()=>{params.set('hours',$('window').value);location.search=params};render();
  </script>
</body>
</html>`;
}

async function runDiagnostic(event, context = {}) {
  event = event && typeof event === 'object' ? event : { value: event };
  const kind = classify(event);
  const id = context?.awsRequestId ?? randomUUID();
  const entry = {
    diagnosticVersion: 1,
    id,
    requestId: context.awsRequestId,
    functionVersion: context.functionVersion,
    functionArn: context.invokedFunctionArn,
    at: Date.now(),
    kind,
    summary: summary(event, kind),
    recognized: recognized(event, kind),
    event,
  };

  try {
    emit(entry);
  } catch (error) {
    console.error('Lambda Gadget could not serialize the event:', error);
  }

  if (!dashboardRequest(event)) return null;
  if (!dashboardAuthorized(event)) {
    return response('<h1>Authentication required</h1>', 401, {
      'www-authenticate': 'Basic realm="Lambda diagnostics"',
    });
  }

  const http = httpInfo(event);
  const query = new URLSearchParams(http?.query ?? '');
  const hours = Math.min(168, Math.max(1, Number(query.get('hours')) || 6));
  const limit = Math.min(1000, Math.max(20, Number(query.get('limit')) || 250));
  const logGroup =
    process.env.DIAGNOSTIC_LOG_GROUP ?? '/aws/lambda/' + process.env.AWS_LAMBDA_FUNCTION_NAME;
  const logsPath = escapeHtml(http.path.replace(/\/$/, '') + '/logs');
  const maxBytes = event.requestContext?.elb ? 600_000 : 4_000_000;
  const remaining = context.getRemainingTimeInMillis?.() ?? 30_000;
  const signal = AbortSignal.any([
    AbortSignal.timeout(Math.max(1, Math.min(6000, remaining - 1000))),
    ...(context.gadgetAbortSignal ? [context.gadgetAbortSignal] : []),
  ]);

  try {
    const entries = await queryOwnLogs({ hours, limit: Math.floor(limit), signal });
    return response(
      boundedDashboard(
        {
          entries,
          hours,
          limit,
          logGroup,
          logsPath,
          functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        },
        maxBytes,
      ),
    );
  } catch (error) {
    console.error('Lambda Gadget dashboard query failed:', error);
    return response(
      renderDashboard({
        entries: [],
        hours,
        limit,
        logGroup,
        logsPath,
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        error:
          error.name +
          ': ' +
          error.message +
          '. Check logs:FilterLogEvents permission and CloudWatch connectivity, or open local logs.',
      }),
    );
  }
}

export async function diagnostic(event, context = {}) {
  try {
    return await runDiagnostic(event, context);
  } catch (error) {
    try {
      console.error('Lambda Gadget disabled itself after an unexpected error:', error);
    } catch {}
    if (dashboardRequest(event)) {
      if (!dashboardAuthorized(event))
        return response('<h1>Authentication required</h1>', 401, {
          'www-authenticate': 'Basic realm="Lambda diagnostics"',
        });
      return response(
        '<h1>Lambda diagnostic error</h1><pre>' +
          escapeHtml(error?.stack ?? error) +
          '</pre><a href="' +
          escapeHtml(httpInfo(event).path.replace(/\/$/, '') + '/logs') +
          '">View local logs</a>',
        500,
      );
    }
    return null;
  }
}

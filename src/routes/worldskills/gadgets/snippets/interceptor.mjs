import { withLocalLogs } from './local-logs.mjs';

const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function inboundRequest(event) {
  const v2 = event.requestContext?.http;
  const method = v2?.method ?? event.httpMethod;
  const path = event.rawPath ?? event.path ?? '/';
  const query =
    event.rawQueryString ?? new URLSearchParams(event.queryStringParameters ?? {}).toString();
  const headers = new Headers();

  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value != null && !HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
  }
  for (const [name, values] of Object.entries(event.multiValueHeaders ?? {})) {
    if (!HOP_BY_HOP.has(name.toLowerCase()))
      for (const value of values) headers.append(name, value);
  }
  if (event.cookies?.length) headers.set('cookie', event.cookies.join('; '));

  return {
    version: v2 ? '2.0' : '1.0',
    method,
    path,
    query,
    headers,
    body:
      event.body == null
        ? undefined
        : event.isBase64Encoded
          ? Buffer.from(event.body, 'base64')
          : event.body,
  };
}

function upstreamUrl(base, inbound) {
  const url = new URL(base);
  url.pathname = (
    url.pathname.replace(/\/$/, '') +
    '/' +
    inbound.path.replace(/^\//, '')
  ).replaceAll('//', '/');
  url.search = inbound.query;
  return url;
}

function responseHeaders(headers) {
  const plain = {};
  for (const [name, value] of headers) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== 'set-cookie')
      plain[name] = value;
  }
  return plain;
}

async function beforeForward(request, event) {
  request.headers.set('x-intercepted-by', process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'lambda');
  request.headers.set('x-original-request-id', event.requestContext?.requestId ?? 'direct');
  return request;
}

async function afterForward(response, body) {
  return { response, body };
}

export const handler = withLocalLogs(async (event, context) => {
  const { diagnostic } = await import('./diagnostic.mjs');
  const diagnosticResponse = await diagnostic(event, context);
  if (diagnosticResponse) return diagnosticResponse;

  const inbound = await beforeForward(inboundRequest(event), event);
  const url = upstreamUrl(process.env.UPSTREAM_URL, inbound);
  const upstream = await fetch(url, {
    method: inbound.method,
    headers: inbound.headers,
    body: ['GET', 'HEAD'].includes(inbound.method) ? undefined : inbound.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000)),
  });

  const contentType = upstream.headers.get('content-type') ?? '';
  const textual = /json|text|xml|javascript|x-www-form-urlencoded/i.test(contentType);
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const transformed = await afterForward(upstream, textual ? bytes.toString() : bytes);
  const body = Buffer.isBuffer(transformed.body)
    ? transformed.body.toString('base64')
    : String(transformed.body);
  const cookies = transformed.response.headers.getSetCookie?.() ?? [];
  const base = {
    statusCode: transformed.response.status,
    headers: responseHeaders(transformed.response.headers),
    body,
    isBase64Encoded: Buffer.isBuffer(transformed.body),
  };

  return inbound.version === '2.0'
    ? { ...base, cookies }
    : { ...base, multiValueHeaders: cookies.length ? { 'set-cookie': cookies } : undefined };
});

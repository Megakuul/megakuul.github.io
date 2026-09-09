import { STATUS_CODES } from 'node:http';

export const reply = (statusCode, data, headers = {}, cookies = []) => ({
  statusCode,
  data,
  headers,
  cookies,
});

// Strings are sent verbatim; Buffer/Uint8Array bodies are encoded for Lambda automatically.
export const rawReply = (statusCode, body = '', headers = {}, cookies = []) => ({
  statusCode,
  body,
  headers,
  cookies,
  raw: true,
});

function encodeResponse(response) {
  const binary = response.raw && response.body instanceof Uint8Array;
  if (response.raw && !binary && typeof response.body !== 'string')
    throw new TypeError('rawReply body must be a string, Buffer, or Uint8Array');
  const contentType = response.raw
    ? binary
      ? 'application/octet-stream'
      : 'text/plain; charset=utf-8'
    : 'application/json';
  return {
    headers: {
      'content-type': contentType,
      ...Object.fromEntries(
        Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]),
      ),
    },
    isBase64Encoded: Boolean(binary),
    body: response.raw
      ? binary
        ? Buffer.from(response.body).toString('base64')
        : response.body
      : JSON.stringify(response.data),
  };
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function decode(value, plus = false) {
  try {
    return decodeURIComponent(plus ? value.replaceAll('+', ' ') : value);
  } catch {
    throw badRequest('Invalid URL encoding');
  }
}

// Query and header values are arrays. Multivalue fields override their single-value copy.
function values(single, multi, keyTransform = value => value, valueTransform = value => value) {
  const result = Object.create(null);
  for (const [key, value] of Object.entries(single ?? {}))
    result[keyTransform(key)] = [valueTransform(value)];
  for (const [key, items] of Object.entries(multi ?? {}))
    result[keyTransform(key)] = items.map(valueTransform);
  return result;
}

function pathParts(path, encoded, basePath) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw badRequest('Missing HTTP path');
  if (basePath) {
    if (path !== basePath && !path.startsWith(basePath + '/')) return null;
    path = path.slice(basePath.length) || '/';
  }
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  // Split before decoding: /users/a%2Fb is one parameter on raw-path integrations.
  return path === '/'
    ? []
    : path
        .slice(1)
        .split('/')
        .map(part => (encoded ? decode(part) : part));
}

function match(pattern, parts) {
  if (!parts) return null;
  const template = pattern === '/' ? [] : pattern.slice(1).split('/');
  const params = Object.create(null);
  let index = 0;
  for (const part of template) {
    if (part.startsWith('{') && part.endsWith('}')) {
      const name = part.slice(1, -1);
      if (name.endsWith('+')) {
        if (
          index !== template.length - 1 ||
          index >= parts.length ||
          parts.slice(index).some(p => !p)
        )
          return null;
        params[name.slice(0, -1)] = parts.slice(index).join('/');
        return params;
      }
      if (!parts[index]) return null;
      params[name] = parts[index];
    } else if (part !== parts[index]) return null;
    index++;
  }
  return index === parts.length ? params : null;
}

function bodyBytes(event) {
  const body = event.body ?? '';
  if (typeof body !== 'string') throw badRequest('HTTP body must be a string');
  if (
    event.isBase64Encoded &&
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)
  )
    throw badRequest('Invalid base64 body');
  return Buffer.from(body, event.isBase64Encoded ? 'base64' : 'utf8');
}

const UNMATCHED = Symbol('unmatched route');

async function dispatch(request, routes, middleware, basePath, fallthrough) {
  const parts = pathParts(request.path, request.encodedPath, basePath);
  const matches = routes.flatMap(([method, pattern, handle]) => {
    const params = match(pattern, parts);
    return params === null ? [] : [{ method, handle, params }];
  });
  const route =
    matches.find(route => route.method === request.method) ??
    (request.method === 'HEAD' ? matches.find(route => route.method === 'GET') : undefined);
  if (!route) {
    if (fallthrough) return UNMATCHED;
    if (!matches.length) return reply(404, { error: 'Not found' });
    const allow = new Set(matches.map(route => route.method));
    if (allow.has('GET')) allow.add('HEAD');
    return reply(405, { error: 'Method not allowed' }, { allow: [...allow].sort().join(', ') });
  }
  request.params = route.params;
  request.body = bodyBytes(request.event); // Buffer; binary bodies remain intact.
  request.json = () => {
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.body));
    } catch {
      throw badRequest('Body must contain valid UTF-8 JSON');
    }
  };
  const run = index =>
    index === middleware.length
      ? route.handle(request)
      : middleware[index](request, () => run(index + 1));
  return await run(0);
}

// Pass routes as [method, path pattern, handler]. First matching method + path wins.
// Middleware receives (request, next); request.params is available before it runs.
// basePath only strips an explicit prefix present in the event path, never an inferred stage.
// Non-HTTP events return null so this gadget can be composed with another handler.
// Optional fallback(event, context) handles non-HTTP events and unmatched paths/methods.
// Its final Lambda response is returned unchanged; errors propagate to the caller.
export function createRouter(routes, { middleware = [], basePath = '', fallback } = {}) {
  return async (event, context = {}) => {
    const format = event?.requestContext?.http
      ? 'v2'
      : event?.requestContext?.elb
        ? 'alb'
        : event?.httpMethod
          ? 'v1'
          : null;
    if (!format) return fallback ? fallback(event, context) : null;
    const { readRequest, writeResponse } = adapters[format];
    let request;
    let response;
    let result;
    try {
      request = readRequest(event);
      request.event = event;
      request.context = context;
      request.requestId = context.awsRequestId ?? event.requestContext?.requestId ?? 'unknown';
      response = await dispatch(request, routes, middleware, basePath, Boolean(fallback));
      if (response !== UNMATCHED) result = writeResponse(response, event);
    } catch (error) {
      if (error?.statusCode === 400) response = reply(400, { error: error.message });
      else {
        console.error('HTTP handler failed', context.awsRequestId, error);
        response = reply(500, { error: 'Internal server error', requestId: request?.requestId });
      }
      result = writeResponse(response, event);
    }
    if (response === UNMATCHED) return fallback(event, context);
    if (request?.method === 'HEAD' || [204, 304].includes(result.statusCode)) result.body = '';
    return result;
  };
}

// Function URL or HTTP API payload 2.0. routeKey/pathParameters are not used for routing.
function readV2(event) {
  const http = event.requestContext?.http;
  if (!http?.method || typeof event.rawPath !== 'string')
    throw badRequest('Expected HTTP payload 2.0');
  const query = Object.create(null);
  // Do not split queryStringParameters on commas: a comma can be part of a value.
  for (const [key, value] of new URLSearchParams(event.rawQueryString ?? ''))
    (query[key] ??= []).push(value);
  return {
    source: 'http-v2',
    method: http.method,
    path: event.rawPath,
    encodedPath: true,
    query,
    headers: values(event.headers, null, key => key.toLowerCase()),
    cookies: event.cookies ?? [],
  };
}

function writeV2(response) {
  return {
    statusCode: response.statusCode,
    ...encodeResponse(response),
    cookies: response.cookies,
  };
}

// REST proxy or HTTP API payload 1.0. Match event.path even for ANY /{proxy+}.
function readV1(event) {
  if (!event.httpMethod || event.requestContext?.elb)
    throw badRequest('Expected API Gateway payload 1.0');
  const headers = values(event.headers, event.multiValueHeaders, key => key.toLowerCase());
  return {
    source: 'apigw-v1',
    method: event.httpMethod,
    path: event.path,
    encodedPath: false,
    // API Gateway already decoded these values. Do not decode percent signs again.
    query: values(event.queryStringParameters, event.multiValueQueryStringParameters),
    headers,
    cookies: headers.cookie ?? [],
  };
}

function writeV1(response) {
  return {
    statusCode: response.statusCode,
    ...encodeResponse(response),
    multiValueHeaders: response.cookies.length ? { 'set-cookie': response.cookies } : {},
  };
}

// ALB Lambda target; supports both values of lambda.multi_value_headers.enabled.
function readALB(event) {
  if (!event.httpMethod || !event.requestContext?.elb)
    throw badRequest('Expected ALB Lambda target event');
  const headers = values(event.headers, event.multiValueHeaders, key => key.toLowerCase());
  return {
    source: 'alb',
    method: event.httpMethod,
    path: event.path,
    encodedPath: true,
    query: values(
      event.queryStringParameters,
      event.multiValueQueryStringParameters,
      key => decode(key, true),
      value => decode(value, true),
    ),
    headers,
    cookies: headers.cookie ?? [],
  };
}

function writeALB(response, event) {
  const multi = Object.hasOwn(event, 'multiValueHeaders');
  if (!multi && response.cookies.length > 1) {
    console.error('Enable ALB multivalue headers to return multiple cookies');
    response = reply(500, { error: 'Multiple cookies require ALB multivalue headers' });
  }
  const { headers, ...encoded } = encodeResponse(response);
  const result = {
    statusCode: response.statusCode,
    statusDescription: response.statusCode + ' ' + (STATUS_CODES[response.statusCode] ?? 'Unknown'),
    ...encoded,
  };
  if (multi) {
    result.multiValueHeaders = values(headers);
    if (response.cookies.length) result.multiValueHeaders['set-cookie'] = response.cookies;
  } else {
    result.headers = headers;
    if (response.cookies.length) result.headers['set-cookie'] = response.cookies[0];
  }
  return result;
}

const adapters = {
  v2: { readRequest: readV2, writeResponse: writeV2 },
  v1: { readRequest: readV1, writeResponse: writeV1 },
  alb: { readRequest: readALB, writeResponse: writeALB },
};

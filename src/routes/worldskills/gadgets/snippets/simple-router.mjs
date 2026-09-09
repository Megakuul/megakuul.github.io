// index.mjs — Lambda handler: index.handler
const routes = [
  ['GET', '/', () => reply(200, 'Hello world')],
  ['GET', '/health', () => reply(200, { ok: true })],
  ['GET', '/users/{id}', req => reply(200, { id: req.params.id })],
  ['GET', '/search', req => reply(200, { q: req.query.q ?? '' })],
  ['POST', '/echo', req => reply(200, req.json())],
];

function reply(statusCode, body, headers = {}) {
  const text = typeof body === 'string';
  return {
    statusCode,
    headers: {
      'content-type': text ? 'text/plain; charset=utf-8' : 'application/json',
      ...headers,
    },
    body: text ? body : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

export async function handler(event, context) {
  const method = event.requestContext?.http?.method ?? event.httpMethod;
  const path = event.rawPath ?? event.path ?? event.requestContext?.http?.path;
  const finish = response => {
    if (method === 'HEAD' || [204, 304].includes(response.statusCode)) response.body = '';
    if (event.requestContext?.elb && event.multiValueHeaders) {
      response.multiValueHeaders = Object.fromEntries(
        Object.entries(response.headers).map(([key, value]) => [key, [value]]),
      );
      delete response.headers;
    }
    return response;
  };
  if (!method || !path) return finish(reply(400, 'Expected an HTTP event with method and path'));

  try {
    const decodePath = event.rawPath != null || Boolean(event.requestContext?.elb);
    const parts = path
      .replace(/\/$/, '')
      .split('/')
      .map(p => (decodePath ? decodeURIComponent(p) : p));
    const allowed = new Set();
    for (const [verb, pattern, run] of routes) {
      const keys = pattern.replace(/\/$/, '').split('/');
      const params = {};
      if (
        keys.length !== parts.length ||
        !keys.every((key, i) => {
          if (/^\{\w+\}$/.test(key) && parts[i]) {
            Object.defineProperty(params, key.slice(1, -1), { value: parts[i], enumerable: true });
            return true;
          }
          return key === parts[i];
        })
      )
        continue;
      allowed.add(verb);
      if (verb === 'GET') allowed.add('HEAD');
      if (verb !== method && !(method === 'HEAD' && verb === 'GET')) continue;

      const body = event.isBase64Encoded
        ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
        : (event.body ?? '');
      let query =
        event.rawQueryString != null
          ? Object.fromEntries(new URLSearchParams(event.rawQueryString))
          : { ...event.queryStringParameters };
      for (const [key, values] of Object.entries(event.multiValueQueryStringParameters ?? {}))
        query[key] = values.at(-1);
      if (event.requestContext?.elb) {
        const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
        query = Object.fromEntries(Object.entries(query).map(([k, v]) => [decode(k), decode(v)]));
      }
      const req = {
        params,
        query,
        body,
        event,
        context,
        headers: Object.fromEntries(
          Object.entries({ ...event.headers, ...event.multiValueHeaders }).map(([k, v]) => [
            k.toLowerCase(),
            Array.isArray(v) ? v.join(', ') : v,
          ]),
        ),
        json: () => {
          try {
            return JSON.parse(body);
          } catch {
            throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
          }
        },
      };
      return finish(await run(req));
    }
    return finish(
      allowed.size
        ? reply(405, 'Method not allowed', { allow: [...allowed].join(', ') })
        : reply(404, 'Not found'),
    );
  } catch (error) {
    if (error instanceof URIError || error.statusCode === 400)
      return finish(reply(400, 'Bad request'));
    console.error(error);
    return finish(reply(500, 'Internal server error'));
  }
}

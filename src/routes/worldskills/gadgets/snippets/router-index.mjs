import { createRouter, reply, rawReply } from './http-router.mjs';

// Copy http-router.mjs beside this file; set Lambda's handler to router-index.handler.
// Detects Function URLs, HTTP API v2, REST/API Gateway v1, and ALB automatically.
const route = createRouter(
  [
    ['GET', '/health', () => reply(200, { ok: true })],
    ['GET', '/hello', () => rawReply(200, 'Hello world')],
    [
      'GET',
      '/page',
      () => rawReply(200, '<h1>Hello</h1>', { 'content-type': 'text/html; charset=utf-8' }),
    ],
    ['GET', '/users/{id}/blub/ananas/{another_id}', req => reply(200, req.params)],
    ['POST', '/users', req => reply(201, { created: req.json() })],
  ],
  { fallback: () => null },
); // Also fall through for unmatched HTTP paths/methods.

export const handler = async (event, context) => {
  const response = await route(event, context);
  if (response !== null) return response;
  // Your existing handler continues here (SQS, EventBridge, other HTTP routes, etc.).
  return { ok: true };
};

// Or delegate directly: createRouter(routes, { fallback: existingHandler }).
// fallback gets the original event/context and returns a final Lambda response (not reply()).

// Optional second argument: { basePath: '/api', middleware: [async (req, next) => next()] }
// req.params, req.query (arrays), req.headers (arrays), req.cookies, req.body (Buffer).
// reply() serializes JSON. rawReply() sends strings verbatim or Buffer/Uint8Array as binary.

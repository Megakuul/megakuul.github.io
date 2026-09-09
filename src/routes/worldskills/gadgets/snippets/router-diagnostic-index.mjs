import { createRouter, reply } from './http-router.mjs';
import { withLocalLogs } from './local-logs.mjs';

const route = createRouter([['GET', '/users/{id}', req => reply(200, { id: req.params.id })]], {
  fallback: () => null,
});

// Include http-router.mjs, diagnostic.mjs, and local-logs.mjs.
// Set Lambda's handler to router-diagnostic-index.handler.
export const handler = withLocalLogs(async (event, context) => {
  const { diagnostic } = await import('./diagnostic.mjs');
  const dashboard = await diagnostic(event, context);
  if (dashboard) return dashboard; // /web; withLocalLogs handles /web/logs.
  const response = await route(event, context);
  if (response !== null) return response;
  return { ok: true }; // Existing handler code for non-HTTP events or unmatched routes here.
});

import { withLocalLogs } from './local-logs.mjs';

// Set Lambda's handler to local-logs-index.handler. Copy both .mjs files.
// No packages or execution-role policies are needed for this gadget.
// Set DIAGNOSTIC_USER and DIAGNOSTIC_PASSWORD to protect the viewer with Basic auth.
export const handler = withLocalLogs(
  async (event, context) => {
    // Put your handler here (or dynamically import it here to capture import failures).
    console.log('Received event', event);
    console.log('Running custom handler code for request', context.awsRequestId);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, receivedAt: new Date().toISOString() }),
    };
  },
  { path: '/web' },
);

import { withLocalLogs } from './local-logs.mjs';

export const handler = withLocalLogs(
  async (event, context) => {
    const { databaseWorkbench } = await import('./database-workbench.mjs');
    const response = await databaseWorkbench(event, context);
    if (response) return response;

    return {
      statusCode: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Open /web or invoke with gadget: database-query' }),
    };
  },
  { userEnv: 'DB_WORKBENCH_USER', passwordEnv: 'DB_WORKBENCH_PASSWORD', defaultUser: 'database' },
);

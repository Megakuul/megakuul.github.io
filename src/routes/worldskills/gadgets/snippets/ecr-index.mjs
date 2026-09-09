import { withLocalLogs } from './local-logs.mjs';

export const handler = withLocalLogs(
  async (event, context) => {
    const { ecrManager } = await import('./ecr-manager.mjs');
    const response = await ecrManager(event, context);
    return (
      response ?? {
        statusCode: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Not found' }),
      }
    );
  },
  { userEnv: 'ECR_MANAGER_USER', passwordEnv: 'ECR_MANAGER_PASSWORD', defaultUser: 'ecr' },
);

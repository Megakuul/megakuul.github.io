import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand, StopQueryExecutionCommand } from '@aws-sdk/client-athena';

const db = new AthenaClient({});

export const handler = async (event = {}, context) => {
  const min = Number(event.minAmount ?? 2);
  if (!Number.isFinite(min)) throw new Error('minAmount must be a number');
  const deadline = Date.now() + Math.max(1, Math.min(45000, (context?.getRemainingTimeInMillis?.() ?? 60000) - 2000));
  const send = command => db.send(command, { abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
  const { QueryExecutionId } = await send(new StartQueryExecutionCommand({
    WorkGroup: process.env.ATHENA_WORKGROUP || 'primary',
    QueryExecutionContext: { Catalog: 'AwsDataCatalog', Database: process.env.ATHENA_DATABASE || 'default' },
    ResultConfiguration: { OutputLocation: process.env.ATHENA_OUTPUT },
    QueryString: "WITH sales(category, amount) AS (VALUES ('fruit',2.5),('fruit',3.0),('bread',5.0)) SELECT category, count(*) AS orders, sum(amount) AS revenue, avg(amount) AS average FROM sales WHERE amount >= ? GROUP BY category ORDER BY revenue DESC LIMIT 100",
    ExecutionParameters: [String(min)],
  }));
  try {
    let query;
    while (Date.now() < deadline) {
      ({ QueryExecution: query } = await send(new GetQueryExecutionCommand({ QueryExecutionId })));
      if (query.Status.State === 'SUCCEEDED') break;
      if (['FAILED', 'CANCELLED'].includes(query.Status.State)) throw new Error(query.Status.StateChangeReason || query.Status.State);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (query?.Status.State !== 'SUCCEEDED') throw new Error('Athena query timed out');
    const rows = [];
    let NextToken;
    let firstPage = true;
    do {
      const page = await send(new GetQueryResultsCommand({ QueryExecutionId, NextToken, MaxResults: 1000 }));
      const columns = page.ResultSet.ResultSetMetadata.ColumnInfo.map(column => column.Name);
      for (const row of (firstPage ? page.ResultSet.Rows.slice(1) : page.ResultSet.Rows)) rows.push(Object.fromEntries(columns.map((name, i) => [name, row.Data[i]?.VarCharValue ?? null])));
      firstPage = false;
      NextToken = page.NextToken;
    } while (NextToken);
    return { queryId: QueryExecutionId, rows, bytesScanned: query.Statistics?.DataScannedInBytes, executionMs: query.Statistics?.EngineExecutionTimeInMillis };
  } catch (error) {
    await db.send(new StopQueryExecutionCommand({ QueryExecutionId }), { abortSignal: AbortSignal.timeout(1500) }).catch(() => {});
    throw error;
  }
};

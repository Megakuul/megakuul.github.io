import { RedshiftDataClient, BatchExecuteStatementCommand, DescribeStatementCommand, GetStatementResultCommand, CancelStatementCommand } from '@aws-sdk/client-redshift-data';

const db = new RedshiftDataClient({});

export const handler = async (event = {}, context) => {
  const deadline = Date.now() + Math.max(1, Math.min(45000, (context?.getRemainingTimeInMillis?.() ?? 60000) - 2000));
  const send = command => db.send(command, { abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
  const min = Number(event.minAmount ?? 2);
  if (!Number.isFinite(min)) throw new Error('minAmount must be a number');
  const { Id } = await send(new BatchExecuteStatementCommand({
    Database: process.env.REDSHIFT_DATABASE || 'dev',
    ...(process.env.REDSHIFT_CLUSTER ? { ClusterIdentifier: process.env.REDSHIFT_CLUSTER } : { WorkgroupName: process.env.REDSHIFT_WORKGROUP }),
    ...(process.env.REDSHIFT_SECRET_ARN ? { SecretArn: process.env.REDSHIFT_SECRET_ARN } : {}),
    Parameters: [{ name: 'min', value: String(min) }],
    Sqls: [
      'CREATE TEMP TABLE demo_sales (id integer, category varchar(40), amount decimal(10,2))',
      "INSERT INTO demo_sales VALUES (1,'fruit',2.50),(2,'fruit',3.00),(3,'bread',5.00)",
      'UPDATE demo_sales SET amount = 4 WHERE id = 1',
      'SELECT category, count(*) AS orders, sum(amount) AS revenue, avg(amount) AS average FROM demo_sales WHERE amount >= :min GROUP BY category ORDER BY revenue DESC',
      'SELECT id, category, amount, dense_rank() OVER (ORDER BY amount DESC) AS rank FROM demo_sales ORDER BY rank LIMIT 100',
      'DELETE FROM demo_sales WHERE id = 2',
      'SELECT count(*) AS remaining FROM demo_sales',
      'DROP TABLE demo_sales',
    ],
  }));
  try {
    let state;
    while (Date.now() < deadline) {
      state = await send(new DescribeStatementCommand({ Id }));
      if (state.Status === 'FINISHED') break;
      if (['FAILED', 'ABORTED'].includes(state.Status)) throw new Error(state.Error || state.Status);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (state?.Status !== 'FINISHED') throw new Error('Redshift query timed out');
    const results = [];
    for (const statement of state.SubStatements ?? []) {
      if (!statement.HasResultSet) continue;
      const rows = [];
      let NextToken;
      do {
        const page = await send(new GetStatementResultCommand({ Id: statement.Id, NextToken }));
        for (const row of page.Records ?? []) rows.push(Object.fromEntries(row.map((value, i) => [page.ColumnMetadata[i].name, value.isNull ? null : Object.values(value)[0]])));
        NextToken = page.NextToken;
      } while (NextToken);
      results.push({ statementId: statement.Id, rows });
    }
    return { statementId: Id, results };
  } catch (error) {
    await db.send(new CancelStatementCommand({ Id }), { abortSignal: AbortSignal.timeout(1500) }).catch(() => {});
    throw error;
  }
};

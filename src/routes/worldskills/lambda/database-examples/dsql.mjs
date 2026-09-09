import { AuroraDSQLClient } from '@aws/aurora-dsql-node-postgres-connector';
import { randomUUID } from 'node:crypto';

export const handler = async () => {
  const db = new AuroraDSQLClient({
    host: process.env.DSQL_HOST, user: process.env.DSQL_USER || 'admin',
    database: 'postgres', connectionTimeoutMillis: 5000,
  });
  await db.connect();
  const id = randomUUID();
  try {
    await db.query('BEGIN');
    await db.query('INSERT INTO lambda_demo_items (id, name, price) VALUES ($1,$2,$3)', [id, 'Apple', 2.5]);
    const { rows } = await db.query('SELECT * FROM lambda_demo_items WHERE id = $1', [id]);
    await db.query('UPDATE lambda_demo_items SET price = $1 WHERE id = $2', [4, id]);
    await db.query('DELETE FROM lambda_demo_items WHERE id = $1', [id]);
    await db.query('COMMIT');
    return { rows };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
};

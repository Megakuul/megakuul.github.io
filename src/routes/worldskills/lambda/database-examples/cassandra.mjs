import cassandra from 'cassandra-driver';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const handler = async () => {
  const db = new cassandra.Client({
    contactPoints: [process.env.DB_HOST], localDataCenter: process.env.CASSANDRA_DC || process.env.AWS_REGION,
    protocolOptions: { port: Number(process.env.DB_PORT || 9142) },
    authProvider: new cassandra.auth.PlainTextAuthProvider(process.env.DB_USER, process.env.DB_PASSWORD),
    sslOptions: { servername: process.env.DB_HOST, rejectUnauthorized: true, ...(process.env.DB_CA_FILE ? { ca: [readFileSync(process.env.DB_CA_FILE, 'utf8')] } : {}) },
    socketOptions: { connectTimeout: 5000, readTimeout: 10000 },
  });
  await db.connect();
  const id = randomUUID();
  const options = { prepare: true, consistency: cassandra.types.consistencies.localQuorum };
  try {
    const version = await db.execute('SELECT release_version FROM system.local');
    await db.execute('INSERT INTO app.lambda_demo_items (id, name, price) VALUES (?, ?, ?)', [id, 'Apple', 2.5], options);
    const { rows } = await db.execute('SELECT id, name, price FROM app.lambda_demo_items WHERE id = ?', [id], options);
    await db.execute('UPDATE app.lambda_demo_items SET price = ? WHERE id = ?', [4, id], options);
    await db.execute('DELETE FROM app.lambda_demo_items WHERE id = ?', [id], options);
    return { rows, version: version.rows[0].release_version };
  } finally {
    await db.shutdown();
  }
};

import cassandra from 'cassandra-driver';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DB_HOST = 'cassandra.eu-central-1.amazonaws.com';
const DB_PORT = 9142;
const CASSANDRA_DC = 'eu-central-1';
const DB_USER = 'service-specific-username';
const DB_PASSWORD = 'service-specific-password';
const DB_CA_FILE = '/var/task/certs/keyspaces.pem';
// With the driver layer, use /opt/certs/keyspaces.pem.

export const handler = async () => {
  const db = new cassandra.Client({
    contactPoints: [DB_HOST],
    localDataCenter: CASSANDRA_DC,
    protocolOptions: { port: DB_PORT },
    authProvider: new cassandra.auth.PlainTextAuthProvider(DB_USER, DB_PASSWORD),
    sslOptions: {
      servername: DB_HOST,
      rejectUnauthorized: true,
      ca: [readFileSync(DB_CA_FILE, 'utf8')],
    },
    socketOptions: { connectTimeout: 5000, readTimeout: 10000 },
  });
  await db.connect();
  const id = randomUUID();
  const options = { prepare: true, consistency: cassandra.types.consistencies.localQuorum };
  try {
    const version = await db.execute('SELECT release_version FROM system.local');
    await db.execute(
      'INSERT INTO app.lambda_demo_items (id, name, price) VALUES (?, ?, ?)',
      [id, 'Apple', 2.5],
      options,
    );
    const { rows } = await db.execute(
      'SELECT id, name, price FROM app.lambda_demo_items WHERE id = ?',
      [id],
      options,
    );
    await db.execute('UPDATE app.lambda_demo_items SET price = ? WHERE id = ?', [4, id], options);
    await db.execute('DELETE FROM app.lambda_demo_items WHERE id = ?', [id], options);
    return { rows, version: version.rows[0].release_version };
  } finally {
    await db.shutdown();
  }
};

import pg from 'pg';
import { readFileSync } from 'node:fs';

export const handler = async () => {
  const db = new pg.Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: true, ...(process.env.DB_CA_FILE ? { ca: readFileSync(process.env.DB_CA_FILE, 'utf8') } : {}) },
    connectionTimeoutMillis: 5000, statement_timeout: 10000,
  });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('CREATE TEMP TABLE demo_items (id integer PRIMARY KEY, name text, price numeric(10,2)) ON COMMIT DROP');
    await db.query('INSERT INTO demo_items VALUES ($1,$2,$3),($4,$5,$6)', [1, 'Apple', 2.5, 2, 'Pear', 3]);
    await db.query('INSERT INTO demo_items VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price', [1, 'Apple', 4]);
    await db.query('UPDATE demo_items SET name = $1 WHERE id = $2', ['Green apple', 1]);
    const { rows } = await db.query('SELECT * FROM demo_items WHERE price >= $1 ORDER BY id LIMIT $2 OFFSET $3', [2, 10, 0]);
    const { rows: totals } = await db.query('SELECT count(*) AS count, sum(price) AS total FROM demo_items');
    await db.query('SAVEPOINT before_delete');
    await db.query('DELETE FROM demo_items WHERE id = $1', [2]);
    await db.query('ROLLBACK TO SAVEPOINT before_delete');
    await db.query('COMMIT');
    return { rows, totals };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
};

import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

export const handler = async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: true, ...(process.env.DB_CA_FILE ? { ca: readFileSync(process.env.DB_CA_FILE, 'utf8') } : {}) },
    connectTimeout: 5000,
  });
  try {
    await db.query('CREATE TEMPORARY TABLE demo_items (id integer PRIMARY KEY, name varchar(100), price decimal(10,2)) ENGINE=InnoDB');
    await db.beginTransaction();
    await db.execute('INSERT INTO demo_items VALUES (?,?,?),(?,?,?)', [1, 'Apple', 2.5, 2, 'Pear', 3]);
    await db.execute('INSERT INTO demo_items VALUES (?,?,?) ON DUPLICATE KEY UPDATE price = ?', [1, 'Apple', 4, 4]);
    await db.execute('UPDATE demo_items SET name = ? WHERE id = ?', ['Green apple', 1]);
    const [rows] = await db.execute('SELECT * FROM demo_items WHERE price >= ? ORDER BY id LIMIT 10 OFFSET 0', [2]);
    const [totals] = await db.query('SELECT count(*) AS count, sum(price) AS total FROM demo_items');
    await db.query('SAVEPOINT before_delete');
    await db.execute('DELETE FROM demo_items WHERE id = ?', [2]);
    await db.query('ROLLBACK TO SAVEPOINT before_delete');
    await db.commit();
    return { rows, totals };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
};

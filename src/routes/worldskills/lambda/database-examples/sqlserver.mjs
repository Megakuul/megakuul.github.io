import sql from 'mssql';
import { readFileSync } from 'node:fs';

const DB_HOST = 'my-db.abcdefghijkl.eu-central-1.rds.amazonaws.com';
const DB_PORT = 1433;
const DB_NAME = 'app';
const DB_USER = 'app_user';
const DB_PASSWORD = 'replace-me';
const DB_CA_FILE = '/var/task/certs/rds.pem';
// With the driver layer, use /opt/certs/rds.pem.

export const handler = async () => {
  const pool = await new sql.ConnectionPool({
    server: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      cryptoCredentialsDetails: { ca: readFileSync(DB_CA_FILE, 'utf8') },
    },
    connectionTimeout: 5000,
    requestTimeout: 10000,
    pool: { max: 1, min: 0 },
  }).connect();
  const tx = new sql.Transaction(pool);
  let active = false;
  tx.on('rollback', () => {
    active = false;
  });
  try {
    await tx.begin();
    active = true;
    await new sql.Request(tx).batch(
      'CREATE TABLE #demo_items (id int PRIMARY KEY, name nvarchar(100), price decimal(10,2))',
    );
    await new sql.Request(tx)
      .input('id', sql.Int, 1)
      .input('name', sql.NVarChar(100), 'Apple')
      .input('price', sql.Decimal(10, 2), 2.5)
      .query('INSERT INTO #demo_items VALUES (@id,@name,@price)');
    await new sql.Request(tx)
      .input('id', sql.Int, 1)
      .input('price', sql.Decimal(10, 2), 4)
      .query('UPDATE #demo_items SET price = @price WHERE id = @id');
    const { recordset: rows } = await new sql.Request(tx)
      .input('min', sql.Decimal(10, 2), 2)
      .query(
        'SELECT * FROM #demo_items WHERE price >= @min ORDER BY id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY',
      );
    const { recordset: totals } = await new sql.Request(tx).query(
      'SELECT count(*) AS count, sum(price) AS total FROM #demo_items',
    );
    await new sql.Request(tx).query('SAVE TRANSACTION before_delete');
    await new sql.Request(tx)
      .input('id', sql.Int, 1)
      .query('DELETE FROM #demo_items WHERE id = @id');
    await new sql.Request(tx).query('ROLLBACK TRANSACTION before_delete');
    await tx.commit();
    active = false;
    return { rows, totals };
  } catch (error) {
    if (active) await tx.rollback();
    throw error;
  } finally {
    await pool.close();
  }
};

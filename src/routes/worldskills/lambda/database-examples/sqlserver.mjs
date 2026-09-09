import sql from 'mssql';
import { readFileSync } from 'node:fs';

export const handler = async () => {
  const pool = await new sql.ConnectionPool({
    server: process.env.DB_HOST, port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: false, cryptoCredentialsDetails: process.env.DB_CA_FILE ? { ca: readFileSync(process.env.DB_CA_FILE, 'utf8') } : {} },
    connectionTimeout: 5000, requestTimeout: 10000, pool: { max: 1, min: 0 },
  }).connect();
  const tx = new sql.Transaction(pool);
  let active = false;
  tx.on('rollback', () => { active = false; });
  try {
    await tx.begin();
    active = true;
    await new sql.Request(tx).batch('CREATE TABLE #demo_items (id int PRIMARY KEY, name nvarchar(100), price decimal(10,2))');
    await new sql.Request(tx).input('id', sql.Int, 1).input('name', sql.NVarChar(100), 'Apple').input('price', sql.Decimal(10, 2), 2.5).query('INSERT INTO #demo_items VALUES (@id,@name,@price)');
    await new sql.Request(tx).input('id', sql.Int, 1).input('price', sql.Decimal(10, 2), 4).query('UPDATE #demo_items SET price = @price WHERE id = @id');
    const { recordset: rows } = await new sql.Request(tx).input('min', sql.Decimal(10, 2), 2).query('SELECT * FROM #demo_items WHERE price >= @min ORDER BY id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY');
    const { recordset: totals } = await new sql.Request(tx).query('SELECT count(*) AS count, sum(price) AS total FROM #demo_items');
    await new sql.Request(tx).query('SAVE TRANSACTION before_delete');
    await new sql.Request(tx).input('id', sql.Int, 1).query('DELETE FROM #demo_items WHERE id = @id');
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

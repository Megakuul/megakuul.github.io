import oracledb from 'oracledb';

export const handler = async () => {
  const db = await oracledb.getConnection({
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING, sslServerDNMatch: true,
  });
  db.callTimeout = 10000;
  try {
    await db.execute("BEGIN EXECUTE IMMEDIATE 'CREATE GLOBAL TEMPORARY TABLE lambda_demo_items (id NUMBER PRIMARY KEY, name VARCHAR2(100), price NUMBER(10,2)) ON COMMIT DELETE ROWS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;");
    await db.executeMany('INSERT INTO lambda_demo_items VALUES (:id,:name,:price)', [{ id: 1, name: 'Apple', price: 2.5 }, { id: 2, name: 'Pear', price: 3 }]);
    await db.execute('UPDATE lambda_demo_items SET price = :price WHERE id = :id', { price: 4, id: 1 });
    const { rows } = await db.execute('SELECT * FROM lambda_demo_items WHERE price >= :min ORDER BY id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY', { min: 2 }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const { rows: totals } = await db.execute('SELECT count(*) AS count, sum(price) AS total FROM lambda_demo_items', [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    await db.execute('SAVEPOINT before_delete');
    await db.execute('DELETE FROM lambda_demo_items WHERE id = :id', { id: 2 });
    await db.execute('ROLLBACK TO before_delete');
    await db.commit();
    return { rows, totals };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.close();
  }
};

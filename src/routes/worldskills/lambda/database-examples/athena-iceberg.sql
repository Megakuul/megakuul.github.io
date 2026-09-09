-- Athena engine v3 · Glue database + writable S3 location
CREATE TABLE lambda_demo_sales (id bigint, category string, amount double) LOCATION 's3://my-analytics-bucket/iceberg/lambda-demo-sales/' TBLPROPERTIES ('table_type'='ICEBERG');
INSERT INTO lambda_demo_sales VALUES (1, 'fruit', 2.5), (2, 'fruit', 3.0), (3, 'bread', 5.0);
UPDATE lambda_demo_sales SET amount = 4.0 WHERE id = 1;
MERGE INTO lambda_demo_sales t USING (VALUES (1, 'fruit', 4.0), (4, 'bread', 6.0)) s(id, category, amount) ON t.id = s.id WHEN MATCHED THEN UPDATE SET amount = s.amount WHEN NOT MATCHED THEN INSERT (id, category, amount) VALUES (s.id, s.category, s.amount);
SELECT category, sum(amount) AS revenue, avg(amount) AS average FROM lambda_demo_sales GROUP BY category ORDER BY revenue DESC;
SELECT id, amount, dense_rank() OVER (ORDER BY amount DESC) AS rank FROM lambda_demo_sales ORDER BY rank LIMIT 100;
DELETE FROM lambda_demo_sales WHERE id = 2;

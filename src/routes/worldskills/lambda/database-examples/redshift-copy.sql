CREATE TEMP TABLE demo_sales (id integer, category varchar(40), amount decimal(10,2));
COPY demo_sales FROM 's3://my-analytics-bucket/sales/' IAM_ROLE 'arn:aws:iam::111122223333:role/redshift-s3' FORMAT AS PARQUET;
CREATE TEMP TABLE demo_updates (id integer, category varchar(40), amount decimal(10,2));
INSERT INTO demo_updates VALUES (1, 'fruit', 4.00);
MERGE INTO demo_sales USING demo_updates ON demo_sales.id = demo_updates.id WHEN MATCHED THEN UPDATE SET amount = demo_updates.amount WHEN NOT MATCHED THEN INSERT VALUES (demo_updates.id, demo_updates.category, demo_updates.amount);
SELECT category, sum(amount) AS revenue FROM demo_sales GROUP BY category ORDER BY revenue DESC;
UNLOAD ('SELECT category, SUM(amount) AS revenue FROM demo_sales GROUP BY category') TO 's3://my-analytics-bucket/export/run-001/' IAM_ROLE 'arn:aws:iam::111122223333:role/redshift-s3' FORMAT AS PARQUET;
DROP TABLE demo_updates;
DROP TABLE demo_sales;

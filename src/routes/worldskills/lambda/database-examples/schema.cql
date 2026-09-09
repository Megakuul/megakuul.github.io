CREATE KEYSPACE IF NOT EXISTS app WITH replication = {'class': 'SingleRegionStrategy'};
CREATE TABLE IF NOT EXISTS app.lambda_demo_items (id text PRIMARY KEY, name text, price double);

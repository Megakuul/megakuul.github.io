import type { Group } from './lambda.snippets';
import policy from './database-examples/rds-iam-policy.json?raw';
import postgresSetup from './database-examples/postgres-iam.sql?raw';
import mysqlSetup from './database-examples/mysql-iam.sql?raw';
import postgres from './database-examples/postgres-iam.mjs?raw';
import mysql from './database-examples/mysql-iam.mjs?raw';
import postgresPython from './database-examples/postgres-iam.py?raw';
import mysqlPython from './database-examples/mysql-iam.py?raw';

const rdsIam: Group = {
  id: 'rds-iam',
  title: 'RDS / Aurora · IAM authentication',
  blurb:
    'Direct database connections using the Lambda execution role. Enable IAM database authentication on the database, create the database user, and attach the connect policy to the Lambda role. Use the actual RDS endpoint and allow the Lambda security group to reach the database port.',
  snippets: [
    {
      id: 'rds-iam-policy',
      title: 'Lambda role · rds-db:connect',
      note: 'Replace Region, account, resource ID and database username. Use the immutable DbiResourceId (db-…), or DbClusterResourceId (cluster-…) for Aurora, rather than the database name or ARN. For RDS Proxy, use its prx-… resource ID and configure proxy IAM authentication separately.',
      lang: 'json',
      js: policy,
      py: policy,
    },
    {
      id: 'rds-iam-postgres-user',
      title: 'PostgreSQL · database user',
      lang: 'sql',
      js: postgresSetup,
      py: postgresSetup,
    },
    {
      id: 'rds-iam-postgres',
      title: 'PostgreSQL · IAM connection',
      note: 'Edit the variables at the top. JavaScript: pg + @aws-sdk/rds-signer are in the downloadable driver ZIPs. Python: package psycopg[binary] for your Lambda runtime/architecture. Include the RDS CA bundle at DB_CA_FILE. Each invocation signs a fresh token using the Lambda role.',
      js: postgres,
      py: postgresPython,
    },
    {
      id: 'rds-iam-mysql-user',
      title: 'MySQL / MariaDB · database user',
      lang: 'sql',
      js: mysqlSetup,
      py: mysqlSetup,
    },
    {
      id: 'rds-iam-mysql',
      title: 'MySQL / MariaDB · IAM connection',
      note: 'Edit the variables at the top. JavaScript: mysql2 + @aws-sdk/rds-signer are in the downloadable driver ZIPs. Python: package pymysql. Include the RDS CA bundle at DB_CA_FILE. The token is sent only over verified TLS; no database password is required.',
      js: mysql,
      py: mysqlPython,
    },
  ],
};
export default rdsIam;

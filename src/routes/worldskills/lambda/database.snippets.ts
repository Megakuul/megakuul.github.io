import opensearch from './database-examples/opensearch.mjs?raw';
import opensearchServerless from './database-examples/opensearch-serverless.mjs?raw';
import redshift from './database-examples/redshift.mjs?raw';
import athena from './database-examples/athena.mjs?raw';
import redshiftCopy from './database-examples/redshift-copy.sql?raw';
import athenaIceberg from './database-examples/athena-iceberg.sql?raw';
import analyticsEnvironment from './database-examples/analytics-environment.json?raw';
import analyticsInvoke from './database-examples/analytics-invoke.sh?raw';
import type { Group } from './lambda.snippets';
import deploy from './database-examples/deploy.sh?raw';
import environment from './database-examples/environment.json?raw';
import postgres from './database-examples/postgres.mjs?raw';
import mysql from './database-examples/mysql.mjs?raw';
import sqlserver from './database-examples/sqlserver.mjs?raw';
import oracle from './database-examples/oracle.mjs?raw';
import mongodb from './database-examples/mongodb.mjs?raw';
import redis from './database-examples/redis.mjs?raw';
import cassandra from './database-examples/cassandra.mjs?raw';
import memcached from './database-examples/memcached.mjs?raw';
import dsql from './database-examples/dsql.mjs?raw';
import dsqlSchema from './database-examples/schema.sql?raw';
import cassandraSchema from './database-examples/schema.cql?raw';

const drivers: Group = {
  id: 'database-drivers',
  title: 'Database drivers',
  blurb: '',
  nodeOnly: true,
  downloads: [
    {
      title: 'Test Lambda ZIP · drivers + handler',
      href: '/downloads/nodejs-databases-function.zip',
    },
    { title: 'Layer ZIP · drivers for your Lambda', href: '/downloads/nodejs-databases-layer.zip' },
  ],
  snippets: [
    { id: 'drivers-deploy', title: 'Deploy', js: deploy, py: '', lang: 'bash' },
    { id: 'drivers-env', title: 'environment.json', js: environment, py: '', lang: 'json' },
    {
      id: 'drivers-config',
      title: 'Configure / invoke',
      lang: 'bash',
      py: '',
      js: `aws lambda update-function-configuration --function-name db-demo --environment file://environment.json
aws lambda wait function-updated-v2 --function-name db-demo
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"postgres"}' result.json`,
    },
    { id: 'drivers-pg', title: 'RDS PostgreSQL / Aurora · pg', js: postgres, py: '' },
    { id: 'drivers-mysql', title: 'RDS MySQL / MariaDB / Aurora · mysql2', js: mysql, py: '' },
    { id: 'drivers-mssql', title: 'RDS SQL Server · mssql', js: sqlserver, py: '' },
    { id: 'drivers-oracle', title: 'RDS Oracle · oracledb Thin', js: oracle, py: '' },
    { id: 'drivers-mongodb', title: 'Amazon DocumentDB · mongodb', js: mongodb, py: '' },
    { id: 'drivers-redis', title: 'ElastiCache / MemoryDB · redis', js: redis, py: '' },
    {
      id: 'drivers-cassandra-schema',
      title: 'Keyspaces · schema.cql',
      js: cassandraSchema,
      py: '',
      lang: 'sql',
    },
    {
      id: 'drivers-cassandra',
      title: 'Amazon Keyspaces · cassandra-driver',
      js: cassandra,
      py: '',
    },
    {
      id: 'drivers-memcached',
      title: 'ElastiCache Memcached · memcache-client',
      js: memcached,
      py: '',
    },
    {
      id: 'drivers-dsql-schema',
      title: 'Aurora DSQL · schema.sql',
      js: dsqlSchema,
      py: '',
      lang: 'sql',
    },
    { id: 'drivers-dsql', title: 'Aurora DSQL · pg + IAM connector', js: dsql, py: '' },
    {
      id: 'drivers-analytics-env',
      title: 'analytics-environment.json',
      js: analyticsEnvironment,
      py: '',
      lang: 'json',
    },
    {
      id: 'drivers-analytics-invoke',
      title: 'Analytics · configure / invoke',
      js: analyticsInvoke,
      py: '',
      lang: 'bash',
    },
    { id: 'drivers-redshift', title: 'Redshift / Serverless · Data API', js: redshift, py: '' },
    {
      id: 'drivers-redshift-copy',
      title: 'Redshift · COPY / MERGE / UNLOAD',
      js: redshiftCopy,
      py: '',
      lang: 'sql',
    },
    { id: 'drivers-athena', title: 'Athena · SQL / paging / scan statistics', js: athena, py: '' },
    {
      id: 'drivers-athena-iceberg',
      title: 'Athena · Iceberg writes',
      js: athenaIceberg,
      py: '',
      lang: 'sql',
    },
    {
      id: 'drivers-opensearch',
      title: 'Amazon OpenSearch Service · CRUD / search / aggregates',
      js: opensearch,
      py: '',
    },
    {
      id: 'drivers-opensearch-serverless',
      title: 'Amazon OpenSearch Serverless · search / aggregates',
      js: opensearchServerless,
      py: '',
    },
  ],
};
export default drivers;

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const manifest = require('./manifest.json');
const examples = {
  opensearch: () => import('./examples/opensearch.mjs'),
  'opensearch-serverless': () => import('./examples/opensearch-serverless.mjs'),
  redshift: () => import('./examples/redshift.mjs'),
  athena: () => import('./examples/athena.mjs'),
  postgres: () => import('./examples/postgres.mjs'),
  mysql: () => import('./examples/mysql.mjs'),
  sqlserver: () => import('./examples/sqlserver.mjs'),
  oracle: () => import('./examples/oracle.mjs'),
  mongodb: () => import('./examples/mongodb.mjs'),
  redis: () => import('./examples/redis.mjs'),
  cassandra: () => import('./examples/cassandra.mjs'),
  memcached: () => import('./examples/memcached.mjs'),
  dsql: () => import('./examples/dsql.mjs'),
};

export const handler = async (event = {}, context) => {
  if (!event.database) {
    for (const name of Object.keys(manifest.dependencies)) await import(name);
    return { node: process.version, architecture: process.arch, drivers: manifest.dependencies };
  }
  if (!Object.hasOwn(examples, event.database))
    throw new Error('Unknown database: ' + event.database);
  return (await examples[event.database]()).handler(event, context);
};

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const require = createRequire(import.meta.url);
const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
let client;

export const handler = async () => {
  client ??= new Client({
    ...AwsSigv4Signer({ region: process.env.AWS_REGION, service: 'es', getCredentials: fromNodeProviderChain() }),
    node: process.env.OPENSEARCH_URL, requestTimeout: 10000, maxRetries: 0,
  });
  const index = 'lambda-demo-' + randomUUID();
  let created = false;
  try {
    await client.indices.create({ index, body: { mappings: { properties: {
      name: { type: 'text' }, category: { type: 'keyword' }, amount: { type: 'double' },
    } } } });
    created = true;
    const { body: bulk } = await client.bulk({ index, refresh: 'wait_for', body: [
      { index: { _id: '1' } }, { name: 'Green apple', category: 'fruit', amount: 2.5 },
      { index: { _id: '2' } }, { name: 'Pear', category: 'fruit', amount: 3 },
      { index: { _id: '3' } }, { name: 'Bread', category: 'bakery', amount: 5 },
    ] });
    if (bulk.errors) throw new Error(JSON.stringify(bulk.items.filter(item => Object.values(item)[0].error)));
    const { body: item } = await client.get({ index, id: '1' });
    await client.update({ index, id: '1', body: { doc: { amount: 4 } }, refresh: 'wait_for' });
    const { body: search } = await client.search({ index, body: {
      size: 10, query: { bool: { must: [{ match: { name: 'apple' } }], filter: [{ range: { amount: { gte: 2 } } }] } },
      sort: [{ amount: 'desc' }],
    } });
    const { body: analytics } = await client.search({ index, body: {
      size: 0, aggs: { categories: { terms: { field: 'category', size: 20 }, aggs: {
        revenue: { sum: { field: 'amount' } }, average: { avg: { field: 'amount' } }, p95: { percentiles: { field: 'amount', percents: [95] } },
      } } },
    } });
    await client.delete({ index, id: '2', refresh: 'wait_for' });
    return { item: item._source, hits: search.hits.hits, aggregations: analytics.aggregations };
  } finally {
    if (created) await client.indices.delete({ index });
  }
};

import { createRequire } from 'node:module';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const require = createRequire(import.meta.url);
const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
let client;

export const handler = async (event = {}) => {
  client ??= new Client({
    ...AwsSigv4Signer({ region: process.env.AWS_REGION, service: 'aoss', getCredentials: fromNodeProviderChain() }),
    node: process.env.OPENSEARCH_SERVERLESS_URL, requestTimeout: 10000, maxRetries: 0,
  });
  const { body } = await client.search({ index: process.env.OPENSEARCH_INDEX, body: {
    size: 25,
    query: event.search ? { simple_query_string: { query: String(event.search), fields: ['name'] } } : { match_all: {} },
    aggs: { categories: { terms: { field: 'category', size: 20 }, aggs: { revenue: { sum: { field: 'amount' } } } } },
  } });
  return { hits: body.hits.hits, total: body.hits.total, aggregations: body.aggregations };
};

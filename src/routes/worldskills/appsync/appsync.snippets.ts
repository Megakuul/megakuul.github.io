import file0 from './snippets/create.js.txt?raw';
import file1 from './snippets/delete.js.txt?raw';
import file2 from './snippets/deny.js.txt?raw';
import file3 from './snippets/early-return.js.txt?raw';
import file4 from './snippets/eventbridge.js.txt?raw';
import file5 from './snippets/get.js.txt?raw';
import file6 from './snippets/groups.js.txt?raw';
import file7 from './snippets/http.js.txt?raw';
import file8 from './snippets/identity.js.txt?raw';
import file9 from './snippets/lambda.js.txt?raw';
import file10 from './snippets/opensearch.js.txt?raw';
import file11 from './snippets/opensearch.json?raw';
import file12 from './snippets/pipeline-format.js.txt?raw';
import file13 from './snippets/pipeline-get.js.txt?raw';
import file14 from './snippets/pipeline.js.txt?raw';
import file15 from './snippets/query.js.txt?raw';
import file16 from './snippets/rds-get.js.txt?raw';
import file17 from './snippets/rds-put.js.txt?raw';
import file18 from './snippets/rds.sql?raw';
import file19 from './snippets/schema.graphql?raw';
import file20 from './snippets/sqs.js.txt?raw';
import file21 from './snippets/update.js.txt?raw';

const files: Record<string, string> = {
  'create.js.txt': file0,
  'delete.js.txt': file1,
  'deny.js.txt': file2,
  'early-return.js.txt': file3,
  'eventbridge.js.txt': file4,
  'get.js.txt': file5,
  'groups.js.txt': file6,
  'http.js.txt': file7,
  'identity.js.txt': file8,
  'lambda.js.txt': file9,
  'opensearch.js.txt': file10,
  'opensearch.json': file11,
  'pipeline-format.js.txt': file12,
  'pipeline-get.js.txt': file13,
  'pipeline.js.txt': file14,
  'query.js.txt': file15,
  'rds-get.js.txt': file16,
  'rds-put.js.txt': file17,
  'rds.sql': file18,
  'schema.graphql': file19,
  'sqs.js.txt': file20,
  'update.js.txt': file21,
};

export interface Block {
  title: string;
  lang: string;
  code: string;
}
interface BlockSource {
  title: string;
  file?: string;
  lang?: string;
  code?: string;
}
interface SnippetSource {
  id: string;
  title: string;
  note?: string;
  reference: string;
  blocks: BlockSource[];
  extra: BlockSource[];
}
interface GroupSource {
  id: string;
  title: string;
  note?: string;
  snippets: SnippetSource[];
}
function resolve(block: BlockSource): Block {
  const extension = block.file?.replace('.txt', '').split('.').pop();
  return {
    title: block.title,
    lang: block.lang ?? (extension === 'js' ? 'javascript' : extension!),
    code: block.file ? files[block.file] : block.code!,
  };
}

const sources: GroupSource[] = [
  {
    id: 'setup',
    title: 'Setup',
    snippets: [
      {
        id: 'schema',
        title: 'Schema',
        note: 'GraphQL API \u00b7 default auth: Cognito user pool \u00b7 APPSYNC_JS 1.0.0. Paste each JavaScript block into its own resolver or function. Create and bind the indicated data sources; allow their service roles to access the selected resources.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-overview-js.html',
        blocks: [
          {
            title: 'GraphQL',
            file: 'schema.graphql',
          },
        ],
        extra: [],
      },
    ],
  },
  {
    id: 'authorization',
    title: 'Authorization',
    snippets: [
      {
        id: 'deny',
        title: 'Reject',
        note: 'UNIT \u00b7 Query.denied \u00b7 NONE',
        reference: 'https://docs.aws.amazon.com/appsync/latest/devguide/built-in-util-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'deny.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { denied }',
          },
        ],
      },
      {
        id: 'identity',
        title: 'Identity',
        note: 'UNIT \u00b7 Query.identity \u00b7 NONE',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-context-reference-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'identity.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { identity }',
          },
        ],
      },
      {
        id: 'groups',
        title: 'Groups',
        note: 'UNIT \u00b7 Query.admin \u00b7 NONE. Cognito group: Admins.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-context-reference-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'groups.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { admin }',
          },
        ],
      },
    ],
  },
  {
    id: 'dynamodb',
    title: 'DynamoDB',
    note: 'One table: pk (String HASH), sk (String RANGE). Keys use the verified Cognito sub. Service role: GetItem, Query, PutItem, UpdateItem, DeleteItem on this table.',
    snippets: [
      {
        id: 'get',
        title: 'Get',
        note: 'UNIT \u00b7 Query.getItem \u00b7 DynamoDB',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/js-aws-appsync-resolver-reference-dynamodb-getitem.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'get.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { getItem(id: "ITEM_ID") { id owner title version } }',
          },
        ],
      },
      {
        id: 'query',
        title: 'Query',
        note: 'UNIT \u00b7 Query.listItems \u00b7 DynamoDB. Pass nextToken unchanged to read the next page.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/js-aws-appsync-resolver-reference-dynamodb-query.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'query.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { listItems(limit: 20) { items { id owner title version } nextToken } }',
          },
        ],
      },
      {
        id: 'create',
        title: 'Create',
        note: 'UNIT \u00b7 Mutation.createItem \u00b7 DynamoDB',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/js-aws-appsync-resolver-reference-dynamodb-putitem.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'create.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'mutation { createItem(title: "First item") { id owner title version } }',
          },
        ],
      },
      {
        id: 'update',
        title: 'Update',
        note: 'UNIT \u00b7 Mutation.updateItem \u00b7 DynamoDB. Stale version \u2192 ConditionalCheckFailedException.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/js-aws-appsync-resolver-reference-dynamodb-updateitem.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'update.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'mutation { updateItem(id: "ITEM_ID", title: "Changed", version: 1) { id title version } }',
          },
        ],
      },
      {
        id: 'delete',
        title: 'Delete',
        note: 'UNIT \u00b7 Mutation.deleteItem \u00b7 DynamoDB. Owner and version checked in the write.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/js-aws-appsync-resolver-reference-dynamodb-deleteitem.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'delete.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'mutation { deleteItem(id: "ITEM_ID", version: 2) { id title version } }',
          },
        ],
      },
    ],
  },
  {
    id: 'flow',
    title: 'Flow',
    snippets: [
      {
        id: 'pipeline',
        title: 'Pipeline',
        note: 'Query.pipelineItem \u00b7 PIPELINE. Add functions in order: GetItem (DynamoDB) \u2192 FormatItem (NONE).',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-overview-js.html',
        blocks: [
          {
            title: 'Resolver',
            file: 'pipeline.js.txt',
          },
          {
            title: '1 \u00b7 GetItem',
            file: 'pipeline-get.js.txt',
          },
          {
            title: '2 \u00b7 FormatItem',
            file: 'pipeline-format.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { pipelineItem(id: "ITEM_ID") { item { id owner title version } label } }',
          },
        ],
      },
      {
        id: 'early-return',
        title: 'Early return',
        note: 'UNIT \u00b7 Query.preview \u00b7 NONE. Empty query skips the data source and response handler.',
        reference: 'https://docs.aws.amazon.com/appsync/latest/devguide/runtime-utils-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'early-return.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { preview(query: "") { id title version } }',
          },
        ],
      },
    ],
  },
  {
    id: 'sources',
    title: 'Sources',
    snippets: [
      {
        id: 'lambda',
        title: 'Lambda',
        note: 'UNIT \u00b7 Mutation.invoke \u00b7 Lambda. Service role: lambda:InvokeFunction on the target. Return a JSON value from the function.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-lambda-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'lambda.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'mutation { invoke(input: "{\\"text\\":\\"hello\\"}") }',
          },
        ],
      },
      {
        id: 'http',
        title: 'HTTP',
        note: 'UNIT \u00b7 Mutation.postHttp \u00b7 HTTP. Set the data source endpoint to your HTTPS API; POST /items accepts JSON.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-http-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'http.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'mutation { postHttp(input: "{\\"text\\":\\"hello\\"}") }',
          },
        ],
      },
      {
        id: 'rds-get',
        title: 'RDS read',
        note: 'UNIT \u00b7 Query.rdsItem \u00b7 RDS. Aurora PostgreSQL with Data API enabled, database name and Secrets Manager credentials.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-rds-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'rds-get.js.txt',
          },
        ],
        extra: [
          {
            title: 'Table \u00b7 run once in PostgreSQL',
            file: 'rds.sql',
          },
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { rdsItem(id: "item-1") { id owner title version } }',
          },
        ],
      },
      {
        id: 'rds-put',
        title: 'RDS write',
        note: 'UNIT \u00b7 Mutation.putRdsItem \u00b7 Same RDS source and table. Values are bound SQL parameters.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-rds-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'rds-put.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'mutation { putRdsItem(id: "item-1", title: "First item") { id owner title version } }',
          },
        ],
      },
      {
        id: 'eventbridge',
        title: 'EventBridge',
        note: 'UNIT \u00b7 Mutation.publish \u00b7 EventBridge. Select an existing bus; service role: events:PutEvents on that bus.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-eventbridge-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'eventbridge.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'mutation { publish(input: "{\\"text\\":\\"hello\\"}") }',
          },
        ],
      },
      {
        id: 'opensearch',
        title: 'OpenSearch',
        note: 'UNIT \u00b7 Query.searchItems \u00b7 OpenSearch. Create and populate items; owner must be keyword. Service role: es:ESHttpGet on domain/DOMAIN/items/_search; allow the role in domain access controls.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-elasticsearch-js.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'opensearch.js.txt',
          },
        ],
        extra: [
          {
            title: 'PUT /items \u00b7 index mapping',
            file: 'opensearch.json',
          },
          {
            title: 'Query',
            lang: 'graphql',
            code: 'query { searchItems(query: "First") { id owner title version } }',
          },
        ],
      },
      {
        id: 'sqs',
        title: 'SQS',
        note: 'UNIT \u00b7 Mutation.enqueue \u00b7 HTTP. Endpoint: https://sqs.eu-central-1.amazonaws.com. AWS_IAM signing: region eu-central-1, service sqs. Service role: sqs:SendMessage on the queue. Replace QueueUrl; standard queue.',
        reference:
          'https://docs.aws.amazon.com/appsync/latest/devguide/tutorial-http-resolvers.html',
        blocks: [
          {
            title: 'JavaScript',
            file: 'sqs.js.txt',
          },
        ],
        extra: [
          {
            title: 'Query',
            lang: 'graphql',
            code: 'mutation { enqueue(input: "{\\"text\\":\\"hello\\"}") }',
          },
        ],
      },
    ],
  },
];

export const groups = sources.map(group => ({
  ...group,
  snippets: group.snippets.map(snippet => ({
    ...snippet,
    blocks: snippet.blocks.map(resolve),
    extra: snippet.extra.map(resolve),
  })),
}));

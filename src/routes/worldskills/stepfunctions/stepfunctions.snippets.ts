import select from './snippets/select.json?raw';
import merge from './snippets/merge.json?raw';
import replace from './snippets/replace.json?raw';
import discard from './snippets/discard.json?raw';
import original from './snippets/original.json?raw';
import strings from './snippets/strings.json?raw';
import defaults from './snippets/defaults.json?raw';
import jsonpath_variable from './snippets/jsonpath-variable.json?raw';
import assign from './snippets/assign.json?raw';
import evaluation from './snippets/evaluation.json?raw';
import scope from './snippets/scope.json?raw';
import transform from './snippets/transform.json?raw';
import map from './snippets/map.json?raw';
import parallel from './snippets/parallel.json?raw';
import catchError from './snippets/catch.json?raw';
import loop from './snippets/loop.json?raw';
import lambda from './snippets/lambda.json?raw';
import lambda_jsonata from './snippets/lambda-jsonata.json?raw';
import rds from './snippets/rds.json?raw';
import callback from './snippets/callback.json?raw';
import nested from './snippets/nested.json?raw';
import codebuild from './snippets/codebuild.json?raw';

export interface Example {
  title: string;
  input: unknown;
  output: unknown;
}
export interface Snippet {
  id: string;
  title: string;
  reference: string;
  code: string;
  note?: string;
  extra?: { title: string; value: unknown }[];
  examples: Example[];
}
export interface Group {
  id: string;
  title: string;
  note?: string;
  snippets: Snippet[];
}

export const groups: Group[] = [
  {
    id: 'jsonpath',
    title: 'JSONPath',
    snippets: [
      {
        id: 'select',
        title: 'Select',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/input-output-inputpath-params.html',
        code: select,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
                quantity: 2,
              },
              debug: true,
            },
            output: {
              received: {
                id: 'o-1',
                quantity: 2,
                literal: '$.id',
              },
            },
          },
        ],
      },
      {
        id: 'merge',
        title: 'Merge',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html',
        code: merge,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
              },
            },
            output: {
              orderId: 'o-1',
              status: 'READY',
            },
          },
        ],
      },
      {
        id: 'replace',
        title: 'Replace',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html',
        code: replace,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
              },
            },
            output: {
              received: {
                status: 'READY',
              },
            },
          },
        ],
        note: 'Omitted ResultPath defaults to "$": the result replaces the input.',
      },
      {
        id: 'discard',
        title: 'Discard',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html',
        code: discard,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
              },
            },
            output: {
              received: {
                order: {
                  id: 'o-1',
                },
              },
            },
          },
        ],
      },
      {
        id: 'original',
        title: 'Original input',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/input-output-contextobject.html',
        code: original,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
              },
              customer: 'c-1',
            },
            output: {
              current: {
                id: 'o-1',
              },
              original: {
                order: {
                  id: 'o-1',
                },
                customer: 'c-1',
              },
            },
          },
        ],
      },
      {
        id: 'strings',
        title: 'JSON strings',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/intrinsic-functions.html',
        code: strings,
        examples: [
          {
            title: 'Example',
            input: {
              body: '{"order":{"id":"o-1"}}',
              record: {
                accepted: true,
              },
            },
            output: {
              orderId: 'o-1',
              body: '{"accepted":true}',
            },
          },
        ],
      },
      {
        id: 'defaults',
        title: 'Missing fields',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html',
        code: defaults,
        examples: [
          {
            title: 'Missing',
            input: {},
            output: {
              priority: 'normal',
            },
          },
          {
            title: 'Null',
            input: {
              priority: null,
            },
            output: {
              priority: 'normal',
            },
          },
          {
            title: 'Present',
            input: {
              priority: 'urgent',
            },
            output: {
              priority: 'urgent',
            },
          },
        ],
      },
    ],
    note: 'InputPath \u2192 Parameters \u2192 ResultSelector \u2192 ResultPath \u2192 OutputPath',
  },
  {
    id: 'variables',
    title: 'Variables',
    snippets: [
      {
        id: 'jsonpath-variable',
        title: 'JSONPath variable',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html',
        code: jsonpath_variable,
        examples: [
          {
            title: 'Example',
            input: {
              customer: {
                id: 'c-1',
              },
            },
            output: {
              saved: {
                id: 'c-1',
              },
              current: {
                status: 'READY',
              },
            },
          },
        ],
      },
      {
        id: 'assign',
        title: 'Assign',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html',
        code: assign,
        examples: [
          {
            title: 'Example',
            input: {
              customer: {
                id: 'c-1',
              },
            },
            output: {
              saved: {
                id: 'c-1',
              },
              current: {},
            },
          },
        ],
      },
      {
        id: 'evaluation',
        title: 'Evaluation order',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html',
        code: evaluation,
        examples: [
          {
            title: 'Example',
            input: {},
            output: {
              count: 2,
              previous: 1,
              seen: 1,
            },
          },
        ],
        note: 'Assign and Output run independently. New variable values are available in the next state.',
      },
      {
        id: 'scope',
        title: 'Map scope',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/workflow-variables.html',
        code: scope,
        examples: [
          {
            title: 'Example',
            input: {
              customerId: 'c-1',
              items: [
                {
                  price: 5,
                  quantity: 2,
                },
                {
                  price: 3,
                  quantity: 4,
                },
              ],
            },
            output: {
              lines: [
                {
                  customerId: 'c-1',
                  total: 10,
                },
                {
                  customerId: 'c-1',
                  total: 12,
                },
              ],
              customerId: 'c-1',
            },
          },
        ],
        note: 'Inline Map reads outer variables; inner variables leave through Output. Distributed Map cannot read outer variables.',
      },
    ],
  },
  {
    id: 'jsonata',
    title: 'JSONata',
    snippets: [
      {
        id: 'transform',
        title: 'Transform',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html',
        code: transform,
        examples: [
          {
            title: 'Items',
            input: {
              id: 'o-1',
              items: [
                {
                  price: 5,
                  quantity: 2,
                },
                {
                  price: 3,
                  quantity: 4,
                },
              ],
            },
            output: {
              orderId: 'o-1',
              total: 22,
              priority: 'normal',
            },
          },
          {
            title: 'Empty',
            input: {
              id: 'o-2',
              items: [],
              priority: null,
            },
            output: {
              orderId: 'o-2',
              total: 0,
              priority: 'normal',
            },
          },
          {
            title: 'Priority',
            input: {
              id: 'o-3',
              items: [],
              priority: 'urgent',
            },
            output: {
              orderId: 'o-3',
              total: 0,
              priority: 'urgent',
            },
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
        id: 'map',
        title: 'Map',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/input-output-itemselector.html',
        code: map,
        examples: [
          {
            title: 'Example',
            input: {
              orderId: 'o-1',
              items: [
                {
                  sku: 'a',
                },
                {
                  sku: 'b',
                },
              ],
            },
            output: {
              orderId: 'o-1',
              lines: [
                {
                  orderId: 'o-1',
                  index: 0,
                  sku: 'a',
                },
                {
                  orderId: 'o-1',
                  index: 1,
                  sku: 'b',
                },
              ],
            },
          },
        ],
      },
      {
        id: 'parallel',
        title: 'Parallel',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html',
        code: parallel,
        examples: [
          {
            title: 'Example',
            input: {
              orderId: 'o-1',
              sku: 'a',
            },
            output: {
              orderId: 'o-1',
              available: true,
              amount: 42,
            },
          },
        ],
      },
      {
        id: 'catch',
        title: 'Catch',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html',
        code: catchError,
        examples: [
          {
            title: 'Example',
            input: {
              orderId: 'o-1',
            },
            output: {
              orderId: 'o-1',
              error: 'OutOfStock',
              cause: 'No stock available',
            },
          },
        ],
      },
      {
        id: 'loop',
        title: 'Wait loop',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html',
        code: loop,
        examples: [
          {
            title: 'Example',
            input: {
              orderId: 'o-1',
            },
            output: {
              orderId: 'o-1',
              poll: {
                attempt: 3,
              },
            },
          },
        ],
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks',
    snippets: [
      {
        id: 'lambda',
        title: 'Lambda',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/input-output-example.html',
        code: lambda,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
                quantity: 2,
              },
              debug: true,
            },
            output: {
              orderId: 'o-1',
              quantity: 2,
              total: 42,
            },
          },
        ],
        note: 'ResultPath merges into the original state input, before InputPath filtering. OutputPath then selects the merged output.',
        extra: [
          {
            title: 'Lambda return',
            value: {
              total: 42,
            },
          },
        ],
      },
      {
        id: 'lambda-jsonata',
        title: 'Lambda JSONata',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html',
        code: lambda_jsonata,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
              },
            },
            output: {
              orderId: 'o-1',
              total: 42,
              current: {
                order: {
                  id: 'o-1',
                },
                receipt: {
                  total: 42,
                },
              },
            },
          },
        ],
        extra: [
          {
            title: 'Lambda return',
            value: {
              total: 42,
            },
          },
        ],
      },
      {
        id: 'rds',
        title: 'RDS',
        reference: 'https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html',
        code: rds,
        note: 'Aurora PostgreSQL with Data API enabled, an existing database and a credentials secret. Creates the table; repeated order IDs update the row. For RDS without Data API, use a Lambda database client. Attach the IAM policy below; add kms:Decrypt on the key if the secret uses a customer managed key.',
        examples: [
          {
            title: 'Example',
            input: {
              order: { id: 'o-1', totalCents: 4200, currency: 'CHF' },
            },
            output: { orderId: 'o-1', rowsWritten: 1 },
          },
        ],
        extra: [
          {
            title: 'Execution role · IAM policy',
            value: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: 'rds-data:ExecuteStatement',
                  Resource: 'arn:aws:rds:eu-central-1:111122223333:cluster:worldskills',
                },
                {
                  Effect: 'Allow',
                  Action: 'secretsmanager:GetSecretValue',
                  Resource:
                    'arn:aws:secretsmanager:eu-central-1:111122223333:secret:worldskills-db-AbCdEf',
                },
              ],
            },
          },
          {
            title: 'Write result',
            value: { NumberOfRecordsUpdated: 1 },
          },
        ],
      },
      {
        id: 'callback',
        title: 'Callback',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html#connect-wait-token',
        code: callback,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
              },
            },
            output: {
              orderId: 'o-1',
              approved: true,
            },
          },
        ],
        note: 'Standard workflow. The worker calls SendTaskSuccess with the SQS token and a JSON-encoded output. ResultPath receives that output, not the SQS response.',
        extra: [
          {
            title: 'SendTaskSuccess \u00b7 API request',
            value: {
              taskToken: 'TOKEN_FROM_SQS',
              output: '{"approved":true}',
            },
          },
          {
            title: 'SendTaskFailure \u00b7 API request',
            value: {
              taskToken: 'TOKEN_FROM_SQS',
              error: 'Rejected',
              cause: 'Approval denied',
            },
          },
        ],
      },
      {
        id: 'nested',
        title: 'Nested',
        reference:
          'https://docs.aws.amazon.com/step-functions/latest/dg/connect-stepfunctions.html',
        code: nested,
        examples: [
          {
            title: 'Example',
            input: {
              order: {
                id: 'o-1',
              },
            },
            output: {
              orderId: 'o-1',
              total: 42,
            },
          },
        ],
        note: 'Standard parent and child. .sync:2 returns Output as JSON; .sync returns a JSON string.',
        extra: [
          {
            title: 'Child output',
            value: {
              total: 42,
            },
          },
        ],
      },
      {
        id: 'codebuild',
        title: 'CodeBuild',
        reference: 'https://docs.aws.amazon.com/step-functions/latest/dg/connect-codebuild.html',
        code: codebuild,
        examples: [
          {
            title: 'Example',
            input: {
              orderId: 'o-1',
            },
            output: {
              orderId: 'o-1',
              status: 'SUCCEEDED',
            },
          },
        ],
        note: 'Standard workflow. Continues after the build succeeds.',
      },
    ],
    note: 'Replace example ARNs and URLs; grant the state machine role access to those resources.',
  },
];

import { withLocalLogs } from './local-logs.mjs';

function decode(record) {
  if ((record.eventSource ?? record.EventSource) === 'aws:sqs') {
    const text = record.body;
    try {
      return { source: 'sqs', id: record.messageId, value: JSON.parse(text), raw: text };
    } catch {
      return { source: 'sqs', id: record.messageId, value: text, raw: text };
    }
  }

  if ((record.eventSource ?? record.EventSource) === 'aws:kinesis') {
    const text = Buffer.from(record.kinesis.data, 'base64').toString();
    try {
      return {
        source: 'kinesis',
        id: record.kinesis.sequenceNumber,
        value: JSON.parse(text),
        raw: text,
      };
    } catch {
      return { source: 'kinesis', id: record.kinesis.sequenceNumber, value: text, raw: text };
    }
  }

  throw new Error('Only SQS and Kinesis records are supported by this analyzer');
}

async function analyze(dataset) {
  // Handler code here.
  console.log(
    'DATASET_ANALYSIS ' +
      JSON.stringify({
        source: dataset.source,
        id: dataset.id,
        topLevelType: Array.isArray(dataset.value) ? 'array' : typeof dataset.value,
        keys: dataset.value && typeof dataset.value === 'object' ? Object.keys(dataset.value) : [],
        bytes: Buffer.byteLength(dataset.raw),
      }),
  );
}

export const handler = withLocalLogs(async (event, context) => {
  const { diagnostic } = await import('./diagnostic.mjs');
  const diagnosticResponse = await diagnostic(event, context);
  if (diagnosticResponse) return diagnosticResponse;

  const batchItemFailures = [];
  for (const record of event.Records ?? []) {
    try {
      await analyze(decode(record));
    } catch (error) {
      console.error('Dataset failed:', error);
      batchItemFailures.push({
        itemIdentifier: record.messageId ?? record.kinesis?.sequenceNumber,
      });
    }
  }

  return { batchItemFailures };
});

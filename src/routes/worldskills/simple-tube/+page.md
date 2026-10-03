<script>
    import Quirk from "../Quirk.svelte";
    import Note from "../Note.svelte";
</script>

## SQS Queues

- Duplicated id takes precedence over deduplication content 
    -> content deduplicate is ONLY used if NO dedupe id is set, otherwise the dedupe id is the only information considered.

- SNS FIFO has sender deduplication (content or message deduplication id)
    -> recommended to use
- SQS FIFO has receiver deduplication (content or message deduplication id)
    -> dont use this in general it makes it very complex + with event structure the message dedupe fails because of a aws inserted timestamp
    -> + makes no sense anyways because messages that CAN be deduplicated are already deduped by SNS (implements the exact same message dedupe id > message content dedupe logic as SQS FIFO queues)


Always use SNS raw otherwise content deduplication does nto work in sqs


sending to a fifo sqs is obviously using the right order, standard sqs weirdly reorders on every receive (there are fair queues to do it fair though)


filter policy per subscription use weird formats of aws very basically you can just apply OR filters like this `"mykey": ["somepossiblevalue", "anotherpossiblevalue"]`. For further examples see https://docs.aws.amazon.com/sns/latest/dg/example-filter-policies.html

here some more good operations that can be done with those wild filter policies: https://oneuptime.com/blog/post/2026-01-30-aws-sns-message-filtering/view

And no array validation does not work



sns filter policy validation is not considered redrive dlq error



- delivery delay just hides new messages (this makes them still viable target of deduplication though)


dlq redrive on the ui back to original queue

dlq receive 3 times without success


best practice lambda workflow:

- sqs calls lambda and auto receives the message (no code required for lambda (however it requires receivemessage and deletemessage and getqueueAttributes))
- lambda returns success -> message auto deleted
- lambda throws error -> message just staying in queue until visi timout runs out (best practice align visi timout with lambda exec timeout)
- if receiveCount is above the dlq count, the message is moved to dlq, otherwise its deleted after its retention date.



- ALARM: requires kms:Decrypt if custom kms key

- Batching uses multiple parallel processors (in fifo per queue partitioned) testing on low volume often does not trigger records to be batched.

## Watch Out 👀

- The consoles receiver does also remove the message from the queue for visibility timeout...
- Receive count in the dashboard is how many times it has been received from sqs not how many times sns sent it...
- Multiple lambda triggers cause potentially unfair stealing 
- Lambda trigger tags for sqs can only be set when configured from lambda side

## Quirks

![fifo_queue_ui_quirk](/images/fifo_queue_ui_quirk.png)


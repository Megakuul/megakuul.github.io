<script>
    import Quirk from "../Quirk.svelte";
    import Note from "../Note.svelte";
</script>

## Watch Out 👀

- tags in rules are hidden in wizard
- schedules have no tags, create a custom schedule group (wtf is this api design btw)

<Note type="protip">
    <b>Protip:</b> Enable cloudwatch logging on the eventbus, this allows debugging invocation failures!
</Note>

## Quirks

- The AWS input transformer UI in eventbridge does NOT apply predefined aws variables like `<aws.events.event.ingestion-time>` as defined [here](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html)

<Quirk score={8.5}>
    Stand down, the variables will be applied when sending real events, they are just not expanded in the console UI.
</Quirk>

- When configuring lambda triggers the UI rejects execution roles that restrict to SourceArn or SourceAccount.

<Quirk score={8.5}>
    Probably just hardcoded bs; just remove it from the trust policy and add it after creating the trigger.
</Quirk>

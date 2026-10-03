<script>
    import Quirk from "../Quirk.svelte";
</script>

## Watch Out 👀

- Events in CloudTrail are batched: It can take up to 5 minutes until events arrive in the trail.

## Quirks

- When filtering for `Resource name` and `Resource type` I don't see all events.

<Quirk score={4.2}>
    Don't use them for filtering! Prefer <b>Event source / name</b>. Resource attributes just refer to "references" which are NOT added by all service control planes (e.g. Cloudwatch Logs omits them so CreateLogGroup won't appear on AWS::Logs::LogGroup).
</Quirk>

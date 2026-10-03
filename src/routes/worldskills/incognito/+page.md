<script>
    import Quirk from "../Quirk.svelte";
    import Note from "../Note.svelte";
</script>

### User Pools

User pools are actually just a fully hosted OIDC providers that can define multiple apps and can also authenticate users through other federated OIDC providers.  

### Identity Pools

Identity pools are literally just a developer-friendly wrapper for a federated IAM provider to a cognito user pool that implements an API which simply calls `sts:AssumeRoleWithWebIdentity` under the hood.

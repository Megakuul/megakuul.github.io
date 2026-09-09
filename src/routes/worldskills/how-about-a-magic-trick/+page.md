<script>
    import Quirk from "../Quirk.svelte";
    import Note from "../Note.svelte";
</script>

![magictrick](/images/magictrick.gif)

## Tricks

### SSH Keepalive

Needs no introduction.
```bash
ssh -o "ServerAliveInterval 30" -i yourkey.pem ec2-user@
```

### Abuse the aws cli as json api wrapper 📡

Instead of executing long weird aws cli commands in pipelines or scripts (please generally never do this in production and just use the sdk) analyze the json interface of a function via:

```bash
aws lambda update-function-configuration --generate-cli-skeleton > skeleton.json
```

Remove all unused parameters from `input.json` and perform the operation:

```bash
aws lambda update-function-configuration --cli-input-json file://./skeleton.json
```

You can also automate this to modify the file in multiple steps with jq, e.g.:

```bash
# extract current configuration layers
aws lambda get-function-configuration --function-name Cowsay --output json > current.json
# append ananaslayer to the existing layers
jq '{Layers} | .Layers = map(.[].Arn) | .Layers += ["arn:aws:lambda:eu-central-1:111111111111:layer:AnanasLayer:1"]' current.json > update.json
# update configuration
aws lambda update-function-configuration --function-name Cowsay --cli-input-json file://./update.json
```

### Conquer massive aws cli output with jq ⛵

```bash
# use on large commands to see keys of json layer
aws cloudfront list-distribution | jq ".DistributionList.Items[] | keys"

# use if you already know the specific keys to conquer their value
aws cloudfront list-distribution | jq ".DistributionList.Items[] | {ARN, CacheBehaviors}"

# apply complex filters
aws cloudfront list-distributions | jq '.DistributionList.Items[] | {ARN: .ARN, Paths: .CacheBehaviors.Items[].PathPattern} | select(.Paths | test("/v1.scheduler"))'
```

### Port-forward via SSM 🔌💰

```bash
aws ssm start-session --target <instance-id> --region <my-ec2-region> --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["80"],"localPortNumber":["42069"]}'
```

### Port-froward via EIC 🔌🏷️

```bash
aws ec2-instance-connect open-tunnel --instance-id i-11111111111111111 --remote-port 80 --local-port 42069
```


### Some cool Kubectl tricks 🐳

```bash
kubectl logs -f -l app.kubernetes.io/name=<your pod name> --prefix=true
```

```bash
kubectl get nodes -o wide
```

Find the impostor that blocks the node from shutting down
```bash
kubectl get pods -A --field-selector spec.nodeName=<node-name>
```

Check storageclass defaults:
```bash
kubectl get sc -o custom-columns="NAME:.metadata.name,DEFAULT:.metadata.annotations.storageclass\.kubernetes\.io/is-default-class"
```

Start a toolkit debugging container:
```bash
kubectl run toolkit -l yourlabel=value --image=docker.io/nicolaka/netshoot:latest -- bash -c -- "trap : TERM INT; sleep infinity & wait"
kubectl exec -it toolkit -- bash
```

### Access to isolated network resources 💲📉

Just add two PrivateLink Endpoints with the following services:

- `com.amazonaws.us-east-1.ssmmessages`
- `com.amazonaws.us-east-1.ssm`

And add a security group that allows ingress on `443` to the endpoints. That's all! You are now officially bankrupt.

(Consulting this document after your insolvency court proceedings? Check out EC2 Instance Connect!).


### Log in to Console with Role Credentials


Just enter the `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` env variables:
```bash
curl -s "https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=$(jq -rn --arg a "$AWS_ACCESS_KEY_ID" --arg s "$AWS_SECRET_ACCESS_KEY" --arg t "$AWS_SESSION_TOKEN" '{sessionId:$a,sessionKey:$s,sessionToken:$t}|tojson|@uri')" | jq -r '"https://signin.aws.amazon.com/federation?Action=login&Issuer=https%3A%2F%2Fexample.com&Destination=https%3A%2F%2Fconsole.aws.amazon.com%2F&SigninToken=" + .SigninToken'
```


### Confuse the deputy 😵‍💫

If a service is calling another service on your behalf you can use this simple condition check to avoid service deputy confusion:

```json
{
    "Effect": "Allow",
    "Principal": {
        "Service": "events.amazonaws.com"
    },
    "Action": "...",
    "Resource": "...",
    "Condition": {
        "ArnLike": {
            "aws:SourceArn": "arn:aws:events:eu-central-1:111111111111:event-bus/commerce-bus"
        },
        "StringEquals": {
            "aws:SourceAccount": "111111111111"
        },
    }
}
```
*Notice: the SourceAccount is kinda useless here as it is already enforced via arn*

<Note type="caution">
Caution: At LEAST the <b>aws:SourceAccount</b> check should be included in every single resource policy (ESPECIALLY in IAM TRUST POLICIES).
<br>
Technically by granting access from a service principal, every AWS account on earth can <b>sts:AssumeRole</b> your role.
<br>
Services only use <b>iam:PassRole</b> to check if you can configure this role (for example: I can't add the role <b>Klaus</b> from another account to my lambda function because I do not have <b>iam:PassRole</b> on <b>Klaus</b>).
<br>
Now since you cannot grant another account access to <b>iam:PassRole</b> the problem is effectively inexistent right?
<br>
Unfortunately no, the main reason is that <b>iam:PassRole</b> is a "pseudo" role. Other IAM permissions belong to exactly one "action" which is probably an endpoint in the AWS API that automatically checks if the IAM permissions match before even starting endpoint logic. PassRole on the other hand is completely unbound, you just rely on the developers ability to insert it on every possible code path where he passes a role (remember "passing a role" is not an action its just the process of configuring your service to use a role... the real "operation" which is assuming the role happens later but unrestricted).
<br>
Now the important question: <b>Do we trust the developers?</b>
<br>
This should answer the question whether you should add an additional condition or not.
</Note>

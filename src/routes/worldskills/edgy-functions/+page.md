<script>
    import Quirk from "../Quirk.svelte";
    import Note from "../Note.svelte";
</script>

## Table of Contents

## Python

In the rare case you find yourself writing a python function (please immediately inform your supervisor and tell him this is a generally bad idea), it's important to understand that this is a mess 🗑️

1. First create a template of a function like this:

```python
import os
from json import dumps
from cowsay import cowsay

def handler(event, context):
    if "TEXT" not in os.environ:
        raise Exception("TEXT env variable is not set")
    output = f"Wualla di Kuh hat gesagt: {os.environ["TEXT"]}"
    cowOutput = cowsay(output)
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json"

        },
        "body": dumps({
            "what the cow said": cowOutput,
            "what I said": "please add python lsp to the lambda monaco editor"
        })
    }
```

2. Package it and deploy it:

```bash
zip function.zip main.py
aws lambda update-function-code --function-name Cowsay --zip-file fileb://./function.zip
```

3. Add some important third-party dependencies from the best package manager the world has ever seen:

```bash
pip install python-cowsay
```

4. Remember that pip is a global garbage manager and install it to the hardcoded lambda path:

```bash
pip install python-cowsay -t python/lib/python3.14/site-packages
```

5. Zip the dependency as lambda layer and upload:

```bash
zip -r layer.zip python/
aws lambda publish-layer-version --layer-name Cowsay --zip-file fileb://./layer.zip
```

6. Deploy the function and notice how it will fail because it was the wrong python version, os or architecture.

7. Create a docker container to fix the mess:

```dockerfile
FROM public.ecr.aws/lambda/python:3.14

COPY main.py \${LAMBDA_TASK_ROOT}

RUN pip install python-cowsay

# the injected RIC engine requires <filename>.<function> to understand what to execute.
CMD ["main.handler"]
```

<Note type="caution">
You cannot use an arbitary docker image for RIC-less lambda runtimes.
For example python just defines a handler function, in order to invoke, retrieve and respond to lambda events a bridge (RIC) must be injected via the <a class="underline" href="https://gallery.ecr.aws/lambda">ecr lambda image</a>.

<br>
Compiled runtimes like go include this communication bridge natively (in aws-lambda-go). However, while you can technically use any image for those runtimes it is still a good practice to use the lambda/provided image (for compatibility reasons).
</Note>

8. Deploy to ECR

```bash
# build and upload versioned image (don't use / reference latest in production lambdas)
docker build -t 111111111111.dkr.ecr.eu-central-1.amazonaws.com/<yournamespace>/<yourimage>:v0.0.1 .
docker push 111111111111.dkr.ecr.eu-central-1.amazonaws.com/<yournamespace>/<yourimage>:v0.0.1
# upload latest version (for development type shii)
docker tag -t 111111111111.dkr.ecr.eu-central-1.amazonaws.com/<yournamespace>/<yourimage>:latest
docker push 111111111111.dkr.ecr.eu-central-1.amazonaws.com/<yournamespace>/<yourimage>:latest
```

9. Create new lambda function that uses this image (ref by version plz)

10. Switch to Go on AL2023 🗿

## Alias Pointers 👈

Lambda uses versions, but since the average edge-function-chad uses Arch Linux, rolling their updates on the bleeding edge 🩸, they added a `$LATEST` version.
The `$LATEST` version is functionally equivalent to the container image `latest` tag.

Generally it is not recommended to work with $LATEST in production. Instead, consider strictly versioning functions (which is done by snapshotting the current state via `lambda:PublishVersion`).

To avoid updating all lambda triggers on every update, AWS implemented `Aliases` that can be used like pointers to the latest operational version.
Unlike `$LATEST` aliases must be updated manually; however, this comes with a huge advantage: rollbacks.

Instead of panicking and searching through your git history to reassemble the working lambda code on a Friday evening, you can just reset the alias to a previous version, immediately gaining +200 <b class="text-indigo-500">FridayBeerPoints</b> in the process.

<Note type="info">
Aliases have a very powerful routing feature (configurable via --routing-config).
This feature allows you to shift a certain amount of requests to another version (e.g. an older or newer one).

<br>
Under the hood <b>CodeDeploy</b> heavily uses this feature, however because it is a native lambda feature you can also integrate it to custom cd pipelines.
</Note>

## Invocation Types

### DryRun

Performs a validation that checks if the function version exists and if you have access to invoke it.
Notice that this is a real command to the AWS API (creates a CloudTrail data event) and not just a CLI parameter.

### Event

Executes asynchron which returns 202 immediately and sends the lambda response to the configured destination (if any).

**Exceptions**: If the function throws or returns a non-zero exit code it is retried up 2 times (invoked 3 times in total with this pattern: `1: 0s 2: 1m 3: 2m`).

### RequestResponse

Executes synchron and waits for the response; this effectively hijacks the returned event which means it is _NOT_ forwarded to configured event destinations.

**Exceptions**: If the function throws or returns a non-zero exit code it returns a `"FunctionError": "Unhandled"` with an error event type as response and does NOT retry.

## Notes

- use pino logger or enable JSON and `console.log({})` for wrapping. Alternative you can use `process.stdout.write(JSON.stringify({}) + "\n")` to write RAW logs

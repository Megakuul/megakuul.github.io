<script>
    import Quirk from "../Quirk.svelte";
    import Note from "../Note.svelte";
</script>

<Note type="caution">
Caution: Please be aware that observing a cluster deployment leads to death, the process duration can easily outlive YOU.
<br>
Studies reported that the behavior is similar for modifications and user adjustments.
</Note>

### IAM Authentication

Elasticache supports IAM authentication with SigV4. As always I do appreciate the idea unfortunately the implementation is again... let's say "interesting".
Check it out yourself with the following simple example:

First you have to create an IAM policy that allows `elasticache:Connect` on the user and the cache:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Statement1",
      "Effect": "Allow",
      "Action": ["elasticache:Connect"],
      "Resource": [
        "arn:aws:elasticache:eu-central-1:111111111111:user:iambombaklaus",
        "arn:aws:elasticache:eu-central-1:111111111111:serverlesscache:ultracache"
      ]
    }
  ]
}
```

Now let's create the Lambda function to use it.

Look at this innocent slim function doesn't isn't it appealing?

```python
import redis

from iam_authtoken_request import ElastiCacheIAMProvider

def klambda_handler(event, ctx):
    creds_provider = ElastiCacheIAMProvider(user="iambombaklaus", cluster_name="ultracache", region="eu-central-1", debug=True, is_memorydb=False)

    print(f"Using credentials: {str(creds_provider.get_credentials())}")

    user_connection = redis.Redis(host="ultracache-111111.serverless.euc1.cache.amazonaws.com", port="6379", ssl=True, credential_provider=creds_provider)

    user_connection.incr("training:counter")
    print(user_connection.get("training:counter"))
```

Bruh... _iam_authtoken_request.py_:

```python
from typing import Tuple, Union
from urllib.parse import ParseResult, urlencode, urlunparse

import botocore.session
import redis
from botocore.model import ServiceId
from botocore.signers import RequestSigner
from cachetools import TTLCache, cached

class ElastiCacheIAMProvider(redis.CredentialProvider):
    def __init__(self, user, cluster_name, region, debug=False, is_memorydb=False):
        self.user = user
        self.cluster_name = cluster_name
        self.region = region
        self.debug = debug

        session = botocore.session.get_session()
        self.request_signer = RequestSigner(
            ServiceId("memorydb" if is_memorydb else "elasticache"),
            self.region,
            "memorydb" if is_memorydb else "elasticache",
            "v4",
            session.get_credentials(),
            session.get_component("event_emitter"),
        )

        # Display the actual caller identity being used by the program
        if self.debug:
            try:
                caller_identity = session.create_client('sts').get_caller_identity()
                print(f"Current Role/User ARN: {caller_identity['Arn']}")
            except Exception as e:
                print(f"Error in getting caller identity: {str(e)}")

    # Generated IAM tokens are valid for 15 minutes
    @cached(cache=TTLCache(maxsize=1, ttl=900))
    def get_credentials(self) -> Union[Tuple[str], Tuple[str, str]]:
        query_params = {"Action": "connect", "User": self.user}
        url = urlunparse(
            ParseResult(
                scheme="https",
                netloc=self.cluster_name,
                path="/",
                query=urlencode(query_params),
                params="",
                fragment="",
            )
        )
        signed_url = self.request_signer.generate_presigned_url(
            {"method": "GET", "url": url, "body": {}, "headers": {}, "context": {}},
            operation_name="connect",
            expires_in=900,
            region_name=self.region,
        )
        if self.debug:
            print(f"Using credentials: {self.user} {signed_url.removeprefix('https://')}")
        return self.user, signed_url.removeprefix("https://")
```

<Note>
I would like to distance myself from that ugly piece of dogwater garbage code (no, I'm not just referring to the python smell).
<br>
I officially have nothing to do with <a href="https://github.com/aws-samples/sample-Elasticache-iam-authentication-python-demo-application">this code</a>.
</Note>

Btw, for this to work you also have to add a lambda layer with redis and cachetools:

```bash
mkdir -p redis/python
pip install -t ./redis/python redis
pip install -t ./redis/python cachetools
cd redis
zip -r ../redis.zip .
aws lambda publish-layer-version --layer-name redis --zip-file fileb://./redis.zip
```

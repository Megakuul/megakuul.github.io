import json
import os
from urllib.request import urlopen


def handler(event, context):
    url = "http://127.0.0.1:2772" + os.environ["APPCONFIG_PATH"]
    with urlopen(url, timeout=5) as response:
        config = json.load(response)
    return {"statusCode": 200, "body": json.dumps(config)}

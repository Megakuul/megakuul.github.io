# index.py — Lambda handler: index.handler
import base64
import binascii
import json
import re
import traceback
from urllib.parse import parse_qsl, unquote, unquote_plus


def reply(status, body, headers=None):
    text = isinstance(body, str)
    return {
        "statusCode": status,
        "headers": {"content-type": "text/plain; charset=utf-8" if text else "application/json", **(headers or {})},
        "body": body if text else json.dumps(body),
        "isBase64Encoded": False,
    }


routes = [
    ("GET", "/", lambda req: reply(200, "Hello world")),
    ("GET", "/health", lambda req: reply(200, {"ok": True})),
    ("GET", "/users/{id}", lambda req: reply(200, {"id": req["params"]["id"]})),
    ("GET", "/search", lambda req: reply(200, {"q": req["query"].get("q", "")})),
    ("POST", "/echo", lambda req: reply(200, req["json"]())),
]


def handler(event, context):
    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}
    method = http.get("method") or event.get("httpMethod")
    path = event.get("rawPath") or event.get("path") or http.get("path")

    def finish(response):
        if method == "HEAD" or response["statusCode"] in (204, 304):
            response["body"] = ""
        if "elb" in request_context and "multiValueHeaders" in event:
            response["multiValueHeaders"] = {k: [v] for k, v in response.pop("headers").items()}
        return response

    if not method or not path:
        return finish(reply(400, "Expected an HTTP event with method and path"))
    try:
        encoded = "rawPath" in event or "elb" in request_context
        parts = path.removesuffix("/").split("/")
        if encoded:
            if re.search(r"%(?![0-9a-fA-F]{2})", path):
                return finish(reply(400, "Bad request"))
            parts = [unquote(p, errors="strict") for p in parts]
        allowed = []
        for verb, pattern, run in routes:
            keys = pattern.removesuffix("/").split("/")
            if len(keys) != len(parts):
                continue
            params = {}
            for key, part in zip(keys, parts):
                if re.fullmatch(r"\{\w+\}", key) and part:
                    params[key[1:-1]] = part
                elif key != part:
                    break
            else:
                allowed.append(verb)
                if verb == "GET":
                    allowed.append("HEAD")
                if verb != method and not (method == "HEAD" and verb == "GET"):
                    continue
                body = event.get("body") or ""
                if event.get("isBase64Encoded"):
                    body = base64.b64decode(body, validate=True).decode("utf-8")
                query = dict(parse_qsl(event["rawQueryString"], keep_blank_values=True)) if "rawQueryString" in event else dict(event.get("queryStringParameters") or {})
                query.update({k: v[-1] for k, v in (event.get("multiValueQueryStringParameters") or {}).items()})
                if "elb" in request_context:
                    query = {unquote_plus(k): unquote_plus(v) for k, v in query.items()}
                req = {
                    "params": params, "query": query, "body": body, "event": event, "context": context,
                    "headers": {k.lower(): ", ".join(v) if isinstance(v, list) else v for k, v in {**(event.get("headers") or {}), **(event.get("multiValueHeaders") or {})}.items()},
                    "json": lambda: json.loads(body),
                }
                return finish(run(req))
        return finish(reply(405, "Method not allowed", {"allow": ", ".join(dict.fromkeys(allowed))}) if allowed else reply(404, "Not found"))
    except (json.JSONDecodeError, UnicodeError, binascii.Error):
        return finish(reply(400, "Bad request"))
    except Exception:
        traceback.print_exc()
        return finish(reply(500, "Internal server error"))

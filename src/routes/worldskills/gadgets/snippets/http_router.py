import base64
import json
import re
import traceback
from http import HTTPStatus
from urllib.parse import parse_qsl, unquote

def reply(status, data, headers=None, cookies=None):
    return {"statusCode": status, "data": data, "headers": headers or {}, "cookies": cookies or []}


def raw_reply(status, body="", headers=None, cookies=None):
    """Send strings verbatim; bytes/bytearray are encoded for Lambda automatically."""
    return {"statusCode": status, "body": body, "headers": headers or {}, "cookies": cookies or [], "raw": True}


def encode_response(response):
    raw = response.get("raw", False)
    binary = raw and isinstance(response["body"], (bytes, bytearray))
    if raw and not binary and not isinstance(response["body"], str):
        raise TypeError("raw_reply body must be a string, bytes, or bytearray")
    content_type = ("application/octet-stream" if binary else "text/plain; charset=utf-8") if raw else "application/json"
    if raw:
        body = base64.b64encode(response["body"]).decode("ascii") if binary else response["body"]
    else:
        body = json.dumps(response["data"], allow_nan=False)
    return {
        "headers": {"content-type": content_type, **{k.lower(): v for k, v in response["headers"].items()}},
        "isBase64Encoded": bool(binary), "body": body,
    }


class BadRequest(Exception):
    pass


def decode(value, plus=False):
    try:
        if re.search(r"%(?![0-9A-Fa-f]{2})", value):
            raise ValueError("Malformed percent escape")
        return unquote(value.replace("+", " ") if plus else value, errors="strict")
    except (ValueError, UnicodeError) as error:
        raise BadRequest("Invalid URL encoding") from error


def values(single=None, multi=None, key_transform=lambda v: v, value_transform=lambda v: v):
    result = {key_transform(k): [value_transform(v)] for k, v in (single or {}).items()}
    result.update({key_transform(k): [value_transform(v) for v in items] for k, items in (multi or {}).items()})
    return result


def path_parts(path, encoded, base_path):
    if not isinstance(path, str) or not path.startswith("/"):
        raise BadRequest("Missing HTTP path")
    if base_path:
        if path != base_path and not path.startswith(base_path + "/"):
            return None
        path = path[len(base_path):] or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    # Split before decoding so an encoded slash remains inside its parameter.
    return [] if path == "/" else [decode(p) if encoded else p for p in path[1:].split("/")]


def match(pattern, parts):
    if parts is None:
        return None
    template = [] if pattern == "/" else pattern[1:].split("/")
    params = {}
    for index, part in enumerate(template):
        if part.startswith("{") and part.endswith("}"):
            name = part[1:-1]
            if name.endswith("+"):
                if index != len(template) - 1 or index >= len(parts) or not all(parts[index:]):
                    return None
                params[name[:-1]] = "/".join(parts[index:])
                return params
            if index >= len(parts) or not parts[index]:
                return None
            params[name] = parts[index]
        elif index >= len(parts) or part != parts[index]:
            return None
    return params if len(template) == len(parts) else None


def body_bytes(event):
    body = event.get("body") or ""
    if not isinstance(body, str):
        raise BadRequest("HTTP body must be a string")
    try:
        return base64.b64decode(body, validate=True) if event.get("isBase64Encoded") else body.encode("utf-8")
    except (ValueError, UnicodeError) as error:
        raise BadRequest("Invalid base64 body") from error


def reject_constant(value):
    raise ValueError("Invalid JSON constant: " + value)


def json_body(body):
    try:
        return json.loads(body.decode("utf-8"), parse_constant=reject_constant)
    except (ValueError, UnicodeError) as error:
        raise BadRequest("Body must contain valid UTF-8 JSON") from error


_UNMATCHED = object()


def dispatch(req, routes, middleware, base_path, fallthrough):
    parts = path_parts(req["path"], req["encodedPath"], base_path)
    matches = [(method, handle, params) for method, pattern, handle in routes
               if (params := match(pattern, parts)) is not None]
    route = next((r for r in matches if r[0] == req["method"]), None)
    if route is None and req["method"] == "HEAD":
        route = next((r for r in matches if r[0] == "GET"), None)
    if route is None:
        if fallthrough:
            return _UNMATCHED
        if not matches:
            return reply(404, {"error": "Not found"})
        allow = {r[0] for r in matches}
        if "GET" in allow:
            allow.add("HEAD")
        return reply(405, {"error": "Method not allowed"}, {"allow": ", ".join(sorted(allow))})
    req["params"] = route[2]
    req["body"] = body_bytes(req["event"])  # bytes; binary bodies remain intact.
    req["json"] = lambda: json_body(req["body"])

    def run(index):
        return route[1](req) if index == len(middleware) else middleware[index](req, lambda: run(index + 1))

    return run(0)


# Each route is (method, path pattern, handler); first matching method + path wins.
# Middleware receives (request, next_handler), with extracted params available.
# Non-HTTP events return None so this gadget can be composed with another handler.
# Optional fallback(event, context) handles non-HTTP events and unmatched paths/methods.
# Its final Lambda response is returned unchanged; exceptions propagate to the caller.
def create_router(routes, *, middleware=None, base_path="", fallback=None):
    middleware = middleware if middleware is not None else []
    def handler(event, context):
        ctx = (event.get("requestContext") or {}) if isinstance(event, dict) else {}
        if ctx.get("http") is not None:
            read_request, write_response = read_v2, write_v2
        elif ctx.get("elb") is not None:
            read_request, write_response = read_alb, write_alb
        elif isinstance(event, dict) and event.get("httpMethod"):
            read_request, write_response = read_v1, write_v1
        else:
            return fallback(event, context) if fallback is not None else None
        req = None
        response = None
        try:
            req = read_request(event)
            req.update(event=event, context=context,
                       requestId=getattr(context, "aws_request_id", None) or (event.get("requestContext") or {}).get("requestId", "unknown"))
            response = dispatch(req, routes, middleware, base_path, fallback is not None)
            if response is not _UNMATCHED:
                result = write_response(response, event)
        except BadRequest as error:
            result = write_response(reply(400, {"error": str(error)}), event)
        except Exception:
            traceback.print_exc()
            result = write_response(reply(500, {"error": "Internal server error", "requestId": (req or {}).get("requestId")}), event)
        if response is _UNMATCHED:
            return fallback(event, context)
        if (req or {}).get("method") == "HEAD" or result["statusCode"] in (204, 304):
            result["body"] = ""
        return result
    return handler


# Function URL or HTTP API payload 2.0. Match the path, not routeKey/pathParameters.
def read_v2(event):
    http = (event.get("requestContext") or {}).get("http") or {}
    if not http.get("method") or not isinstance(event.get("rawPath"), str):
        raise BadRequest("Expected HTTP payload 2.0")
    query = {}
    # Preserve repeated keys and literal commas using the raw query string.
    for key, value in parse_qsl(event.get("rawQueryString") or "", keep_blank_values=True):
        query.setdefault(key, []).append(value)
    return {
        "source": "http-v2", "method": http["method"], "path": event["rawPath"], "encodedPath": True,
        "query": query, "headers": values(event.get("headers"), key_transform=str.lower),
        "cookies": event.get("cookies") or [],
    }


def write_v2(response, event):
    return {
        "statusCode": response["statusCode"],
        **encode_response(response),
        "cookies": response["cookies"],
    }


# REST proxy or HTTP API payload 1.0, including ANY /{proxy+} integrations.
def read_v1(event):
    if not event.get("httpMethod") or (event.get("requestContext") or {}).get("elb") is not None:
        raise BadRequest("Expected API Gateway payload 1.0")
    headers = values(event.get("headers"), event.get("multiValueHeaders"), str.lower)
    return {
        "source": "apigw-v1", "method": event["httpMethod"], "path": event.get("path"), "encodedPath": False,
        # API Gateway already decoded these values; do not decode percent signs again.
        "query": values(event.get("queryStringParameters"), event.get("multiValueQueryStringParameters")),
        "headers": headers, "cookies": headers.get("cookie", []),
    }


def write_v1(response, event):
    return {
        "statusCode": response["statusCode"],
        **encode_response(response),
        "multiValueHeaders": {"set-cookie": response["cookies"]} if response["cookies"] else {},
    }


# ALB target with lambda.multi_value_headers.enabled either true or false.
def read_alb(event):
    if not event.get("httpMethod") or (event.get("requestContext") or {}).get("elb") is None:
        raise BadRequest("Expected ALB Lambda target event")
    headers = values(event.get("headers"), event.get("multiValueHeaders"), str.lower)
    return {
        "source": "alb", "method": event["httpMethod"], "path": event.get("path"), "encodedPath": True,
        "query": values(event.get("queryStringParameters"), event.get("multiValueQueryStringParameters"),
                        lambda key: decode(key, True), lambda value: decode(value, True)),
        "headers": headers, "cookies": headers.get("cookie", []),
    }


def write_alb(response, event):
    multi = "multiValueHeaders" in event
    if not multi and len(response["cookies"]) > 1:
        print("Enable ALB multivalue headers to return multiple cookies")
        response = reply(500, {"error": "Multiple cookies require ALB multivalue headers"})
    encoded = encode_response(response)
    headers = encoded.pop("headers")
    status = response["statusCode"]
    result = {
        "statusCode": status,
        "statusDescription": str(status) + " " + (HTTPStatus(status).phrase if status in HTTPStatus._value2member_map_ else "Unknown"),
        **encoded,
    }
    if multi:
        result["multiValueHeaders"] = values(headers)
        if response["cookies"]:
            result["multiValueHeaders"]["set-cookie"] = response["cookies"]
    else:
        result["headers"] = headers
        if response["cookies"]:
            result["headers"]["set-cookie"] = response["cookies"][0]
    return result

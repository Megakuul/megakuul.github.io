from http_router import create_router, reply, raw_reply

# Copy http_router.py beside this file; set Lambda's handler to router_index.handler.
route = create_router([
    ("GET", "/health", lambda req: reply(200, {"ok": True})),
    ("GET", "/hello", lambda req: raw_reply(200, "Hello world")),
    ("GET", "/page", lambda req: raw_reply(200, "<h1>Hello</h1>", {"content-type": "text/html; charset=utf-8"})),
    ("GET", "/users/{id}/blub/ananas/{another_id}", lambda req: reply(200, req["params"])),
    ("POST", "/users", lambda req: reply(201, {"created": req["json"]()})),
], fallback=lambda event, context: None)  # Also fall through for unmatched HTTP paths/methods.


def handler(event, context):
    response = route(event, context)
    if response is not None:
        return response
    # Your existing handler continues here (SQS, EventBridge, other HTTP routes, etc.).
    return {"ok": True}


# Or delegate directly: create_router(routes, fallback=existing_handler).
# fallback gets the original event/context and returns a final Lambda response (not reply()).

# Optional keywords: base_path="/api", middleware=[lambda req, next_handler: next_handler()]
# req["params"], req["query"] (lists), req["headers"] (lists), req["cookies"], req["body"] (bytes).
# reply() serializes JSON. raw_reply() sends strings verbatim or bytes/bytearray as binary.

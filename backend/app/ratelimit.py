import time
from collections import defaultdict, deque
from dataclasses import dataclass
from fastapi import Request
from starlette.responses import JSONResponse

@dataclass(frozen=True)
class RateLimit:
    limit: int
    window_seconds: int

BUCKETS = {
    "create_deck": RateLimit(5, 3600),
    "search": RateLimit(60, 60),
    "list_decks": RateLimit(120, 60),
    "get_deck": RateLimit(120, 60),
    "export_deck": RateLimit(30, 60),
}

_hits: dict[str, deque] = defaultdict(deque)

def _client_ip(request: Request) -> str:
    # Take the last proxy hop from X-Forwarded-For if set by Cloudflare/reverse proxy
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"

def check(request: Request, bucket: str) -> tuple[bool, RateLimit, int]:
    rule = BUCKETS[bucket]
    ip = _client_ip(request)
    key = f"{bucket}:{ip}"
    now = time.monotonic()
    dq = _hits[key]
    cutoff = now - rule.window_seconds

    while dq and dq[0] < cutoff:
        dq.popleft()

    if len(dq) >= rule.limit:
        retry_after = int(rule.window_seconds - (now - dq[0])) + 1
        return False, rule, retry_after

    dq.append(now)
    return True, rule, 0

def rate_limited_response(rule: RateLimit, retry_after: int) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "detail": f"Rate limit exceeded: {rule.limit} requests / {rule.window_seconds}s. Try again later."
        },
        headers={"Retry-After": str(retry_after)},
    )

def reset():
    _hits.clear()

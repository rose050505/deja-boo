#!/usr/bin/env bash
# Builds the demo repository "haunted-http" for the Déjà Boo video.
# It re-enacts a real history from psf/requests:
#   2019-07-02 2da7fe08 "Use urllib for chunked requests"   (hand-rolled chunked loop replaced by urlopen(chunked=...))
#   2020-02-18 24bcb9ea Revert "Use urllib for chunked requests"
#   2023-04-22 26bea1e4 "Use urllib3 native chunking ability (#6226)" — re-landed by a new contributor
# Here the dates are compressed into 2025 and the code is small enough to read on screen.
# This is a fixture (not product code). Usage: bash build_demo_repo.sh [target_dir]
set -euo pipefail

TARGET="${1:-$(dirname "$0")/haunted-http}"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cd "$TARGET"
git init -q -b main

commit() { # commit "<iso date>" "<author>" "<message>"
  git add -A
  GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" \
  GIT_AUTHOR_NAME="$2" GIT_AUTHOR_EMAIL="$(echo "$2" | tr 'A-Z ' 'a-z.')@example.invalid" \
  GIT_COMMITTER_NAME="$2" GIT_COMMITTER_EMAIL="$(echo "$2" | tr 'A-Z ' 'a-z.')@example.invalid" \
  git commit -q -m "$3"
}

mkdir -p haunted_http tests

# ---------- the two versions of send() ----------
write_adapter_manual() {
cat > haunted_http/adapter.py <<'PY'
"""Transport adapter: turns a Request into bytes on the wire."""

from .pool import ConnectionPool, DEFAULT_POOL_TIMEOUT
from .response import Response


class HTTPAdapter:
    def __init__(self, max_retries=3):
        self.max_retries = max_retries
        self.pool = ConnectionPool()

    def send(self, request, timeout=None):
        conn = self.pool.connection_for(request.url)
        chunked = not (request.body is None or "Content-Length" in request.headers)

        if not chunked:
            raw = conn.urlopen(
                method=request.method,
                url=request.path,
                body=request.body,
                headers=request.headers,
                redirect=False,
                retries=self.max_retries,
                timeout=timeout,
            )
        else:
            # Stream the body ourselves: hex length, CRLF, data, CRLF ... 0 CRLF CRLF.
            if hasattr(conn, "proxy_pool"):
                conn = conn.proxy_pool
            low_conn = conn.get_conn(timeout=DEFAULT_POOL_TIMEOUT)
            try:
                low_conn.putrequest(request.method, request.path, skip_accept_encoding=True)
                for header, value in request.headers.items():
                    low_conn.putheader(header, value)
                low_conn.endheaders()
                for chunk in request.body:
                    low_conn.send(hex(len(chunk))[2:].encode("utf-8"))
                    low_conn.send(b"\r\n")
                    low_conn.send(chunk)
                    low_conn.send(b"\r\n")
                low_conn.send(b"0\r\n\r\n")
                raw = low_conn.getresponse()
            except Exception:
                low_conn.close()
                raise

        return Response.from_raw(raw, request)
PY
}

write_adapter_pool_chunked() {
cat > haunted_http/adapter.py <<'PY'
"""Transport adapter: turns a Request into bytes on the wire."""

from .pool import ConnectionPool
from .response import Response


class HTTPAdapter:
    def __init__(self, max_retries=3):
        self.max_retries = max_retries
        self.pool = ConnectionPool()

    def send(self, request, timeout=None):
        conn = self.pool.connection_for(request.url)
        chunked = not (request.body is None or "Content-Length" in request.headers)

        raw = conn.urlopen(
            method=request.method,
            url=request.path,
            body=request.body,
            headers=request.headers,
            redirect=False,
            retries=self.max_retries,
            timeout=timeout,
            chunked=chunked,
        )

        return Response.from_raw(raw, request)
PY
}

# ---------- history ----------
cat > README.md <<'MD'
# haunted-http

A tiny HTTP client used to demo Déjà Boo. Its history re-enacts a real
revert from psf/requests (chunked uploads, 2019 → 2020 → 2023).
MD
cat > haunted_http/__init__.py <<'PY'
from .adapter import HTTPAdapter

__all__ = ["HTTPAdapter"]
PY
cat > haunted_http/pool.py <<'PY'
"""Minimal stand-in for a urllib3-style connection pool."""

DEFAULT_POOL_TIMEOUT = 5.0


class ConnectionPool:
    def connection_for(self, url):
        raise NotImplementedError("demo stub")
PY
cat > haunted_http/response.py <<'PY'
class Response:
    @classmethod
    def from_raw(cls, raw, request):
        resp = cls()
        resp.raw = raw
        resp.request = request
        return resp
PY
write_adapter_manual
commit "2025-01-14T10:02:00+09:00" "Ada Ghost" "Initial client with chunked upload support"

cat > tests/test_adapter.py <<'PY'
from haunted_http import HTTPAdapter


def test_adapter_has_retries():
    assert HTTPAdapter(max_retries=5).max_retries == 5
PY
commit "2025-02-03T15:40:00+09:00" "Ada Ghost" "Add adapter smoke test"

write_adapter_pool_chunked
commit "2025-03-10T11:17:00+09:00" "Leon Wisp" "Use the pool's native chunked mode for uploads

Drops 30 lines of hand-rolled Transfer-Encoding framing."

cat >> README.md <<'MD'

## Install

    pip install -e .
MD
commit "2025-04-22T09:05:00+09:00" "Ada Ghost" "Document install"

write_adapter_manual
commit "2025-10-01T18:30:00+09:00" "Nate Shade" "Revert \"Use the pool's native chunked mode for uploads\"

Uploads through an HTTP proxy hang forever: the pool's chunked mode
skips proxy_pool and never sends the terminating 0-length chunk.
Restoring the manual framing until the pool handles proxies. Fixes #42."

cat >> tests/test_adapter.py <<'PY'


def test_default_retries():
    assert HTTPAdapter().max_retries == 3
PY
commit "2025-10-20T13:12:00+09:00" "Ada Ghost" "Test default retries"

echo "built $(git rev-list --count HEAD) commits in $TARGET"

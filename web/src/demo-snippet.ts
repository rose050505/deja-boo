/**
 * What an agent writes when asked to "use the pool's native chunked mode for uploads" in haunted-http:
 * the Revert-buried urlopen(..., chunked=chunked) call, with `raw` renamed to `response`.
 */
export const DEMO_REPO = 'haunted-http';

export const DEMO_SNIPPET = `"""Transport adapter: turns a Request into bytes on the wire."""

from .pool import ConnectionPool
from .response import Response


class HTTPAdapter:
    def __init__(self, max_retries=3):
        self.max_retries = max_retries
        self.pool = ConnectionPool()

    def send(self, request, timeout=None):
        conn = self.pool.connection_for(request.url)
        chunked = not (request.body is None or "Content-Length" in request.headers)

        response = conn.urlopen(
            method=request.method,
            url=request.path,
            body=request.body,
            headers=request.headers,
            redirect=False,
            retries=self.max_retries,
            timeout=timeout,
            chunked=chunked,
        )

        return Response.from_raw(response, request)
`;

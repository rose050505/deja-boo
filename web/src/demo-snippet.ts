/**
 * What Kiro wrote in requests/adapters.py in the real-history test (docs/kiro-runs/rehearsal_requests2023_guarded.diff),
 * without the acknowledgement comment: the urlopen(..., chunked=chunked) call that the 2020-02-18 Revert buried.
 */
export const DEMO_REPO = 'requests';

/** The tombstone the demo must raise (requests, 2020-02-18 Revert). */
export const DEMO_STONE_ID = 'a36a5b61502a63ed9b4b2b875e7420e118a72156';

export const DEMO_SNIPPET = `    def send(self, request, stream=False, timeout=None, verify=True, cert=None, proxies=None):
        conn = self.get_connection(request.url, proxies)
        url = self.request_url(request, proxies)
        chunked = not (request.body is None or "Content-Length" in request.headers)

        try:
            resp = conn.urlopen(
                method=request.method,
                url=url,
                body=request.body,
                headers=request.headers,
                redirect=False,
                assert_same_host=False,
                preload_content=False,
                decode_content=False,
                retries=self.max_retries,
                timeout=timeout,
                chunked=chunked,
            )

        except (ProtocolError, OSError) as err:
            raise ConnectionError(err, request=request)
`;

Continue the revenant-watch spec: implement Batch C (tasks 5-6: decideHook, hook entry point, latency benchmark) and Batch D (tasks 7-8: pure MCP handlers, MCP server over stdio with @modelcontextprotocol/sdk). Follow requirements.md/design.md as revised. Each batch ends with npm test + npx tsc --noEmit green; mark finished tasks in tasks.md.
Reviewer notes:
- Hook events to cover in tests now (the full REQ-9 acceptance test comes in task 10, but add unit tests for decideHook with in-memory files): fs_write new file, fs_write rewrite, str_replace, other tool, skipped path, invalid JSON, missing graveyard, partial acknowledgement.
- Latency: report the measured number in tasks.md. If over 200 ms, add the exact prefilter with its equality property.
- MCP: keep stdout clean (protocol only). Test by spawning the built server and calling the three tools with the SDK client.
Print a 5-line summary with test counts and the measured hook latency.

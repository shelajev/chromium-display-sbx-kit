---
# chromium-help
title: Teach agents launch handoff and safe diagnostics
status: todo
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T13:35:23Z
---

Epic chromium-brow; order 6. Improve shipped agent context so agents use the
shared browser wrapper, select display correctly, request human login when
needed and recover through supported commands. Add redacted status/diagnostics
for browser/MCP version, display endpoint, proxy mode, profile path and CDP.

Accept representative fresh-agent use of actual kit, useful diagnosis of an
invisible window/MCP mismatch, and preservation of unrelated agent configuration.
No credential values, cookies, tokens or page contents in diagnostic bundles.
Depends on the relevant fres/disp/prox/secr/life interface decisions.

---
# chromium-updt
title: Propose weekly browser and tooling updates
status: todo
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T13:35:23Z
---

Epic chromium-brow; order 7. Add weekly/manual maintenance that detects available
Chromium plus Debian revision, MCP and required compatibility updates. Address
vanishing mirror pins explicitly, balancing rebuildability and security freshness.
Propose one maintained update PR with validation evidence and useful failure alert.

Preserve existing grouped Dependabot Actions updates, immutable pins, seven-day
age defaults and individually reviewed urgent security exceptions. No auto-merge
or pull_request/pull_request_target Actions triggers. Ensure the proposed branch
can be validated through allowed push/manual routes before integration.
Accept dry-run/no-change/update/failure cases. Depends on fres.

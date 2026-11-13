---
# chromium-updt
title: Propose weekly browser and tooling updates
status: in-progress
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T20:26:25Z
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

- [x] Official-source updater and deterministic policy fixtures
- [x] Weekly/manual workflow and accurate dispatch prerequisites
- [x] Three input advisory fixes and regressions
- [x] Guest checks and build/TCK evidence
- [ ] Host native GitHub/SBX validation after exact-commit QC

## Summary of Changes

Implemented a bounded official-source pin updater with deterministic HTTP fixtures, seven-day/dual-architecture gates, audited exact-pin manual security exceptions, vanished-mirror failures, and dry-run/no-change/update/failure reports. Weekly/manual Actions reuse native dual-arch validation before maintaining one PR and explicitly dispatch branch CI using GITHUB_TOKEN with actions:write. Official GitHub documentation confirms workflow_dispatch is an exception to token event suppression. Fixed local X11 unix DISPLAY forms, decimal-only CDP ports in lifecycle/MCP, and relative TCK output resolution with regressions. Grouped Dependabot and no PR-event Actions/no automatic merge preserved.

Guest verification: fixture suite, display/lifecycle suite, syntax, workflow guard, actionlint v1.7.12, Beans and diff checks passed. Full native arm64 guest OCI recipe smoke passed (closure, browser/CDP, MCP/WebMCP, persistence, ownership races, registration), kit-tck 19/19 and overlay owners 0/0. Relative ./rel-bin/kit-tck real install succeeded. Live read-only dry run proposed mature debian-base digest refresh and held younger MCP/Node releases; no pin updates applied to this commit.

Host acceptance remains pending: actual GitHub settings/branch rules, pushes, dispatch and both hosted runners; native SBX/display behavior and publication are host-owned. No pushes, PRs, merges, settings or secrets were changed by crew. Exact-commit independent QC next.

- [x] QC round 2: real CLI empty-input/report regressions and already-shipped young-pin retention

Round 2 correction: CLI now accepts empty optional strings passed by normal schedule/manual workflow argv and writes failure reports for argument/setup errors. Spawned CLI fixtures exercise actual invocation shape with local official-source-format HTTP fixtures, including schedule/manual apply, default manual dry-run, no-change/failure reports and a manual urgent Chromium update followed by a schedule while still young. Existing current pins retain resolution/compatibility checks without requiring renewed age exceptions; all new-pin seven-day gates and exact manual exception restrictions remain. Live read-only workflow-shaped CLI passed with empty security inputs and produced JSON/Markdown; no pin changes applied. No runtime/build/architecture changes or repeated guest build; prior native evidence remains separately recorded.

- [x] QC round 3: DHI challenge/auth contract, sanitized failure reports and HTTP regressions

Round 3 correction candidate: actual hosted main dry-run 43500465218 failed DHI token401 despite f788bc9 native both-arch CI 43499907098. Official DHI docs require authentication; no anonymous-parity claim remains. Replaced raw token/registry handling with existing Docker Buildx imagetools metadata resolver and added the already-pinned Buildx setup to detection. Raw immutable indices are hash-checked; both linux/amd64 and linux/arm64 manifests/configs are required; Buildx content verification and seven-day/new-pin exception rules remain gates. No credential files read by agent, no token values printed, no new login/credential/secret wiring. Real Buildx HTTP fixtures verify Bearer challenge/advertised token realm, signed config redirects, denied token/redirect failures without leaked bodies/query signatures, and rejection of corrupt platform/config content. Guest live workflow-argv dry-run and affected syntax/guards/actionlint/Beans pass. Hosted maintenance on this correction is not yet proven; owner must verify existing Docker/Buildx access on the actual detection runner. Native build success alone does not establish that prerequisite.

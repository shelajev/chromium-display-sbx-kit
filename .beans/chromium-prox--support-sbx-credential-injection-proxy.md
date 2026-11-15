---
# chromium-prox
title: Support SBX credential injection proxy
status: in-progress
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-15T14:40:26Z
---

Epic chromium-brow; order 3. Launcher currently unsets proxy variables and
forces no-proxy-server. Establish SBX's browser proxy/CA contract, then implement
trust and routing without certificate-error bypasses or embedding real secrets.
Determine supported protocols, including WebSocket behavior relevant to Teams.

Accept with synthetic destination-scoped injection, redirect/subresource
non-leakage checks, bad-certificate rejection, loopback CDP access and network
denial preservation. Explain any direct mode explicitly; never silently bypass
credential injection on a trust failure. Requires fres for runtime evidence.

Accepted 2026-11-15 in [v2.0.2](https://github.com/shelajev/chromium-display-sbx-kit/releases/tag/v2.0.2),
source19da104 (exact source tree independently reviewed at7b148cd). Normal
launch retains SBX's forward proxy and imports its current CA through bundled,
pinned NSS tooling. Configured-proxy and required-proxy callers refuse invalid
inputs or an incompatible managed browser without deleting the session;
deliberate valid restart applies new settings. Direct bypass is explicit.

Synthetic real-Chromium HTTP/HTTPS/ws/wss scoped injection, redirect/subresource
and upgrade non-leakage, certificate rejection, denial preservation, loopback,
route/reuse/refusal/recovery and diagnostic privacy checks passed. Corrected
mountless native aarch64 composition passed SBX CA trust, real forward/L7
policy, unreadable-CA/record refusal with PID preserved, MCP/WebMCP and restart.
Native AMD64+ARM64 CI and publication passed. Published index TCK conforms:
18 checks passed, one index-annotation fallback warning (platform metadata valid).

Native production ws/wss upgrade traffic and authenticated Teams remain future
workflow-readiness checks, owned by chromium-team before real account use.
Profile/secret boundaries remain chromium-secr; proxy support does not hide
website sessions from the same-user agent. Native clipboard and Mac/VFIO
hardware GPU are separate open work. No real website credential was used.

Reopened 2026-11-15 for registered-client environment verification. The native
checks above launched the real MCP server directly. Exact Codex0.166 source
filters stdio MCP child environments; the current owned registration has no
explicit env_vars. Determine actual client behavior, then repair the narrow
environment contract without persisting values or forwarding unrelated secrets.
Track bounded execution centrally as ai-contrib-benv / chromium-agent-env.

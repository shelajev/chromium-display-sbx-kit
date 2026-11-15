---
# chromium-prox
title: Support SBX credential injection proxy
status: in-progress
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-15T15:36:00Z
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

Defect confirmed 2026-11-15 (central ai-contrib-benv version 542b2596b8fc0020).
Fetched rust-v0.166.0 sources match the supplied excerpts byte for byte. Codex
0.166.0 (official npm linux-arm64 package, isolated HOME and CODEX_HOME) was
run through `app-server`: initialize, thread/start, mcpServerStatus/list and
client-issued mcpServer/tool/call. No model was invoked. A name-only probe
showed the registered child receives only HOME, PATH and SSL_CERT_FILE, plus
PWD set by its shell. The real 2.0.2 overlay (base 6369cea), with a synthetic
sandbox CA and a loopback proxy, fails MCP startup in three cases: fresh,
reuse of a pre-started proxied browser, and the legacy entry. The server's
stderr reads "a sandbox proxy CA is present but no proxy variable reached the
browser" (15:34Z).

Fix fbdf1ca: the Codex entry lists 18 names (proxy, CA, proxy mode, display,
GPU) in env_vars. They equal the startup hook's list and are never values.
Kit-owned 2.0.x entries are upgraded in place; user entries are preserved.
At bc1810b, Codex 0.166 started the server in all three cases (15:35Z), with
34 tools listed. The client's list_pages, navigate_page and evaluate_script
calls succeeded through the synthetic proxy, and reuse plus `sbx-chrome restart`
reconnected. The browser's recorded mode is proxy, with the synthetic CA.
The cold arm64 build passed smoke and register-test (18). kit-tck passed 19/19;
the ownership audit and CI script checks passed.

Other clients, by source plus an isolated name probe (no model calls): Claude
Code 2.1.318 and OpenCode 1.19.5 inherit the full environment. Claude's opt-in
CLAUDE_CODE_MCP_ALLOWLIST_ENV passes none of the names. Gemini CLI 0.67.0
redacts names containing CERT (SSL_CERT_FILE, PROXY_CA_CERT_B64) and requires
folder trust; the guest CA file still supplies trust. Cursor is untested
because no official build was 7 days old; its docs are silent. These limits
are scoped in the README. amd64 and native Mac host runs were not repeated.
Evidence is under /home/agent/crew/evidence (outside the repo).

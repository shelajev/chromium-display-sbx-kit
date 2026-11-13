---
# chromium-prox
title: Support SBX credential injection proxy
status: todo
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T13:35:23Z
---

Epic chromium-brow; order 3. Launcher currently unsets proxy variables and
forces no-proxy-server. Establish SBX's browser proxy/CA contract, then implement
trust and routing without certificate-error bypasses or embedding real secrets.
Determine supported protocols, including WebSocket behavior relevant to Teams.

Accept with synthetic destination-scoped injection, redirect/subresource
non-leakage checks, bad-certificate rejection, loopback CDP access and network
denial preservation. Explain any direct mode explicitly; never silently bypass
credential injection on a trust failure. Requires fres for runtime evidence.

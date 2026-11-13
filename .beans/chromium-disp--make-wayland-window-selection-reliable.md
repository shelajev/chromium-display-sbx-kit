---
# chromium-disp
title: Make Wayland window selection reliable
status: in-progress
type: task
priority: critical
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T14:49:40Z
---

Epic chromium-brow; order 2. Reproduce Oleg's two-socket/invisible-window case
in the actual SBX display topology. Select the forwarded display using a
documented contract, preserve valid explicit overrides, report ambiguity and
stale/missing endpoints clearly. Avoid confusing a socket's existence with a
successful visible connection.

Accept with regression coverage for multiple/stale/missing sockets, actual
visible host window plus matching agent CDP target, and headless operation.
Requires fres for final runtime proof; source investigation can proceed earlier.

Verification ownership clarified by Oleg on 2026-11-13: Herdr implements and
tests inside its guest; no nested SBX is expected. The host leader is authorized
to create a scoped candidate SBX with display, check browser/MCP connectivity,
and ping Oleg to verify the visible responsive window and matching test page.
Record human observation separately; visual acceptance remains pending until
that check occurs. See BROWSER-ROADMAP.md for the handoff.

Foundation candidate in progress: refreshed exact pins; protocol-capability display selection and strict overrides; serialized shared-profile lifecycle and safe recovery. Guest build/CDP/MCP/WebMCP/regression evidence and exact host handoff tracked in FOUNDATION-REPORT.md. Independent exact-tip QC plus native amd64 and host/human visible-window/clipboard acceptance remain pending; not complete.

---
# chromium-disp
title: Make Wayland window selection reliable
status: in-progress
type: task
priority: critical
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T19:00:14Z
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

Foundation candidate in progress: refreshed exact pins; protocol-capability display selection and strict overrides; serialized shared-profile lifecycle and safe recovery. Guest build/CDP/MCP/WebMCP/regression evidence and exact host handoff tracked in FOUNDATION-REPORT.md. Historical receipt: that initial candidate awaited QC/native/host acceptance; subsequent 43d68c8 receipts and current changed-head pending checks are recorded below. Clipboard remains unresolved; not complete.

Provenance update: 43d68c817cfe79af0053357349c693230a91400d has independent foundation QC, native AMD64 CI43452000528, and actual SBX v0.53 visible matching-token window/CDP/MCP/WebMCP/restart receipts. Current merge-fix head changes checkout, early Node libs and profile+port/listener ownership; it requires new exact-head QC/native CI and affected-scope host validation. Clipboard remains deferred unresolved; proxy/security/GPU/updater and later backlog remain open. See MERGE-FIXES-REPORT.md; no new human approval/clipboard retry requested.

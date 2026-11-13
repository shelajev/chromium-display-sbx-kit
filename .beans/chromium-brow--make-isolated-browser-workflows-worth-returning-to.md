---
# chromium-brow
title: Make isolated browser workflows worth returning to
status: in-progress
type: epic
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T19:00:14Z
---

Oleg selected Herdr on 2026-11-13. Deliver a reliable Chromium display kit,
proxy/profile security contract, and practical Teams/expense workflow setups.
See BROWSER-ROADMAP.md for ordered tasks, source observations, sequencing and
the first work package's task review contract. Children: fres, disp, prox, secr,
life, help, updt, gpua, ship, team, expe, file, pilt (prefix chromium-).

Plan ready; no implementation run or release accepted. Start with fres/disp and
affected life behavior, then proxy/security, then workflow validation. Each
Herdr run needs its own central task record; this epic is not a run receipt.

Foundation candidate in progress: refreshed exact pins; protocol-capability display selection and strict overrides; serialized shared-profile lifecycle and safe recovery. Guest build/CDP/MCP/WebMCP/regression evidence and exact host handoff tracked in FOUNDATION-REPORT.md. Historical receipt: that initial candidate awaited QC/native/host acceptance; subsequent 43d68c8 receipts and current changed-head pending checks are recorded below. Clipboard remains unresolved; not complete.

Round 2 addresses binding independent QC F1 in chromium-life: safe recovery after same-host PID reuse, with executable/argv ownership checks and focused/full browser regressions. No change to later backlog or pending native amd64 / host window / clipboard gates; candidate awaits fresh exact-tip Claude QC.

Provenance update: 43d68c817cfe79af0053357349c693230a91400d has independent foundation QC, native AMD64 CI43452000528, and actual SBX v0.53 visible matching-token window/CDP/MCP/WebMCP/restart receipts. Current merge-fix head changes checkout, early Node libs and profile+port/listener ownership; it requires new exact-head QC/native CI and affected-scope host validation. Clipboard remains deferred unresolved; proxy/security/GPU/updater and later backlog remain open. See MERGE-FIXES-REPORT.md; no new human approval/clipboard retry requested.

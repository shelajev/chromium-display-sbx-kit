---
# chromium-life
title: Make human agent browser handoff reliable
status: in-progress
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T19:00:14Z
---

Epic chromium-brow; order 5. Person and agent must share the intended profile,
window and CDP target. Support explicit login handoff, graceful restart/reconnect,
stable profile selection and safe stale-lock handling. Investigate real SSO
constraints before promising unattended login or debug-enabled SSO support.

Accept repeat launch without duplicate browser, restart retaining synthetic
login state, correct MCP attachment and recovery diagnostics. Never kill an
unrelated/productive session to recover. Dependencies fres/disp; profile controls
coordinate with secr. Initial affected fixes can join the first work package.

Foundation candidate in progress: refreshed exact pins; protocol-capability display selection and strict overrides; serialized shared-profile lifecycle and safe recovery. Guest build/CDP/MCP/WebMCP/regression evidence and exact host handoff tracked in FOUNDATION-REPORT.md. Historical receipt: that initial candidate awaited QC/native/host acceptance; subsequent 43d68c8 receipts and current changed-head pending checks are recorded below. Clipboard remains unresolved; not complete.

Round 1 independent Claude QC failed F1 (stale same-host lock can name a reused live non-Chromium PID). Round 2 revision inspects stable proc executable/argv identity, recovers proven non-browser stale locks without signaling the process, and preserves Chromium/inaccessible-metadata refusal. Corrected fixture plus real-browser startup/PID-reuse and existing real-owner/MCP restart regressions; results in FOUNDATION-REPORT.md. Fresh exact-tip QC and host/human/native amd64 acceptance remain pending.

Provenance update: 43d68c817cfe79af0053357349c693230a91400d has independent foundation QC, native AMD64 CI43452000528, and actual SBX v0.53 visible matching-token window/CDP/MCP/WebMCP/restart receipts. Current merge-fix head changes checkout, early Node libs and profile+port/listener ownership; it requires new exact-head QC/native CI and affected-scope host validation. Clipboard remains deferred unresolved; proxy/security/GPU/updater and later backlog remain open. See MERGE-FIXES-REPORT.md; no new human approval/clipboard retry requested.

Observed during November14 GPU checks: intermittent `sbx-chrome stop: CDP close
failed` reproduced with unchanged baseline launcher1/8 and patched software
launcher1/8. Evidence retained in operator .local/chromium-repairs/gpu-result/
evidence/implementer-logs/stopprobe-baseline.txt and stopprobe-patched.txt
plus wayland-patched.txt; unchanged lifecycle close/EOF path is the next owner.
Owner: Chromium lifecycle maintainer. Revisit before workflow/demo readiness or
if a final combined/native promised stop/restart check fails. Inspect CDP close/
EOF versus verified owned-process exit; never waive the failure or blindly retry.
GPU checks close their own CDP socket before stop and keep the actual stop/
restart requirement. Later headless/Weston exact-source runs passed; the race
itself remains unfixed and is not claimed resolved by GPU/proxy changes.

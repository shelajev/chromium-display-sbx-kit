---
# chromium-life
title: Make human agent browser handoff reliable
status: in-progress
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T15:07:47Z
---

Epic chromium-brow; order 5. Person and agent must share the intended profile,
window and CDP target. Support explicit login handoff, graceful restart/reconnect,
stable profile selection and safe stale-lock handling. Investigate real SSO
constraints before promising unattended login or debug-enabled SSO support.

Accept repeat launch without duplicate browser, restart retaining synthetic
login state, correct MCP attachment and recovery diagnostics. Never kill an
unrelated/productive session to recover. Dependencies fres/disp; profile controls
coordinate with secr. Initial affected fixes can join the first work package.

Foundation candidate in progress: refreshed exact pins; protocol-capability display selection and strict overrides; serialized shared-profile lifecycle and safe recovery. Guest build/CDP/MCP/WebMCP/regression evidence and exact host handoff tracked in FOUNDATION-REPORT.md. Independent exact-tip QC plus native amd64 and host/human visible-window/clipboard acceptance remain pending; not complete.

Round 1 independent Claude QC failed F1 (stale same-host lock can name a reused live non-Chromium PID). Round 2 revision inspects stable proc executable/argv identity, recovers proven non-browser stale locks without signaling the process, and preserves Chromium/inaccessible-metadata refusal. Corrected fixture plus real-browser startup/PID-reuse and existing real-owner/MCP restart regressions; results in FOUNDATION-REPORT.md. Fresh exact-tip QC and host/human/native amd64 acceptance remain pending.

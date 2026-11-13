---
# chromium-fres
title: Restore current reproducible browser build
status: in-progress
type: task
priority: critical
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T19:00:14Z
---

Epic chromium-brow; order 1. Main validation failed because the pinned Debian
Chromium package disappeared. Choose a current supported version/revision and
compatible MCP/tooling. Preserve immutable dependency identities and seven-day
package-age defaults; urgent security exceptions need an explicit decision.

Accept with real browser/render/shared CDP/MCP/WebMCP and TCK evidence, recording
native ARM64/AMD64 coverage and any remaining gap. Do not silently replace exact
pins with latest or call a stale downloadable image current. Follow BROWSER-ROADMAP.md.

Foundation candidate in progress: refreshed exact pins; protocol-capability display selection and strict overrides; serialized shared-profile lifecycle and safe recovery. Guest build/CDP/MCP/WebMCP/regression evidence and exact host handoff tracked in FOUNDATION-REPORT.md. Historical receipt: that initial candidate awaited QC/native/host acceptance; subsequent 43d68c8 receipts and current changed-head pending checks are recorded below. Clipboard remains unresolved; not complete.

Provenance update: 43d68c817cfe79af0053357349c693230a91400d has independent foundation QC, native AMD64 CI43452000528, and actual SBX v0.53 visible matching-token window/CDP/MCP/WebMCP/restart receipts. Current merge-fix head changes checkout, early Node libs and profile+port/listener ownership; it requires new exact-head QC/native CI and affected-scope host validation. Clipboard remains deferred unresolved; proxy/security/GPU/updater and later backlog remain open. See MERGE-FIXES-REPORT.md; no new human approval/clipboard retry requested.

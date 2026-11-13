---
# chromium-fres
title: Restore current reproducible browser build
status: in-progress
type: task
priority: critical
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T14:49:40Z
---

Epic chromium-brow; order 1. Main validation failed because the pinned Debian
Chromium package disappeared. Choose a current supported version/revision and
compatible MCP/tooling. Preserve immutable dependency identities and seven-day
package-age defaults; urgent security exceptions need an explicit decision.

Accept with real browser/render/shared CDP/MCP/WebMCP and TCK evidence, recording
native ARM64/AMD64 coverage and any remaining gap. Do not silently replace exact
pins with latest or call a stale downloadable image current. Follow BROWSER-ROADMAP.md.

Foundation candidate in progress: refreshed exact pins; protocol-capability display selection and strict overrides; serialized shared-profile lifecycle and safe recovery. Guest build/CDP/MCP/WebMCP/regression evidence and exact host handoff tracked in FOUNDATION-REPORT.md. Independent exact-tip QC plus native amd64 and host/human visible-window/clipboard acceptance remain pending; not complete.

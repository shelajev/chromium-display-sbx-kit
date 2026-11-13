---
# chromium-ship
title: Validate fresh user kit and release artifacts
status: todo
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T13:35:23Z
---

Epic chromium-brow; order 9. Package the accepted changes for external kit users.
Verify actual immutable registry artifacts inside fresh SBX with display and
headless routes, native ARM64/AMD64 coverage and representative Codex/Claude
registration preserving config. Align frontend/TCK and record supported bases,
host/SBX versions, profile/proxy modes and remaining gaps.

Accept exact-state independent QC, existing required build/runtime checks and
repeatable fresh-user commands. Do not call an OCI build or unit test a real
window/login handoff. Depends on foundation work; GPU claims only if gpua proved
them. Follow release workflow for any subsequent publication.

Fresh SBX lifecycle checks belong to the host leader through native SBX control,
not nested execution inside Herdr. Oleg authorized creating a scoped test SBX
and pinging him to check its window. Human-visible display/GPU observations,
host integration checks and guest automated QC are separate evidence. Keep any
unperformed required check pending rather than asking the crew to prove it.

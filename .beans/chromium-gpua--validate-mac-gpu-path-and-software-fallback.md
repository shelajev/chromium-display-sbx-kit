---
# chromium-gpua
title: Validate Mac GPU path and software fallback
status: todo
type: task
priority: normal
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T13:35:23Z
---

Epic chromium-brow; order 8. Record actual custom SBX build/device/driver support
for Mac Vulkan/virtio GPU. Test Chromium acceleration rather than assuming GPU
availability from host hardware. Compare representative rendering, stability,
startup and software fallback before choosing defaults.

Deliver documented auto/software/explicit acceleration behavior as justified by
evidence; do not remove disable flags everywhere. Accept real supported-host
evidence and explicit untested combinations. Depends on fres/disp. This is a
bounded experiment and policy decision, not a promise to support every Mac.

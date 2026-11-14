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

Guest policy update (2026-11-14, central ai-contrib-bgpu v ecfe99f8a514268e):
the launcher no longer force-disables GPU on Wayland/X11. Chromium negotiates,
and `SBX_CHROME_DISABLE_GPU=1` forces software. Guest headless and Weston
Wayland runs with no render device show Chromium's own software fallback,
rendering correctly (task report held outside source by the host). Still
open: actual hardware acceleration (Linux NVIDIA VFIO `--gpu`, any custom Mac
Vulkan/virtio) and a native display check remain untested. Guest policy source accepted; hardware and native-display follow-ups remain open.

# Sourced by launchers; use registry capabilities, never socket numbering.
sbx_detect_display() {
  SBX_OZONE=headless
  unset SBX_DISPLAY_SOCKET
  if [ "${SBX_CHROME_HEADLESS:-0}" = 1 ]; then return 0; fi
  sbx_prefix="${PREFIX:-@PREFIX@}"
  sbx_node="$sbx_prefix/node/bin/node"
  sbx_libs="${LD_LIBRARY_PATH:-}"
  if [ -x "$sbx_node" ]; then
    sbx_libs="$sbx_prefix/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  else
    sbx_node=node
  fi
  sbx_probe="${PREFIX:-@PREFIX@}/libexec/wayland-probe.mjs"
  sock="$(LD_LIBRARY_PATH="$sbx_libs" "$sbx_node" "$sbx_probe")" || return 1
  if [ -n "$sock" ]; then
    SBX_OZONE=wayland
    export SBX_DISPLAY_SOCKET="$sock" WAYLAND_DISPLAY="$sock"
    if [ ! -d "${XDG_RUNTIME_DIR:-}" ] || [ ! -w "${XDG_RUNTIME_DIR:-}" ]; then
      if [ -w "${sock%/*}" ]; then
        export XDG_RUNTIME_DIR="${sock%/*}"
      else
        export XDG_RUNTIME_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/sbx-chromium/runtime"
        (umask 077; mkdir -p "$XDG_RUNTIME_DIR") || return 1
      fi
    fi
    return 0
  fi
  unset WAYLAND_DISPLAY
  if [ -n "${DISPLAY:-}" ]; then
    case "$DISPLAY" in
      :*) sbx_xnum="${DISPLAY#:}"; sbx_xnum="${sbx_xnum%%.*}"; [ ! -S "/tmp/.X11-unix/X$sbx_xnum" ] || SBX_OZONE=x11 ;;
      *) SBX_OZONE=x11 ;;
    esac
  fi
}

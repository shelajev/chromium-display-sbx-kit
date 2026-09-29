# Sourced by the sbx-* launchers. Sets SBX_OZONE to wayland, x11 or headless,
# and exports the socket variables Chromium needs to reach the display.
#
# `sbx run --display` forwards a Wayland socket, but where it lands and which
# variables point at it varies: the agent's shell usually has WAYLAND_DISPLAY
# and XDG_RUNTIME_DIR, while a lifecycle hook sees only what it declares. So
# trust the variables when the socket they name exists, and otherwise look in
# the places sbx puts it.
sbx_detect_display() {
  SBX_OZONE=headless
  if [ "${SBX_CHROME_HEADLESS:-0}" = 1 ]; then
    return 0
  fi
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    case "$WAYLAND_DISPLAY" in
      /*) sock="$WAYLAND_DISPLAY" ;;
      *) sock="${XDG_RUNTIME_DIR:-/run/display}/$WAYLAND_DISPLAY" ;;
    esac
    if [ -S "$sock" ]; then
      export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/display}"
      SBX_OZONE=wayland
      return 0
    fi
  fi
  for dir in "${XDG_RUNTIME_DIR:-}" /run/display "/run/user/$(id -u)"; do
    if [ -n "$dir" ] && [ -S "$dir/wayland-0" ]; then
      export XDG_RUNTIME_DIR="$dir" WAYLAND_DISPLAY=wayland-0
      SBX_OZONE=wayland
      return 0
    fi
  done
  if [ -n "${DISPLAY:-}" ]; then
    SBX_OZONE=x11
  fi
}

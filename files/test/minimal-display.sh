#!/bin/sh
# Owned chroot with only Node's glibc/system dependencies. C++ runtimes exist
# exclusively in the kit prefix, so the early display probe must configure it.
set -eu
: "${PREFIX:?}"
root=$(mktemp -d /tmp/sbx-minimal-display.XXXXXX)
trap 'rm -rf "$root"' EXIT HUP INT TERM
install -d "$root/bin" "$root$PREFIX/node/bin" "$root$PREFIX/libexec" "$root$PREFIX/lib" "$root$PREFIX/chromium"
cp -L /bin/sh "$root/bin/sh"
cp -L "$PREFIX/node/bin/node" "$root$PREFIX/node/bin/node"
cp "$PREFIX/libexec/display.sh" "$PREFIX/libexec/wayland-probe.mjs" "$root$PREFIX/libexec/"
cp "$PREFIX/bin/sbx-chromium" "$root$PREFIX/bin-sbx-chromium"
for lib in libstdc++.so.6 libgcc_s.so.1; do cp -L "$PREFIX/lib/$lib" "$root$PREFIX/lib/"; done
# Include loader and every non-C++ direct system dependency, but never a
# system libstdc++/libgcc path. No host files/profiles are mounted into this root.
for lib in $(ldd /bin/sh "$PREFIX/node/bin/node" | awk '$2 == "=>" && $3 ~ /^\// {print $3} $1 ~ /^\/.*ld-linux/ {print $1}' | sort -u); do
  case "$lib" in *libstdc++*|*libgcc_s*) continue ;; esac
  mkdir -p "$root$(dirname "$lib")"
  cp -L "$lib" "$root$lib"
done
printf '#!/bin/sh\nprintf "%%s\\n" "$@"\n' > "$root$PREFIX/chromium/chromium"
chmod +x "$root$PREFIX/chromium/chromium"
# Direct source detector and ordinary wrapper invocation, no --headless/version
# argument to bypass probing. Library path remains unset in the calling shell.
unset LD_LIBRARY_PATH
chroot "$root" /bin/sh -c 'PREFIX="$1"; . "$PREFIX/libexec/display.sh"; sbx_detect_display; test "$SBX_OZONE" = headless; test -z "${LD_LIBRARY_PATH:-}"' minimal "$PREFIX"
chroot "$root" "$PREFIX/bin-sbx-chromium" --dump-dom about:blank | grep -q -- '--ozone-platform=headless'
echo 'minimal glibc root: early bundled Node with prefix-only C++ libraries: ok'

# syntax=docker/dockerfile:1
#
# The v2 kit shipped no content at all: Chromium, its system libraries, the
# MCP servers and the launcher scripts lived in a saved sandbox template
# (sbx-chromium-claude), and the kit's startup hooks wrote config files into
# the user's workspace on every boot. This builds all of it into the layers
# instead, so the kit composes onto any agent workload and the template goes
# away.
#
# Everything lands in one private prefix, /opt/sbx-chromium:
#
#   chromium/             Debian's Chromium build (not Playwright's: Debian's
#                         is a real, security-maintained package on both amd64
#                         and arm64, and trixie ships >= 150, the WebMCP floor)
#   lib/                  the shared-library closure Chromium and node link,
#                         minus glibc itself
#   share/fonts, etc/fonts  fonts and a fontconfig config that points at them
#                         (the agent templates ship no fonts at all)
#   share/X11/xkb         keyboard data for the Wayland client
#   node/, chrome-devtools-mcp/   the MCP server and the interpreter it runs on
#   bin/                  sbx-chromium, sbx-chrome, sbx-browser-mcp,
#                         sbx-browser-register
#
# Outside the prefix the overlay writes symlinks in /usr/local/bin and nothing
# else — in particular nothing under /home, which on a composed base may be a
# mounted volume.
#
# The one base constraint is glibc >= 2.41 (Debian 13 and newer), because the
# closure is built on trixie. Every dhi.io/sbx-templates base qualifies.

ARG PREFIX=/opt/sbx-chromium

# ── Chromium and its closure ─────────────────────────────────────────────────
# Upstream Debian rather than DHI's debian-base: DHI rebuilds the toolchain
# packages (gcc-14-base …+dhi3) and upstream chromium's dependency chain pins
# the non-DHI versions, so apt refuses to resolve it there.
FROM debian:trixie@sha256:9cc080028c43b27d2074d63a5f9caf7166d731494965616c1a6d2827a004585c AS chromium
ARG PREFIX
ARG CHROMIUM_VERSION
ARG CHROMIUM_DEBIAN_REVISION
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# debian:trixie carries no CA store, and apt goes over HTTPS here: plain HTTP
# to the mirrors is the first thing a locked-down egress policy refuses.
COPY --from=dhi.io/debian-base:trixie-dev@sha256:f18a569e4ed47f382ef551fac547bddcaa050f74565dfe35ba73958810fb8525 \
     /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources

# `proxy-ca` is optional and only matters when building behind a TLS-
# intercepting proxy — inside a Docker sandbox, for example — where apt must
# trust the proxy's CA. It is a secret mount, so it never lands in a layer:
#   docker buildx build … --secret id=proxy-ca,src=/etc/ssl/certs/ca-certificates.crt
# mode=0444 because apt downloads as the unprivileged _apt user.
#
# The chromium pin is exact, and it moves: Debian drops superseded security
# builds from the mirror, so a stale pin fails here with "Version … not
# found" rather than quietly installing something the `provides` entry does
# not describe. Bump both chromium args in chromium-display.yaml.
RUN --mount=type=secret,id=proxy-ca,required=false,mode=0444 <<'EOF'
set -eu
# apt's HTTPS method trusts OpenSSL's default paths (/usr/lib/ssl), which
# debian:trixie does not have, so the bundle is named explicitly — the proxy's
# when one is given, the copied public bundle otherwise.
ca=/etc/ssl/certs/ca-certificates.crt
if [ -s /run/secrets/proxy-ca ]; then ca=/run/secrets/proxy-ca; fi
echo "Acquire::https::CAInfo \"$ca\";" > /etc/apt/apt.conf.d/99ca
apt-get update
apt-get install -y --no-install-recommends \
  "chromium=${CHROMIUM_VERSION}-${CHROMIUM_DEBIAN_REVISION}" \
  fontconfig fonts-liberation fonts-dejavu-core fonts-noto-color-emoji xkb-data
rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99ca
/usr/lib/chromium/chromium --version | grep -q "^Chromium ${CHROMIUM_VERSION} "
EOF

COPY files/fonts.conf /tmp/fonts.conf
RUN <<'EOF'
set -eu
triple="$(uname -m)-linux-gnu"
install -d "$PREFIX/lib" "$PREFIX/etc/fonts" "$PREFIX/share/X11" "$PREFIX/var/cache/fontconfig"

# The browser itself. The Vulkan validation layer and mock ICD are debugging
# aids for GPU driver work; nothing in a sandbox loads them.
cp -a /usr/lib/chromium "$PREFIX/chromium"
rm -f "$PREFIX"/chromium/libVkLayer_khronos_validation.so* "$PREFIX"/chromium/libVkICD_mock_icd.so*

# Libraries Chromium opens by name at run time, which ldd cannot see. NSS
# locates its crypto modules beside libnss3, which is why they land in the
# same directory as the rest. GTK is deliberately absent: Chromium dlopens it
# only for native dialogs and runs without it, and it would bring schemas,
# pixbuf loaders and icon themes along.
dlopened=""
for so in libsoftokn3.so libfreeblpriv3.so libfreebl3.so libnssckbi.so libnssdbm3.so; do
  f="$(find /usr/lib/$triple -name "$so" | head -1)"
  [ -n "$f" ] && dlopened="$dlopened $f"
done

# The closure: everything the binaries and those modules resolve to, except
# glibc, which must come from the base because its loader is the base's.
# libstdc++ and libgcc_s are kept on purpose — the platform floor does not
# promise them, and the bundled node needs them too.
{ ldd "$PREFIX/chromium/chromium" "$PREFIX/chromium/chrome_crashpad_handler"
  for f in "$PREFIX"/chromium/*.so* $dlopened; do ldd "$f" || true; done
} | awk '$2 == "=>" && $3 ~ /^\// {print $3}' | sort -u \
  | grep -Ev '/(libc|libm|libdl|libpthread|librt|libresolv|libutil|libanl|libmvec|ld-linux[^/]*)\.so' \
  > /tmp/closure.txt
for f in $(cat /tmp/closure.txt) $dlopened; do cp -L "$f" "$PREFIX/lib/"; done
wc -l < /tmp/closure.txt

# Fonts, and a fontconfig configuration that finds them without touching the
# base's /etc/fonts. conf.d is copied dereferenced: its entries are symlinks
# into /usr/share/fontconfig, which a base need not have. The cache is built
# now so the first page load does not scan fonts.
cp -a /usr/share/fonts "$PREFIX/share/fonts"
cp -rL /etc/fonts/conf.d "$PREFIX/etc/fonts/conf.d"
sed "s|@PREFIX@|$PREFIX|g" /tmp/fonts.conf > "$PREFIX/etc/fonts/fonts.conf"
FONTCONFIG_FILE="$PREFIX/etc/fonts/fonts.conf" fc-cache -s "$PREFIX/share/fonts"
cp -a /usr/share/X11/xkb "$PREFIX/share/X11/xkb"

# Licences travel with the binaries: an image is a distribution.
install -d "$PREFIX/share/doc"
for pkg in chromium fonts-liberation fonts-dejavu-core fonts-noto-color-emoji; do
  cp -L "/usr/share/doc/$pkg/copyright" "$PREFIX/share/doc/$pkg.copyright"
done
EOF

# ── chrome-devtools-mcp and node ─────────────────────────────────────────────
# The MCP server is a single self-contained npm package (no dependencies), so
# it arrives as a plain tarball; npm pack checks the registry's integrity hash.
# node comes along so the kit does not depend on whether — or which — node a
# workload carries.
FROM dhi.io/node:24-debian13-dev@sha256:1be7f2a3312898e33b59d511b047b033eaf38ecc6fd5d27d9f95ca0fcf1ca2c9 AS mcp
ARG PREFIX
ARG DEVTOOLS_MCP_VERSION
RUN --mount=type=secret,id=proxy-ca,required=false,mode=0444 <<'EOF'
set -eu
if [ -s /run/secrets/proxy-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy-ca; fi
install -d "$PREFIX/node/bin" /tmp/pack
cp -L "$(command -v node)" "$PREFIX/node/bin/node"
# npm unpacks it (this image has no gzip); --ignore-scripts because nothing
# from the registry runs at build time, and the package has none anyway.
npm install --silent --prefix /tmp/pack --ignore-scripts --no-audit --no-fund \
  "chrome-devtools-mcp@${DEVTOOLS_MCP_VERSION}"
test "$(ls /tmp/pack/node_modules)" = chrome-devtools-mcp
cp -a /tmp/pack/node_modules/chrome-devtools-mcp "$PREFIX/chrome-devtools-mcp"
test "$("$PREFIX/node/bin/node" -p "require('$PREFIX/chrome-devtools-mcp/package.json').version")" = "$DEVTOOLS_MCP_VERSION"
EOF

# ── Assemble, and test on a bare base ────────────────────────────────────────
# This stage is where the overlay is put together AND proved: debian-base has
# glibc and almost nothing else — no fonts, no X/Wayland libraries, no NSS —
# so anything the closure missed fails here instead of in a user's sandbox.
# The final stage copies from this one, so what ships is what passed.
FROM dhi.io/debian-base:trixie-dev@sha256:f18a569e4ed47f382ef551fac547bddcaa050f74565dfe35ba73958810fb8525 AS test
ARG PREFIX
ARG CHROMIUM_VERSION
ARG DEVTOOLS_MCP_VERSION
COPY --from=chromium $PREFIX $PREFIX
COPY --from=mcp $PREFIX $PREFIX
COPY --chmod=0755 files/sbx-chromium files/sbx-chrome files/sbx-browser-mcp files/sbx-browser-register $PREFIX/bin/
COPY files/register.mjs files/display.sh $PREFIX/libexec/
COPY files/test /tmp/test
RUN <<'EOF'
set -eu
sed -i "s|@PREFIX@|$PREFIX|g" "$PREFIX"/bin/* "$PREFIX"/libexec/*
# npm tarballs and Debian packages both arrive root-owned here, but normalise
# anyway: a foreign uid in an overlay is a real account on some base.
chown -R 0:0 "$PREFIX"
chmod -R u+rwX,go+rX,go-w "$PREFIX"
EOF
ENV CHROMIUM_VERSION=$CHROMIUM_VERSION DEVTOOLS_MCP_VERSION=$DEVTOOLS_MCP_VERSION PREFIX=$PREFIX
RUN sh /tmp/test/smoke.sh closure
# curl is in the platform floor every workload carries (sbx-chrome probes the
# DevTools port with it); this base just does not have it.
RUN --mount=type=secret,id=proxy-ca,required=false,mode=0444 <<'EOF'
set -eu
ca=/etc/ssl/certs/ca-certificates.crt
if [ -s /run/secrets/proxy-ca ]; then ca=/run/secrets/proxy-ca; fi
echo "Acquire::https::CAInfo \"$ca\";" > /etc/apt/apt.conf.d/99ca
sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/*.sources
# Separate commands, not `update && install`: set -e does not stop on the left
# side of an && list, and that once let this step "pass" without curl.
apt-get update
apt-get install -y --no-install-recommends curl
curl --version | head -1
rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99ca
EOF
RUN sh /tmp/test/smoke.sh
RUN <<'EOF'
set -eu
install -d -m 0755 /out/opt /out/usr/local/bin
cp -a "$PREFIX" "/out$PREFIX"
for bin in sbx-chromium sbx-chrome sbx-browser-mcp sbx-browser-register; do
  ln -s "$PREFIX/bin/$bin" "/out/usr/local/bin/$bin"
done
# `chromium` as a plain command too, for the agent's own headless runs
# (screenshots, --dump-dom, PDFs) — the same wrapper, so the same libraries.
ln -s "$PREFIX/bin/sbx-chromium" /out/usr/local/bin/chromium
EOF

# The overlay: one prefix and five symlinks, landing on any glibc >= 2.41 base.
FROM scratch
COPY --from=test /out /

#!/bin/sh
# Build-time proof, run on a bare glibc base (see the recipe's test stage).
# Everything here exercises the shipped launchers, not stand-ins.
set -eu
: "${PREFIX:?}" "${CHROMIUM_VERSION:?}" "${DEVTOOLS_MCP_VERSION:?}"
export PATH="$PREFIX/bin:$PATH"
export HOME=/tmp/home
# A cross-platform build runs this under QEMU, where Chromium is several
# times slower to start and to answer.
export SBX_CHROME_START_TIMEOUT=180 MCP_TEST_TIMEOUT_MS=300000
mkdir -p "$HOME"
unset WAYLAND_DISPLAY DISPLAY XDG_RUNTIME_DIR
cd "$(mktemp -d)"

# 1. Nothing in the closure is missing on a base that has only glibc.
missing=$(for f in "$PREFIX/chromium/chromium" "$PREFIX/chromium/chrome_crashpad_handler" \
               "$PREFIX"/chromium/*.so "$PREFIX"/lib/*.so* "$PREFIX/node/bin/node"; do
  LD_LIBRARY_PATH="$PREFIX/lib" ldd "$f" 2>/dev/null | grep 'not found' | sed "s|^|$f: |"
done | sort -u)
if [ -n "$missing" ]; then echo "unresolved libraries:"; echo "$missing"; exit 1; fi
# Run alone first, on the untouched base: installing curl for the steps below
# pulls in libraries that could otherwise hide a gap in the closure.
if [ "${1:-}" = closure ]; then echo "closure: ok"; exit 0; fi

# 2. The browser, and the version the descriptor claims.
sbx-chromium --version | tee /dev/stderr | grep -q "^Chromium $CHROMIUM_VERSION "

# 3. A one-shot headless render with real text, so fonts must resolve.
printf '<html><body style="font:48px sans-serif">sbx-chromium renders text</body></html>' > page.html
sbx-chromium --headless --screenshot="$PWD/shot.png" --window-size=800,200 "file://$PWD/page.html" 2>chromium.log \
  || { cat chromium.log; exit 1; }
test "$(wc -c < shot.png)" -gt 4000
sbx-chromium --headless --dump-dom "file://$PWD/page.html" 2>/dev/null | grep -q 'renders text'

# 4. The shared browser: starts headless without a display, answers CDP.
sbx-chrome start
sbx-chrome status | grep -q "Chrome/$CHROMIUM_VERSION"

# 5. The MCP server, end to end, including a WebMCP tool round trip.
"$PREFIX/node/bin/node" /tmp/test/mcp-test.mjs "$PREFIX/bin/sbx-browser-mcp"
sbx-chrome stop

# 6. Registration: only agents present, idempotent, user entries preserved.
mkdir -p fakebin "$HOME/.codex"
for a in claude codex; do printf '#!/bin/sh\n' > "fakebin/$a"; chmod +x "fakebin/$a"; done
printf '{"theme":"dark","mcpServers":{"other":{"command":"x"}}}\n' > "$HOME/.claude.json"
printf 'approval_policy = "never"\n\n[projects."/w"]\ntrust_level = "trusted"' > "$HOME/.codex/config.toml"
PATH="$PWD/fakebin:$PATH" sbx-browser-register
PATH="$PWD/fakebin:$PATH" sbx-browser-register 2>second.log
cat second.log
test "$(grep -c 'already registered' second.log)" = 2
"$PREFIX/node/bin/node" -e '
  const c = require(process.env.HOME + "/.claude.json");
  if (c.theme !== "dark" || !c.mcpServers.other) throw new Error("clobbered existing keys");
  if (!c.mcpServers["chrome-devtools"].command.endsWith("/sbx-browser-mcp")) throw new Error("not registered");'
test "$(grep -c '^\[mcp_servers.chrome-devtools\]' "$HOME/.codex/config.toml")" = 1
grep -q '^approval_policy = "never"' "$HOME/.codex/config.toml"
test ! -e "$HOME/.gemini"
echo "smoke: ok"

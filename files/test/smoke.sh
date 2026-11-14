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
if [ "${1:-}" = closure ]; then
  # This runs before installing curl/system C++ libraries on the bare base.
  # A plain dump-dom exercises early display probing without --headless bypass.
  (unset LD_LIBRARY_PATH; sbx-chromium --dump-dom about:blank 2>/dev/null) | grep -q '<html'
  sh /tmp/test/minimal-display.sh
  echo "closure and early bundled-node display probe: ok"
  exit 0
fi

# 2. The browser, and the version the descriptor claims.
sbx-chromium --version | tee /dev/stderr | grep -q "^Chromium $CHROMIUM_VERSION "

# 3. A one-shot headless render with real text, so fonts must resolve. The
# page lays the text out and rasterises it to a canvas, then reports numbers
# into the DOM: with no usable font both widths and the ink count are 0.
cat > page.html <<'HTML'
<html><body style="margin:0;font:48px sans-serif"><span id="t">sbx-chromium renders text</span><pre id="r"></pre><script>
const t = document.getElementById('t'), box = t.getBoundingClientRect();
const c = document.createElement('canvas'); c.width = 800; c.height = 80;
const g = c.getContext('2d'), text = t.textContent;
g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 80);
g.fillStyle = '#000'; g.font = '48px sans-serif'; g.fillText(text, 0, 60);
const px = g.getImageData(0, 0, 800, 80).data; let ink = 0;
for (let i = 0; i < px.length; i += 4) if (px[i] < 128) ink++;
const width = f => { g.font = f; return g.measureText(text).width; };
document.getElementById('r').textContent = 'RENDER ' + JSON.stringify({w: box.width, h: box.height,
  size: getComputedStyle(t).fontSize, ink, sans: width('48px sans-serif'), mono: width('48px monospace')});
</script></body></html>
HTML
sbx-chromium --headless --dump-dom "file://$PWD/page.html" 2>chromium.log > dom.html \
  || { cat chromium.log; exit 1; }
grep -q 'renders text' dom.html
sed -n 's/.*RENDER \({[^}]*}\).*/\1/p' dom.html > render.json
"$PREFIX/node/bin/node" -e '
  const r = JSON.parse(require("node:fs").readFileSync("render.json", "utf8"));
  console.error("one-shot text render:", JSON.stringify(r));
  if (!(r.w > 300 && r.h > 30 && r.size === "48px")) throw new Error("text did not lay out");
  if (!(r.ink > 1000)) throw new Error("text glyphs did not rasterise");
  if (!(r.sans > 0 && r.mono > 0 && r.sans !== r.mono)) throw new Error("sans-serif and monospace did not resolve to distinct fonts");'

"$PREFIX/node/bin/node" /tmp/test/display-lifecycle-test.mjs

# 4. The shared browser: starts headless without a display, answers CDP.
"$PREFIX/node/bin/node" -e '
 const {execFile} = require("node:child_process");
 const fs = require("node:fs"), os = require("node:os");
 const profile = process.env.HOME + "/.config/sbx-chromium/profile";
 fs.mkdirSync(profile, {recursive:true});
 fs.symlinkSync(os.hostname() + "-" + process.pid, profile + "/SingletonLock");
 const bin = process.env.PREFIX + "/bin/sbx-chrome";
 Promise.all(["start", "start", "start", "--if-display"].map(arg => new Promise((resolve,reject) => execFile(bin,[arg],(e,out,err) => e ? reject(e) : resolve())))).then(() => {
  process.kill(process.pid, 0);
  if (fs.readlinkSync(profile + "/SingletonLock") === os.hostname() + "-" + process.pid) throw Error("stale lock not recovered");
  console.log("live non-Chromium PID reuse -> real browser startup: ok");
 }).catch(e => { console.error(e); process.exitCode=1; });'
sbx-chrome status | grep -q "Chrome/$CHROMIUM_VERSION"

# 5. The MCP server, end to end, including a WebMCP tool round trip.
"$PREFIX/node/bin/node" /tmp/test/mcp-test.mjs "$PREFIX/bin/sbx-browser-mcp"
sbx-chrome stop
"$PREFIX/node/bin/node" /tmp/test/port-ownership-test.mjs
# GPU policy on this base, which has no render device: Chromium's default
# negotiation and the explicit software override both render correctly.
"$PREFIX/node/bin/node" /tmp/test/gpu-fallback-test.mjs "$PREFIX/bin/sbx-chrome" default headless
SBX_CHROME_DISABLE_GPU=1 "$PREFIX/node/bin/node" /tmp/test/gpu-fallback-test.mjs "$PREFIX/bin/sbx-chrome" software headless

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

# Existing single-quoted TOML server headers are user configuration too.
printf "[mcp_servers.'chrome-devtools']\ncommand = \"custom\"\n" > "$HOME/.codex/config.toml"
cp "$HOME/.codex/config.toml" before.toml
PATH="$PWD/fakebin:$PATH" sbx-browser-register
cmp before.toml "$HOME/.codex/config.toml"

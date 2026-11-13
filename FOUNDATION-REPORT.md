# Chromium foundation candidate — 2026-11-13

Scope: first `chromium-fres`, `chromium-disp`, and affected `chromium-life`
package, descending from planning baseline `dda14406c0017b550704b490db3da76a0c01bb0d`.
This is a guest-tested candidate for independent exact-tip Claude QC. Native
host display/clipboard acceptance and external release are separate gates.
The candidate identity is the commit containing this report (`git rev-parse HEAD`
on the clean candidate checkout); the crew status records its exact SHA.

## Round 2 — binding QC F1 revision

Independent Claude QC **failed** round 1 at
`ef5c7a84fa077508428af77ced68429347f322d9`: the same-host SingletonLock
pre-check refused any live PID, preventing recovery after a persistent stale
lock's PID was reused by a non-Chromium process. The round 1 receipt below is
historical implementation evidence, not acceptance; its broad "live owner"
wording is corrected by the ownership rules here. The independent failure and
all earlier failed/recovered attempts remain recorded in crew QC/evidence logs.

The revised check reads `/proc/<pid>/exe`, executable inode identity and
NUL-separated argv, with process-start-time and executable-identity checks to
refuse unstable metadata. Chromium executable/argv names (including alternate
Chrome paths) or the bundled binary's inode remain protected, regardless of
CDP port. Missing, inaccessible (`EACCES`/`EPERM`), empty or unstable live-process
metadata also remains protected. Only a provably non-Chromium live PID, a dead
PID or an old hostname permits stale Singleton cleanup. Recovery never signals
the lock-named process. This fixes the kit pre-check without trusting PID
liveness as proof of browser ownership.

The fixture now expects stale lock recovery for its own live non-Chromium Node
PID, verifies launch was attempted and the process remains alive, and adds
Chromium-looking argv plus injected proc-permission-denial refusal checks.
Build smoke seeds the real shared profile lock with a live non-Chromium PID
before concurrent cold launches, verifies Chromium takes over that lock and
the unrelated process stays alive, then runs the preserved real Chromium
other-port owner refusal and MCP/WebMCP/restart/cookie/localStorage tests.
Round 2 native arm64 build **passes** with all preserved smoke checks, the
new PID-reuse and metadata-boundary regressions, and the existing real Chromium
other-port protection plus MCP/WebMCP/restart/cookie/localStorage tests. TCK
m.12 **19/19 passes**; ownership **968 entries, all 0/0**; shell/JS syntax,
Beans and git whitespace checks pass. Agent configuration hashes match the
round-2 before/after baseline. Logs are retained under
`/tmp/chromium-foundation-evidence/round2/` (`targeted-permissions.log`,
`build-final.log`, `tck.log`); the OCI layout is
`/tmp/chromium-display-layout-round2-final`, manifest
`sha256:b32b1097f75bc6e14697096d5ed27859ad2f526bc573da7519cd9eb5cd68d238`.
The unchanged display code's Weston/live-bridge checks are round-1 receipts,
not newly rerun round-2 claims. Fresh independent exact-tip QC is pending.
Host/native amd64/clipboard acceptance remains pending; no later Bean is closed.

## Guest verification receipt

Verified on native Linux arm64 in this guest: full recipe build and preserved
closure/render/DOM/CDP/MCP/WebMCP/registration smoke, display/lifecycle
regressions, concurrent cold/repeat start, escaped URL/fragment preservation,
live Chromium profile-owner protection, restart/MCP reattachment and persistent
synthetic cookie/localStorage. TCK m.12: **19/19 passed**. Overlay audit: **968
entries, all uid/gid 0/0**. Shell/JS syntax, Beans links and git whitespace checks
pass. Only the four scoped Beans changed; unrelated agent config hashes match
before/after. Both real Weston arrangements pass, as does the live guest
clipboard bridge -> headless browser/MCP/WebMCP/restart check in isolated HOME.

Logs of baseline, failed, and recovered attempts remain in the guest at
`/tmp/chromium-foundation-evidence/`; these are development evidence, not an
export of any user session. The first intermediate build was canceled after
WebMCP; the synthetic HTTP fixture now closes all connections during teardown.
The persistent-cookie regression failed before CDP shutdown was added and
passes afterward. A stale-socket fixture initially asserted an alias pathname;
its corrected assertion compares endpoint inode identity, preserving dedup
coverage. The initial TCK attempt ran before OCI export finished; the completed
artifact validates successfully. The last optional compositor rerun encountered `ENOSPC` in Docker's writable
layer; it passes with owned tmpfs directories and the identical repository test
fixtures streamed over stdin. No daemon/cache/infrastructure repair was done.
No required failing check is waived.

## Reproductions and choices

* Baseline exact Chromium-stage build failed: `E: Version
  '154.0.8037.57-1~deb13u1' for 'chromium' was not found`.
* Baseline detector returned `wayland` against this guest's live clipboard bridge.
  Its registry contains only `wl_seat` and `zwlr_data_control_manager_v1`.
  A two-socket fixture also chose clipboard `wayland-0`, ignoring `wayland-1`.
* An ephemeral baseline launcher deleted a current-host live owner's
  `SingletonLock` when CDP was absent. The candidate refuses live owners and
  foreign CDP listeners, leaves them alive, and never exports profile data.
* Initial restart regression found SIGTERM lost a fresh persistent cookie while
  retaining local storage. Healthy shutdown now uses CDP `Browser.close` and
  waits for exit. SIGTERM is limited to explicitly managed unhealthy browsers;
  there is no SIGKILL recovery. Readiness timeout leaves the session for inspection.
* Lifecycle implementation uses bundled Node, exact NUL-separated `/proc` argv,
  and Linux abstract Unix sockets keyed by canonical profile for serialization.
  Kernel cleanup handles launcher death without unsafe stale lifecycle-lock files.
* Wayland selection requires `wl_compositor` plus `xdg_wm_base`, deduplicates
  socket inode aliases, and refuses unresolved ambiguity. Strict overrides fail
  closed; forced headless/version requests bypass discovery. No fixed forwarded
  socket topology is assumed. Diagnostics expose registry/session metadata only.
* `sbx-browser-mcp` fails closed if shared-session startup fails and adds loopback
  to both proxy bypass variables. Registration preserves unrelated configuration,
  including single-quoted Codex server tables. All tests use isolated HOME.

Pins independently checked on 2026-11-13:

| Component | Pin | Evidence / age |
| --- | --- | --- |
| Chromium | `156.0.8078.79-1~deb13u1` | Debian trixie-security arm64 Packages and pool listings for amd64/arm64; Nov 2 publication |
| chrome-devtools-mcp | `1.12.0` | npm registry `time`: Oct 22; newer Nov 11 release excluded |
| Debian image | `sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6` | immutable multi-arch index, image created Nov 4 |
| kit-tck | `v3.0.0-m.12` | Go proxy module info: Nov 4, commit `6b0bc2504942eb9335447d5035425536d9c495d6` |

The existing immutable DHI Node/base pins are retained. npm 11.20.0's
`min-release-age` is measured in days: the build enforces and asserts `7`.
No package-age setting was disabled. Debian security mirrors can still remove
superseded exact pins: this verifies availability now, not indefinite archival
reproducibility; the weekly updater remains a later Bean. TCK m.12's upstream `replace` directives
prevent `go install package@version`; `tools/install-kit-tck.sh` downloads the
checksum-verified pinned module and builds it as main module, retaining those
replacements. No upstream files or infrastructure are repaired.

Sources: [Debian security pool](https://deb.debian.org/debian-security/pool/updates/main/c/chromium/),
[npm metadata](https://registry.npmjs.org/chrome-devtools-mcp),
[TCK module info](https://proxy.golang.org/github.com/docker/sandbox-kit-spec/v3/@v/v3.0.0-m.12.info).

## Reproduce guest checks

Run these inside the authorized Linux guest or native CI, at the candidate
commit, with Docker Buildx and Go available. Do not run nested SBX or project
scripts on the host. Only CA certificate trust is passed as a build secret.

```sh
node files/test/display-lifecycle-test.mjs
docker buildx build . -f chromium-display.yaml \
  --secret id=proxy-ca,src=/etc/ssl/certs/ca-certificates.crt \
  --build-arg kitVersion=0.0.0-ci.local \
  -t chromium-display:0.0.0-ci.local \
  --output type=oci,dest=/tmp/chromium-display-layout,tar=false
sh tools/install-kit-tck.sh /tmp/chromium-foundation-bin/kit-tck
/tmp/chromium-foundation-bin/kit-tck validate \
  --layout /tmp/chromium-display-layout 0.0.0-ci.local
bash -n run.sh
for f in files/sbx-* files/display.sh files/test/smoke.sh tools/*.sh; do sh -n "$f"; done
for f in files/*.mjs files/test/*.mjs tools/*.mjs; do node --check "$f"; done
beans check
git diff --check
owners=$(for blob in /tmp/chromium-display-layout/blobs/sha256/*; do
  tar --numeric-owner -tvf "$blob" 2>/dev/null
 done | awk '{print ($2 ~ /\//) ? $2 : $3"/"$4}' | sort -u)
printf '%s\n' "$owners"
test -z "$(printf '%s\n' "$owners" | grep -Ev '^(0/0|1000/1000)$')"
```

The recipe retains bare-base closure, exact versions, font screenshot, DOM,
shared CDP, MCP navigation/snapshot, WebMCP arithmetic, and registration checks.
It adds clipboard/compositor/timeout/stale/alias/ambiguity/override/headless
fixtures, safe live-lock/foreign-port refusal, concurrent cold/repeat launches,
real live Chromium owner protection, and restart with the MCP stdio process
still open, verifying persistent synthetic cookie and localStorage plus WebMCP.

Optional real guest Wayland check, without host display access:

```sh
cat chromium-display.dockerfile tools/wayland-stage.dockerfile > /tmp/wayland.dockerfile
docker buildx build . -f /tmp/wayland.dockerfile --target wayland-integration \
  --build-arg CHROMIUM_VERSION=156.0.8078.79 \
  --build-arg CHROMIUM_DEBIAN_REVISION=1~deb13u1 \
  --build-arg DEVTOOLS_MCP_VERSION=1.12.0 \
  --secret id=proxy-ca,src=/etc/ssl/certs/ca-certificates.crt \
  -t chromium-foundation-wayland:local --load
# Memory-backed test data also works when Docker writable-layer space is tight.
# Stream only synthetic test fixtures because /tmp in the image is masked.
tar -cf - -C files/test . | docker run --rm -i \
  --tmpfs /tmp:rw,mode=1777,size=512m \
  --tmpfs /run/display:rw,uid=1000,gid=1000,mode=0755,size=4m \
  --entrypoint sh chromium-foundation-wayland:local \
  -c 'mkdir /tmp/test; tar -xf - -C /tmp/test; exec /opt/sbx-chromium/node/bin/node /tmp/test/wayland-test.mjs'
docker image rm chromium-foundation-wayland:local
```

This installs signed Debian Weston libraries into an owned ephemeral test image,
runs as uid/gid 1000, and checks real Ozone Wayland with a clipboard-only
`wayland-0` beside compositor `wayland-1`, then a compositor at read-only
`/run/display/wayland-0`, using a writable separate runtime directory.
It exercises CDP, MCP, WebMCP and restart/persistence in both arrangements.
The initial optional DHI-based Weston image failed dependency resolution;
using the recipe's Debian stage avoids mixing DHI and Debian library revisions.

## Host leader / Oleg handoff (pending)

Requirements: native supported SBX (record exact build; current host reports
0.53.0), experimental features and sandbox display enabled, and
`clipboard.textCopy=true` (already authorized/enabled). SBX 0.53 has no
`clipboard.textPaste` setting. Read back settings; do not alter unrelated ones.
No host credentials, profiles, SSH mounts, real accounts, or new network grants
are needed. Candidate runtime requires Linux with glibc >= 2.41, the normal
SBX platform floor, and forwarded display for the visual check.

Host leader uses native SBX CLI from the exact clean candidate checkout:

```sh
candidate=/Users/shelajev/ai-contrib/.herdr-workspaces/chromium-foundation
git -C "$candidate" status --porcelain
git -C "$candidate" rev-parse HEAD
sbx version
test_ws="$(mktemp -d /tmp/sbx-chromium-verify.XXXXXX)"
cp "$candidate/tools/handoff-page.mjs" "$test_ws/handoff-page.mjs"
sbx run docker.io/docker/sbx-kit-codex:0.157.0 --display \
  --kit "$candidate" --name chromium-foundation-check "$test_ws"
```

`--kit` is the supported local kit build/install/composition route. Do not run
`run.sh`, Node, or other project code on the host. In the new sandbox only:

```sh
sbx-chrome diag
sbx-chrome status
node handoff-page.mjs > /tmp/chromium-handoff-page.json &
```

Read the harmless URL/token from that file. Through the registered MCP, navigate
to it, take a snapshot, list WebMCP tools, and execute `identify` with `{}`.
Record that it matches the page token; verify diag reports one managed browser
and the actual compositor path/globals. Run `sbx-chrome restart <same-URL>`,
repeat `start`, and repeat MCP navigation/snapshot/identify on the same MCP
connection. Never dump page/profile/session contents into diagnostics.

Ping Oleg to confirm the same token is visible in a responsive desktop window
and the response button works. Ask him to copy the harmless `-copy` text out
to the host, then copy the reported `pasteUrl` on the host and paste it into
Chromium's address bar; confirm the page shows `Path: pasted`. Guest fixtures,
OCI, and Weston results cannot establish these human observations.

Record candidate SHA, SBX build, actual socket topology, automated results and
human observations separately on central `ai-contrib-brws` (host-owned; read
version was `b1c6c491d1687900`). Clean up only the owned test sandbox/workspace
using the installed SBX CLI lifecycle commands after recording results. Do not
remove the running crew sandbox or change productive sessions.

Native linux/amd64 build/smoke is also pending before portability/release claims;
package availability and multi-arch image metadata do not prove execution.
The four scoped Beans remain in-progress. All later Beans stay intact: proxy
routing/CA/injection and profile security are next, followed by the roadmap.
Existing direct proxy bypass, basic password store, no-sandbox, and software
GPU flags remain current implementation choices, with their investigations
deferred. No PR triggers, pushes, tags, publication, or account actions added.

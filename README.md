# Chromium + DevTools MCP — Sandbox Kit

A Docker Sandboxes **mixin** kit that gives any agent a real browser:

- **Chromium 156** (Debian's build, amd64 + arm64) with its own libraries and
  fonts, so it runs on bases that have neither.
- The **`chrome-devtools` MCP server**, attached to that browser, with the
  **WebMCP** tools on: pages that expose tools through WebMCP
  (`document.modelContext` in Chromium 156) can be listed (`list_webmcp_tools`) and called (`execute_webmcp_tool`).
- Automatic MCP registration for whichever agent is installed — Claude Code,
  Codex, Gemini CLI, Cursor, OpenCode — in that agent's user config.

With `sbx run --display` the browser is a window on your desktop, and you and
the agent drive the same one. Without a display it runs headless.

## Quick start

`--display` is still behind feature flags:

```bash
sbx settings set platform.allowExperimentalFeatures true
sbx settings set feature.sandbox-display true
```

Compose the kit onto an agent workload:

```bash
sbx run docker.io/docker/sbx-kit-claude:2.1.278 --display \
  --kit docker.io/olegselajev241/sbx-chromium-display:2.0.3 \
  --name claude-browser .
```

Or with Codex:

```bash
sbx run docker.io/docker/sbx-kit-codex:0.166.0 --display \
  --kit docker.io/olegselajev241/sbx-chromium-display:2.0.3 \
  --name codex-browser .
```

Reattach with `sbx run --name claude-browser`.

### Upgrading from 1.x (the v2 kit)

The old command needed a saved template with Claude baked in:

```bash
# old — no longer needed
sbx run claude --display --template docker.io/olegselajev241/sbx-chromium-claude:latest \
  --kit docker.io/olegselajev241/sbx-chromium-display:latest ...
```

Drop `--template`: the browser is in the kit now, so you get the agent
workload's current version and the kit's layers are cached like any image —
nothing is installed while the sandbox comes up.

Two other changes:

- **Playwright MCP and SLICC are gone.** There is one browser and one MCP
  server. The chrome-devtools server covers navigation, input, snapshots,
  screenshots, network and console.
- **Nothing is written into your workspace.** The v2 kit merged
  `chrome-devtools` and `playwright` entries into the workspace `.mcp.json` and
  appended a section to `CLAUDE.md` on every boot. Remove those from repos you
  used it in — a workspace `.mcp.json` entry overrides the user-level one this
  kit registers, and its `playwright` entry points at a config that no longer
  exists.

## Using it

Ask the agent to open a page — it uses the MCP tools. In the shell:

| Command | What |
| --- | --- |
| `sbx-chrome` | start the shared browser if needed (headed with a display) |
| `sbx-chrome <url>` | open a URL in a new tab |
| `sbx-chrome status \| stop \| restart` | manage it |
| `chromium --headless --screenshot=out.png <url>` | one-shot runs, separate from the shared browser |
| `sbx-browser-register` | re-add or upgrade the MCP entry in installed agents' configs |

The shared browser listens on `127.0.0.1:9222`
(`CHROME_REMOTE_DEBUGGING_PORT`), keeps its profile in
`~/.config/sbx-chromium/profile` and logs to
`~/.local/state/sbx-chromium/chrome.log`. The MCP server starts the browser on
demand, so the tools also work after you close the window.

### WebMCP

WebMCP lets a page publish tools for agents. Chromium 156 exposes it as
`document.modelContext` (the draft spec says `navigator.modelContext`; feature-
detect both), and only with `--enable-features=WebMCP`, which the kit's
launcher always passes:

```js
(navigator.modelContext || document.modelContext).registerTool({
  name: 'add',
  description: 'Adds two numbers',
  inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
  execute: async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
});
```

The MCP server runs with `--categoryExperimentalWebmcp=true`, so after `navigate_page` the agent can call
`list_webmcp_tools` and `execute_webmcp_tool`. The build tests exactly this
round trip.

## Network policy

The kit declares **no** network grants. v2 allowed npm, the Playwright CDNs,
GitHub and six Ubuntu mirrors — all for installs at create, which no longer
happen. Which sites an agent-driven browser may open is your call, not the
kit's: allow them with `sbx policy allow network <host>` or approve requests as
they come.

SBX normally supplies `HTTP_PROXY`, `HTTPS_PROXY`, and its proxy certificate authority (CA), usually at `/usr/local/share/ca-certificates/proxy-ca.crt` inside the guest. Chromium uses that proxy and imports the current CA into the guest's `~/.pki/nssdb`, preserving credential injection and HTTP request rules. The default `auto` mode requires the proxy when proxy variables are configured; invalid proxy or CA inputs then prevent startup or attachment. A sandbox CA without proxy variables also causes an error. An environment with neither proxy inputs nor sandbox CA runs direct. Explicit `SBX_PROXY_MODE=proxy` always requires the proxy. To require the proxy, run this in the sandbox shell with SBX's supplied inputs intact:

```sh
SBX_PROXY_MODE=proxy sbx-chrome restart
```

A caller requiring the proxy refuses to reuse a managed browser whose recorded launch is direct, unknown, or different. Compatible reuse requires the same proxy endpoint, CA, and exact applied `NO_PROXY` bypass-list text, including the launcher's local-address additions. `auto` with configured proxy inputs and explicit `proxy` can reuse the same compatible proxied launch. A refusal keeps the browser and profile intact; there is no automatic restart. A deliberate restart with valid inputs applies the caller's settings. Invalid restart inputs preserve the existing browser, and `sbx-chrome stop` remains available.

Each process has its own environment: terminal exports do not update a running browser, agent, or MCP server. The MCP server attaches to a compatible managed shared browser, or starts one using its own environment when none is running. `sbx-chrome restart` changes only the managed browser's launch environment. To change what a running agent or MCP server sees, restart that process with the intended environment too; terminal exports alone cannot repair its stale configuration.

Run `sbx-chrome diag` in the sandbox shell, even with Chromium stopped. It reads only its own invocation environment, not the environment of a separate running agent or MCP server. `proxyCallerEnvironment` describes that invocation's configuration; `proxyRunningBrowser` describes the recorded browser launch and whether it matches the caller. These are configuration records, not an attestation of live network traffic. Diagnostics omit proxy URLs and credentials.

Use `SBX_PROXY_MODE=direct` only for a user-requested bypass, and restart to switch an existing browser. Direct mode loses credential injection and HTTP request rules; network-level sandbox restrictions remain. Proxy injection does not keep website passwords, login cookies, or other browser-profile data out of the guest or hide them from its same-user agent.

### What each agent passes to the MCP server

An agent launches `sbx-browser-mcp` using the environment available to that agent, subject to its MCP forwarding rules. When the server starts Chromium, its launch settings come from that environment. An existing browser keeps its launch settings. When `sbx-browser-mcp` requires the proxy, it checks that the recorded proxy endpoint, CA and applied `NO_PROXY` list match its current configuration before attaching, and refuses attachment if they differ; attachment does not change the running browser's environment. Starting the browser manually cannot repair missing MCP variables, because the server validates its own configuration before attaching.

The relevant settings are `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (and their lowercase forms), `SSL_CERT_FILE`, `PROXY_CA_CERT_B64`, `SBX_PROXY_CA_FILE`, `SBX_PROXY_MODE`, `WAYLAND_DISPLAY`, `DISPLAY`, `XDG_RUNTIME_DIR`, `SBX_WAYLAND_SOCKET`, `SBX_CHROME_HEADLESS`, `SBX_CHROME_DISABLE_GPU`, and `CHROME_REMOTE_DEBUGGING_PORT`. Each client decides what its MCP child inherits. In Codex, the Chromium SBX mixin configures the `env_vars` forwarding list in the guest user-level `config.toml` with these names, without writing their values. In default `SBX_PROXY_MODE=auto`, a sandbox CA indicates that a proxy is expected; missing proxy variables then cause startup or attachment to be refused. The error `no proxy variable reached the browser` indicates that required proxy settings did not reach the MCP server. Configured proxy use also requires a current valid CA source; missing or invalid trust causes refusal, not a direct connection. To change an agent or MCP server's environment, relaunch that process from the intended guest environment. Use `sbx-chrome restart` from the intended guest environment to change the browser's launch settings; it preserves the browser profile.

The findings below use client-source inspection and isolated child-environment probes at the named versions. Only Codex was also checked against the mixin's real browser.

- **Codex 0.166.0.** Codex starts stdio MCP servers with a filtered environment. Its core names and CA-bundle paths are retained, while additional names must be listed in the server's `env_vars`. New mixin-managed entries include the list. Chromium mixin releases 2.0.0 through 2.0.2 generated entries without it. For a supported entry using the mixin's managed server command, `sbx-browser-register` adds missing names while retaining other settings and user-added names. It runs during creation and each boot, and you can run `sbx-browser-register` with no arguments from any directory in the sandbox shell. It uses the guest user's home and `CODEX_HOME` if set. Complex or uncertain entries, including an entry running a different command, are preserved. If the helper prints names to add, review its guidance rather than assuming the registration changed. Restart a running Codex session after updating its registration, because it has already read its configuration.
- **Claude Code 2.1.318.** By default, MCP servers inherit the agent's full environment. With `CLAUDE_CODE_MCP_ALLOWLIST_ENV=1`, the probe found that the required proxy and browser-control names were not forwarded; the mixin does not override this setting. Missing proxy variables with the sandbox CA present cause refusal.
- **OpenCode 1.19.5.** Its MCP child inherits the agent's full environment.
- **Gemini CLI 0.67.0.** Its credential-name filtering removes `SSL_CERT_FILE` and `PROXY_CA_CERT_B64`; the probe retained the proxy variables. The browser launcher used by `sbx-browser-mcp` can still discover the sandbox CA in `/usr/local/share/ca-certificates/proxy-ca.crt` or the SBX-marked CA block in `/etc/ssl/certs/ca-certificates.crt`. If the environment's only CA source was the filtered `PROXY_CA_CERT_B64`, startup is refused. That customized environment needs the CA provisioned through a source the server can read; the mixin does not bypass trust checks. Gemini also requires a trusted folder for user-level stdio MCP servers. The mixin does not override either policy.
- **Cursor.** MCP environment inheritance was not tested for this change, and Cursor's documentation does not establish the required forwarding behavior. A missing-variable error means the required proxy environment did not reach MCP; inspect both the agent's launch environment and its MCP forwarding configuration.

Do not switch to direct mode (bypassing the proxy) to work around missing proxy variables. A compatible already-running browser can be reused, but it cannot supply missing configuration to the MCP server.

## How it works

`chromium-display.yaml` is the v3 descriptor, `chromium-display.dockerfile`
builds the content. Everything lives under `/opt/sbx-chromium`:

| Path | What |
| --- | --- |
| `chromium/` | Debian's Chromium, pinned (`chromium`, `chromiumDebianRevision` args) |
| `lib/` | the library closure Chromium and node link, minus glibc |
| `share/fonts`, `etc/fonts` | Liberation, DejaVu, Noto Color Emoji and a private fontconfig config |
| `share/X11/xkb` | keyboard data for the Wayland client |
| `node/`, `chrome-devtools-mcp/` | the MCP server (pinned, `devtoolsMcp` arg) and its runtime |
| `bin/` | `sbx-chromium`, `sbx-chrome`, `sbx-browser-mcp`, `sbx-browser-register` |

Outside the prefix the overlay adds only symlinks in `/usr/local/bin` — nothing
under `/home`. MCP registration can't be a layer (each agent kit also writes
those files), so a create-time hook merges the entry in after the agent's own
hooks (`integrates:` orders them), and a boot-time hook re-adds it if an agent
rewrote its config. Both leave an entry you changed alone.

The one base requirement is **glibc ≥ 2.41** (Debian 13 or newer), which every
`dhi.io/sbx-templates` base meets.

### Building it

The build proves what it ships: it assembles the overlay on a bare
`dhi.io/debian-base` (glibc and little else), checks every library resolves,
renders a page with text, starts the shared browser, and drives the MCP server
over stdio through a WebMCP tool call. Only then is the overlay copied out.

```bash
docker buildx build . -f chromium-display.yaml \
  --platform linux/amd64,linux/arm64 --push \
  -t docker.io/olegselajev241/sbx-chromium-display:2.0.0 \
  -t docker.io/olegselajev241/sbx-chromium-display:latest
```

Building inside a sandbox (or behind any TLS-intercepting proxy), hand the
build the proxy's CA as a secret; it is mounted only for the download steps and
never lands in a layer:

```bash
docker buildx build . -f chromium-display.yaml \
  --secret id=proxy-ca,src=/etc/ssl/certs/ca-certificates.crt ...
```

**Bumping Chromium:** Debian drops superseded security builds from the mirror,
so the pin eventually stops resolving and the build fails with `Version … not
found`. Update the `chromium` and `chromiumDebianRevision` defaults in
`chromium-display.yaml` to the current trixie-security version.

### Local development

Point `--kit` at this directory; `sbx` builds it with your local Docker (Docker
Desktop must be running) and caches the result by source hash:

```bash
cd ~/your-project
sbx run docker.io/docker/sbx-kit-claude:2.1.278 --display \
  --kit ~/path/to/chromium-display-sbx-kit \
  --name claude-browser .
```

`run.sh` wraps the same command.

### CI and releases

- `.github/workflows/validate.yml` runs on every push to `main`: it builds the
  kit (which runs the smoke test), checks it with `kit-tck`, and audits file
  ownership.
- `.github/workflows/publish.yml` runs on any `v<version>` tag, builds
  `linux/amd64` and `linux/arm64` each on a native runner (Chromium's smoke
  test does not survive QEMU), and merges them into
  `docker.io/$DOCKERHUB_USERNAME/sbx-chromium-display:<version>`, plus
  `:latest` unless the tag is a pre-release (`v2.1.0-rc1`). The tag is passed
  into the descriptor as `kitVersion`, so it is also the version inside the
  image.
  It needs the repository variable `DOCKERHUB_USERNAME` and the secret
  `DOCKERHUB_TOKEN`.

To release, tag and push — no file to edit:

```bash
git tag v2.0.0
git push origin v2.0.0
```

## License

Apache 2.0 for the kit itself. See [LICENSE](LICENSE); the shipped components'
licences are listed in the descriptor and their notices are under
`/opt/sbx-chromium/share/doc`.

### Display and session recovery

`sbx-chrome` probes Wayland registry globals for `wl_compositor` and
`xdg_wm_base`. A clipboard-only socket is not a display. A unique compositor
wins; multiple compositors require a valid ambient `WAYLAND_DISPLAY` or strict
`SBX_WAYLAND_SOCKET=/path/to/socket`. A relative override resolves under
`XDG_RUNTIME_DIR` (default `/run/display`). Missing/stale/clipboard-only overrides
fail. With no compositor, local X11 requires its socket; otherwise the browser
runs headless. `SBX_CHROME_HEADLESS=1` always forces headless. One-shot
`sbx-chromium --headless` and version queries bypass display selection.

`sbx-chrome diag` reports safe display/session metadata and CDP target count,
without page URLs, titles, or profile contents. Lifecycle operations serialize
per canonical profile using Linux abstract Unix sockets, automatically released
on process death. A live profile owner or foreign CDP listener is never killed
or clobbered. `restart [URL]` waits for graceful shutdown and retains the profile;
the existing MCP connection reconnects. Browser logs may contain browsing data:
inspect locally only when needed, never export them as safe diagnostics.

WebMCP pages should use `navigator.modelContext || document.modelContext` while
Chromium transitions the experimental API. See [candidate verification and host
handoff](FOUNDATION-REPORT.md) for exact build/test commands and pending native
host/human acceptance. Profile security, GPU validation, and
release readiness remain subsequent work packages.
## Weekly dependency maintenance

After this workflow is merged to the default branch (`main`), **Weekly pin
maintenance** runs every Monday at 08:17 UTC, or through `workflow_dispatch`.
Scheduled runs propose updates; manual runs default to a report-only dry run.
The report and JSON artifact distinguish `no-change`, `update` and `failure`.
For a local read-only check (Node 24, curl, xz, dpkg and Docker Buildx required):

```sh
node tools/maintain-pins.mjs --dry-run
```

The tool reads Debian's trixie/security/updates package indices, the official
npm registry, the Go module proxy, and Docker Hub/DHI OCI APIs. It updates
Chromium and its Debian revision together, chrome-devtools-mcp, kit-tck, and
the three pinned base/builder image digests. OCI metadata is read with
`docker buildx imagetools inspect`, using Docker's existing registry resolver
for authentication challenges and redirects. The updater does not read credential
stores, implement token authentication, or log registry response bodies. It hashes
raw indices itself and resolves configs from the immutable index digest; Buildx
verifies platform/config content against the descriptors. Both amd64 and arm64 must exist
for shared Chromium and OCI pins. Debian versions use dpkg ordering; TCK
milestones use semantic version ordering. MCP updates must retain the bundled
launcher path, dependency-free packaging and a recognized Node 24-compatible
engine range. A changed packaging contract is reported for human review.

New pins must be at least seven days old. Debian uses the newer package
Last-Modified time across the two architectures; npm uses registry release
time; Go uses module proxy Time; OCI uses the newer platform config creation
time. These are upstream metadata observations, not claims about a security
advisory's publication date. A younger release is held with its exact maturity
time. Current pins are checked for disappearance. A vanished Debian pin must
have a mature common replacement or the run fails with recovery instructions;
there is no silent age relaxation, downgrade or single-architecture fallback.
An unreachable/invalid source also fails before any pin files are written.

For an urgent security fix, manually dispatch from `main` with `dry_run=false`,
`urgent_security_allow` set to comma-separated **exact** targets, such as
`chromium=156.0.8078.90-1~deb13u2`, and a nonempty `security_justification`
naming the advisory and reason. Supported component names are `chromium`, `nss`,
`devtoolsMcp`, `kit-tck`, `debian`, `debian-base`, and `node`; OCI targets use
the full `sha256:…` digest. Exceptions are audited prominently in the report
and PR and are rejected on schedules, without a reason, or when unused.
MCP releases younger than seven days cannot be excepted: the recipe's
`NPM_CONFIG_MIN_RELEASE_AGE=7` guard remains mandatory.

An update is built on native `ubuntu-24.04` (amd64) and `ubuntu-24.04-arm`
(arm64), running the recipe's browser/CDP/MCP/WebMCP smoke tests, kit-tck,
ownership audit, script checks and regression fixtures. Only after both pass
does the workflow replace the fixed `automation/weekly-maintenance` branch
using a force-with-lease and create or refresh one PR to `main`. Identical
trees avoid redundant pushes. If main changed while testing, proposal fails
and requires a rerun. A no-change run closes an obsolete open maintenance PR.
Failure reports remain available in the Actions summary/artifact. Review and
merge remain manual; grouped weekly Dependabot Actions updates are preserved.

GitHub prerequisites (owners verify these; this change does not alter settings):

- Actions and the pinned public actions must be allowed by repository and
  organization policy, with access to both native runner labels.
- Under **Settings → Actions → General → Workflow permissions**, enable
  **Allow GitHub Actions to create and approve pull requests** if permitted
  by organization policy. The proposal job requests `contents: write`,
  `pull-requests: write`, and `actions: write`; the other jobs use read access.
  PR creation errors point to this setting. GitHub PR and dispatch operations
  need no PAT or new secret.
- The detection runner must be able to resolve `dhi.io/debian-base:trixie-dev`
  and `dhi.io/node:24-debian13-dev` through its existing Docker/Buildx route.
  [Docker documents DHI Community pulls as authenticated](https://docs.docker.com/dhi/how-to/use/).
  A successful native build or SBX updater run does not establish hosted
  maintenance access. The workflow sets up Buildx, but provisions no new login,
  credential or secret. If its existing route lacks access, maintenance fails
  closed with a sanitized resolver diagnostic; an owner must resolve that
  authentication prerequisite. No registry or pin check is skipped.
- Branch rules must permit the workflow identity to write the dedicated bot
  branch and force-update it. Main protections remain in effect.
- Both workflows must exist on the default branch before manual dispatch;
  schedules run the default branch and may be delayed by GitHub. This
  maintenance workflow intentionally accepts dispatch only from `main`.

A push made with `GITHUB_TOKEN` does **not** trigger downstream push workflows.
`workflow_dispatch` **is an exception** and can start a run using that token
with Actions write permission. After maintaining the PR, the workflow explicitly
dispatches `validate.yml` on the proposed branch, giving checks on the branch
commit in addition to the pre-proposal artifact tests. A maintainer with write
access can also run:

```sh
gh workflow run validate.yml --ref automation/weekly-maintenance
```

A human/App/PAT push to that branch can trigger its allowed push route.
There are no PR-event Actions or automatic merges. Actual repository permissions,
GitHub dispatch execution and native SBX behavior require host verification;
local fixtures do not establish these.

Official references: [GitHub workflow triggering and token exceptions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[manual dispatch and branch selection](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[repository Actions permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository),
[Debian version ordering](https://www.debian.org/doc/debian-policy/ch-controlfields.html#version),
[npm metadata](https://registry.npmjs.org/chrome-devtools-mcp),
[Go proxy protocol](https://go.dev/ref/mod#goproxy-protocol), and
[OCI image index platforms](https://github.com/opencontainers/image-spec/blob/main/image-index.md),
[Buildx metadata inspection](https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/), and
[registry authentication challenges](https://docs.docker.com/reference/api/registry/auth/).

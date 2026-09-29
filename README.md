# Chromium + DevTools MCP — Sandbox Kit

A Docker Sandboxes **mixin** kit that gives any agent a real browser:

- **Chromium 154** (Debian's build, amd64 + arm64) with its own libraries and
  fonts, so it runs on bases that have neither.
- The **`chrome-devtools` MCP server**, attached to that browser, with the
  **WebMCP** tools on: pages that expose tools through WebMCP
  (`document.modelContext` in Chromium 154) can be listed (`list_webmcp_tools`) and called (`execute_webmcp_tool`).
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
sbx run docker.io/docker/sbx-kit-claude:latest --display \
  --kit docker.io/olegselajev241/sbx-chromium-display:2.0.0 \
  --name claude-browser .
```

Or with Codex (any v3 workload kit works):

```bash
sbx run docker.io/docker/sbx-kit-codex:latest --display \
  --kit docker.io/olegselajev241/sbx-chromium-display:2.0.0 \
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
| `sbx-browser-register` | re-add the MCP entry to installed agents' configs |

The shared browser listens on `127.0.0.1:9222`
(`CHROME_REMOTE_DEBUGGING_PORT`), keeps its profile in
`~/.config/sbx-chromium/profile` and logs to
`~/.local/state/sbx-chromium/chrome.log`. The MCP server starts the browser on
demand, so the tools also work after you close the window.

### WebMCP

WebMCP lets a page publish tools for agents. Chromium 154 exposes it as
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

The browser bypasses the sandbox's credential-injecting forward proxy and uses
the transparent path instead, so sites present their real certificates;
network policy still applies.

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
sbx run docker.io/docker/sbx-kit-claude:latest --display \
  --kit ~/path/to/chromium-display-sbx-kit \
  --name claude-browser .
```

`run.sh` wraps the same command.

### CI and releases

- `.github/workflows/validate.yml` runs on every push to `main`: it builds the
  kit (which runs the smoke test), checks it with `kit-tck`, and audits file
  ownership.
- `.github/workflows/publish.yml` runs on any `v<version>` tag and pushes
  `linux/amd64` + `linux/arm64` to
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

## Browser (Chromium + chrome-devtools MCP)

This sandbox has Chromium and the `chrome-devtools` MCP server. Use the MCP
tools (`navigate_page`, `take_snapshot`, `click`, `fill`, `take_screenshot`,
`list_network_requests`, `list_console_messages`, …) to drive the browser.

There is **one shared browser** per sandbox, with DevTools on
`127.0.0.1:9222`. When the sandbox was started with `sbx run --display`, it is
a real window on the user's desktop: the user sees what you do and can click
in the same window, so do not assume the page is where you left it — take a
fresh snapshot before acting. Without a display the same browser runs
headless.

- The MCP server starts the browser if it is not running. If a tool reports
  it cannot connect (for example after the user closed the window), run
  `sbx-chrome` in the shell and retry. `sbx-chrome status`, `sbx-chrome
  restart` and `sbx-chrome <url>` (open a tab) also work.
- **WebMCP**: pages can expose their own tools (use
  `navigator.modelContext || document.modelContext`). After
  navigating, call `list_webmcp_tools` to see what the page offers and `execute_webmcp_tool` to call one — prefer a
  page's own tools over clicking through its UI when they exist.
- For one-shot work that should not disturb the shared browser, use the
  `chromium` command directly: `chromium --headless --screenshot=out.png
  <url>`, `--dump-dom`, `--print-to-pdf=out.pdf`.
- Sites outside the sandbox's network policy fail to load; that is the policy,
  not the browser. Tell the user which host was blocked.
- The browser uses SBX's supplied proxy and CA automatically. Default `auto` requires the proxy when proxy inputs are configured; explicit `SBX_PROXY_MODE=proxy` always requires it. In either case, invalid configuration or a direct, unknown, or mismatched managed launch is refused. Compatible reuse requires the same proxy endpoint, CA, and exact applied `NO_PROXY` text. Report the error; never add certificate-error bypasses. There is no automatic restart. Use a valid guest launch environment and deliberate `sbx-chrome restart` to apply changed settings while keeping the profile. Invalid restart inputs preserve the old browser; `sbx-chrome stop` remains available. Terminal exports do not update a running agent or MCP server; changing its environment requires restarting that process too. Set `SBX_PROXY_MODE=direct` only when the user asks; restarting in that mode bypasses credential injection and HTTP request rules, while network-level sandbox restrictions remain. Browser logins and cookies remain guest profile data accessible to the same-user agent.
- If a browser tool reports `no proxy variable reached the browser`, the required SBX proxy environment did not reach the MCP server. Tell the user and check which names are present in the agent-launch environment and MCP forwarding configuration without printing their values. Do not switch to `SBX_PROXY_MODE=direct` (bypassing the proxy) or prestart a browser as a workaround. For a supported kit-managed Codex entry, run `sbx-browser-register` with no arguments in the sandbox shell to add missing `env_vars` names. Read its output: custom commands or complex entries may be preserved with guidance instead. After the registration is updated, ask the user to restart Codex from the intended guest environment so it reads the new registration. This does not apply changed launch settings to an existing browser. An already-running browser with compatible settings can be reused without restarting it; use a deliberate `sbx-chrome restart` when browser launch settings need to change.
- The profile (`~/.config/sbx-chromium/profile`) keeps cookies and logins
  between runs. Do not sign in to accounts unless the user asked you to.

Display selection probes Wayland registry capabilities. SBX's clipboard bridge
can own `wayland-0` without being a compositor; never select by socket number.
`sbx-chrome` selects a unique compositor automatically. A valid ambient
`WAYLAND_DISPLAY` resolves multiple compositors; otherwise ambiguity is an
error. Set `SBX_WAYLAND_SOCKET=/absolute/path` for a strict compositor override
(invalid overrides fail), or `SBX_CHROME_HEADLESS=1` to force headless operation.
Plain `sbx-chromium --headless` and version queries bypass display discovery.

Chromium negotiates GPU use by default. With no render device exposed inside the sandbox, it uses software rendering. That fallback has been tested; Mac/VFIO hardware acceleration has not. To force software rendering regardless of the available device, set `SBX_CHROME_DISABLE_GPU=1` in the browser's guest launch environment before starting or restarting Chromium. Inspect the selected path in `chrome://gpu` or the GPU fields returned by `SystemInfo.getInfo` through the Chrome DevTools Protocol (CDP).

Use `sbx-chrome diag` for mode, socket capabilities, managed PIDs, Chrome DevTools Protocol (CDP) health, target count, lock presence, and proxy configuration metadata. It separates `proxyRunningBrowser` (recorded launch, not live-route attestation) from `proxyCallerEnvironment` (the current invocation). It works when Chromium is stopped and excludes URLs, credentials, titles, cookies, and page content.
Do not export profile files or browser logs as diagnostics.
A live profile owner or foreign CDP listener is left intact; investigate the
profile/port configuration rather than deleting locks or killing processes.
`sbx-chrome restart [URL]` gracefully flushes the persistent profile; the MCP
stdio connection reconnects to the replacement browser. Ask the person to log
in through the shared window, then continue through MCP on that same browser.
Native host window visibility and clipboard acceptance require a human check;
guest protocol/headless checks alone do not establish either.

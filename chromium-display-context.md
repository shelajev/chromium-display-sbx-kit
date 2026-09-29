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
- **WebMCP**: pages can expose their own tools (`document.modelContext` in
  this Chromium; `navigator.modelContext` in the draft spec). After
  navigating, call `list_webmcp_tools` to see what the page offers and `execute_webmcp_tool` to call one — prefer a
  page's own tools over clicking through its UI when they exist.
- For one-shot work that should not disturb the shared browser, use the
  `chromium` command directly: `chromium --headless --screenshot=out.png
  <url>`, `--dump-dom`, `--print-to-pdf=out.pdf`.
- Sites outside the sandbox's network policy fail to load; that is the policy,
  not the browser. Tell the user which host was blocked.
- The profile (`~/.config/sbx-chromium/profile`) keeps cookies and logins
  between runs. Do not sign in to accounts unless the user asked you to.

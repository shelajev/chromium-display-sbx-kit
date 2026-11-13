# Browser isolation workflows

Requested by Oleg on 2026-11-13. Canonical source:
<https://github.com/shelajev/chromium-display-sbx-kit>.
Source baseline: `3318c00f513a0560cfa8e895b6216cd23466c66d`.

The product promise is a browser inside SBX that a person and an agent can
reliably share, return to tomorrow, and use for useful work. Initial examples
are Teams catch-up and expense preparation. A working kit alone does not prove
that either workflow will become a habit.

## What the source tells us

- The current Chromium package pin disappeared from the configured Debian
  mirror; main validation failed on 2026-11-12. The previously published image
  remaining downloadable does not establish its current security/readiness.
- `files/display.sh` trusts an existing environment-selected socket, then
  searches for `wayland-0`. Socket existence does not establish that it reaches
  the intended visible desktop. Oleg reports two sockets and invisible windows;
  reproduce the actual topology before choosing a selection rule.
- `files/sbx-chromium` removes proxy environment variables and passes
  `--no-proxy-server`. Its comment attributes this to browser CA trust. Forward
  proxy credential injection is therefore an explicit integration gap.
- That launcher always selects `--password-store=basic`, `--no-sandbox`, and
  disables GPU/compositing for display mode. These are current implementation
  choices, not guarantees about what newer SBX builds require.
- `sbx-chrome` keeps a persistent profile and a shared loopback CDP endpoint.
  Reusing login state is useful, but the agent's access to that session must be
  explained. Basic password storage must not be advertised as OS-keychain
  protection; exact password/cookie encryption needs a version-specific check.
- Dependabot already groups weekly GitHub Actions updates into one open PR.
  It does not update the Chromium/MCP package pins. Preserve that low-noise setup.

## Ordered backlog

All children belong to epic **chromium-brow**. IDs refer to project-local Beans.
Dependencies below are sequencing guidance; several tasks can share one bounded
Herdr run when that reduces handoff overhead. They are not thirteen required crews.

| Order | Bean | Deliverable and acceptance |
| --- | --- | --- |
| 1 / P0 | chromium-fres | Restore a current browser build. Choose available Chromium/version-revision pins, refresh compatible MCP/tooling, and verify real browser + MCP + WebMCP behavior. Resolve both native architectures before calling a release portable. |
| 2 / P0 | chromium-disp | Reliable visible startup. Reproduce the two-socket topology, choose the SBX-forwarded display deterministically, respect a valid explicit override, and diagnose ambiguity/stale sockets. Prove the agent and person see the same browser. |
| 3 / P0 | chromium-prox | Credential-injection proxy compatibility. Discover SBX's supported CA/proxy contract, implement browser trust/routing, and prove scoped injection with synthetic secrets, redirects and subresources. Reject bad certificates; preserve network denials. |
| 4 / P0 | chromium-secr | Profile and login security contract. Verify password/cookie/token storage; explain same-guest agent access and persistence. Design separate named/ephemeral profiles, cleanup and logout/revocation guidance; review whether `--no-sandbox` remains necessary. |
| 5 / P1 | chromium-life | Human/agent handoff and restart reliability. One visible browser and matching CDP target, graceful login restart, preserved profile, stale lock recovery without duplicate browsers or terminating productive sessions. |
| 6 / P1 | chromium-help | Agent instructions and safe diagnostics. Teach the canonical launch/attach route, human login handoff, socket selection and troubleshooting. Report browser/MCP/proxy/display/profile status without exporting credentials or page content. |
| 7 / P1 | chromium-updt | Weekly maintenance PR. Update Chromium + Debian revision together, MCP and related compatibility pins; preserve seven-day package defaults with explicit urgent-security exceptions. One update PR, tested evidence, no silent auto-merge or PR-event Actions. |
| 8 / P1 | chromium-gpua | GPU capability experiment and policy. Test the actual custom Mac SBX builds with Vulkan/virtio support. Choose auto/software/explicit GPU modes from measured behavior; preserve a reliable software route. No global removal of disable flags based on assumption. |
| 9 / P1 | chromium-ship | Fresh-user kit acceptance and release. Verify immutable artifacts in actual SBX with/without display, native architecture coverage, agent registration and representative use. Document supported host/SBX/base versions and any gaps. |
| 10 / P2 | chromium-team | Teams catch-up setup. Human signs into a dedicated profile, agent reads a user-selected conversation and prepares a cited catch-up/action draft. Handle tenant/SSO/MFA restrictions; send is a separate explicit action. |
| 11 / P2 | chromium-expe | Expense preparation setup. Import selected receipts, draft/reconcile an expense report and expose missing fields/duplicates. Human review before financial submission. Start with synthetic receipts; validate any real target through an authorized account. |
| 12 / P2 | chromium-file | File exchange for both workflows. Scoped uploads, downloads and output export; predictable filenames/locations, attachment handoff and cleanup. No host home/profile mounts; avoid bundling sessions/secrets into exported files. |
| 13 / P3 | chromium-pilt | Small repeat-use trial. Measure time to first visible browser, login/handoff failures, time to useful result and return use for the two workflows. Opt-in observations without captured messages, receipts or tokens; use findings to prioritize the next iteration. |

## First Herdr work package

Start with **fresh browser + reliable display + human/agent handoff**, using
`chromium-fres`, `chromium-disp`, and the directly affected portion of
`chromium-life`. These share the same runtime acceptance path. Keep proxy and
profile security as the next bounded package; they require investigation rather
than guessed CA flags or a claim that proxy credentials solve browser SSO.

**Task outcome:** a reviewed candidate kit with reproducible Chromium builds and
reliable launch/attach behavior, ready for subsequent proxy/security work.

**Next use:** kit developers and Oleg can test the same visible browser with an
agent; it is not yet a completed Teams/expense product or a release receipt.

**QA mandate:** independently reproduce the reported failure, assess display
selection and browser lifecycle, and exercise the browser/MCP path available
inside the crew sandbox. The crew is not expected to run nested SBX or observe
the host desktop. Confirm headless operation and preservation of user config;
test display selection with representative socket fixtures where feasible.
Use exact-commit evidence and required native checks; do not turn a socket unit
test into a claim that a real window appeared on the host.

**Acceptance:** current pinned build passes meaningful existing smoke/TCK tests;
two-socket and missing/stale-display cases have regression evidence; actual
`--display` host handoff and headless MCP behavior have explicit receipts or
remain clearly unresolved. Record current SBX/custom-build identity. External
release additionally needs `chromium-ship`; no failing required check is waived.

**Host and human verification:** on 2026-11-13 Oleg authorized the host task
leader to create a scoped SBX test instance for the candidate and ask him to
check the window. Once a candidate is ready, the leader uses native host-side
SBX control to launch it with display, checks browser/CDP/MCP connectivity, and
pings Oleg to confirm a visible, responsive window. Use a harmless identifiable
test page so Oleg can confirm that human and agent see the same target. Exercise
restart/reconnect and the two-socket case on the real topology. Record the
candidate identity, SBX build, automated results and human observation separately.
No nested SBX or host project-code execution is implied. Missing human response
leaves visual verification pending; it does not invalidate a bounded code/QC
result or establish external kit readiness. Continue independent tasks while
awaiting the check. Preserve test evidence and clean up the owned test instance
after successful verification through the applicable lifecycle.

Include clipboard handoff in that human check: copy harmless text from the
browser to the host, and paste a host-copied link into the browser address bar.
On 2026-11-13 Oleg requested both directions; the leader enabled and read back
`clipboard.textCopy=true` via native SBX settings. Installed SBX 0.53.0 exposes
no `clipboard.textPaste` setting, so text paste behavior remains to be verified
in the actual display window. A setting readback is not a clipboard runtime test.

**Outside this package:** new credentials, real account actions, sending Teams
messages, submitting expenses, host code execution, factory repair, automatic
publication, broad network grants, and unrelated service restoration.

Use the current root `AGENTS.md` and recorded local Herdr kit, isolated clone,
central run Bean, independent final QC and durable usage/acceptance evidence.
Substantive Gemini work uses Carbon per the current task instructions. Hydrogen
is available for explicitly quick work. Do not rebuild Herdr for this project.

## Workflow success criteria

For Teams, success is a useful catch-up from a selected context with source
links and a draft the person can check. For expenses, it is an accurate prepared
report with receipt correspondence and unresolved fields visible. Real tenant
and expense-system validation is distinct from passing a synthetic fixture.

Browser proxy credentials and website sessions are separate. Header injection
can keep supported service secrets outside the guest, but does not automatically
remove OAuth cookies, SSO tokens, local storage or downloaded attachments from a
logged-in browser profile. Verify and explain these separately in `chromium-secr`.

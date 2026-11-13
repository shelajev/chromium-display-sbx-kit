# Browser foundation merge fixes

Base: `43d68c817cfe79af0053357349c693230a91400d`. This report belongs to the
new candidate commit, obtained with `git rev-parse HEAD` on the clean branch.
The three material Copilot findings were independently confirmed and fixed.

* **Publish merge job:** checks out the repository before the local TCK installer.
  Existing action pins stay unchanged. `python3 tools/check-workflows.py` guards
  checkout order for repo-local `tools/`/`files/` use and forbids PR triggers in
  this repository's block-style workflows. It rejects the original missing
  checkout. It is a focused structural check, not a general YAML validator.
* **Early display probe:** bundled Node receives prefix libraries on its command
  invocation before Chromium's wrapper exports them. Caller environment remains
  unchanged. `files/test/minimal-display.sh` uses an owned glibc-only chroot with
  **real Node** and C++ runtimes exclusively in the private prefix; it exercises
  direct detection and a normal wrapper invocation without headless/version
  bypass. Bare-base smoke also runs real Chromium dump-dom before curl install.
* **Shared endpoint ownership:** lifecycle operations acquire both canonical
  profile and IPv4 CDP-port abstract-socket locks in deterministic order. Kernel
  cleanup releases locks on process death. CDP must belong to exactly one main
  bundled Chromium executable with the intended canonical profile/port argv,
  and its FD set must own the listening socket inode from `/proc/net/tcp` (or a
  v4-capable tcp6 fallback). Checks bracket HTTP health reads and precede tab
  creation, readiness, healthy status, target diagnostics and Browser.close.
  Read/status paths share the locks. A separate `::1` listener cannot answer
  `127.0.0.1`; it neither grants ownership nor invalidates the IPv4 owner.
  Unreadable/ambiguous ownership fails closed. Stop/restart refuses foreign or
  non-listening lookalikes, including an actual second Chromium whose port bind
  failed. No lock-named process is killed. Same-host PID-reuse safety and
  healthy CDP Browser.close/cookie flushing remain intact.

These are cooperative same-guest lifecycle guards, not isolation from a hostile
same-UID process that can rewrite the kit/profile. The kit still intends one
shared human/agent browser. Explicit custom profile/port users must attach MCP to
the intended session; no broad profile/security redesign is claimed here.

## Verification and retained attempts

Evidence: `/tmp/chromium-merge-evidence/` (no user profiles or clipboard data).
Targeted display/lifecycle fixtures, workflow guard (including rejection of the
original checkout defect), shell/JS syntax, Beans links and whitespace checks
pass. The updated full smoke passes with existing authorized binaries in
`chromium-foundation-wayland:local`, using an owned executable tmpfs prefix and
synthetic HOME: closure/minimal loader, actual screenshot/fonts/DOM, CDP,
MCP/WebMCP, concurrent startup, stale PID recovery, real live-owner protection,
restart on the same MCP connection and persistent cookie/localStorage.

New real-browser tests race distinct profiles on one port; verify one winner,
no losing-session readiness/state write or injected tab; reject foreign status,
stop/restart and MCP startup; accept canonical aliases; and protect the winner
while a second real Chromium has the same port argument but no IPv4 listener.
A foreign CDP-shaped HTTP response is insufficient for healthy status or close.
The final fresh **native arm64 guest build passes**, with the complete updated
smoke re-executed (`build-tagged.log`). TCK m.12 **19/19 conforms**
(`tck-tagged.log`); ownership **968 entries all 0/0**; the OCI lifecycle bytes
match the current source exactly. Layout: `/tmp/chromium-merge-layout-tagged`,
manifest `sha256:21ec113cfd34278099a1656367cb2476b734c9ebe171961d69438d2f18890574`.
Unrelated agent config hashes and all 20 files in prior clipboard/archive report
snapshots match their before/after baselines. Native changed-head CI and affected
host checks remain pending. No claims of a new host window or clipboard proof.

Preserved failures: the first build test followed a SingletonLock symlink with
`existsSync`, so it incorrectly reported an absent lock; the fixture now uses
`lstat`. The next tmpfs regression exposed an ownership-check bug that combined
independent IPv4 and ::1 listeners; the endpoint-specific correction passes.
An initial TCK lookup used an OCI export without a tag, producing “not found”;
the final export explicitly tags `chromium-display:0.0.0-ci.local`. Logs remain;
no required test was removed or weakened. No cache prune or infrastructure
repair was performed.

## Provenance and next host steps

**43d68c8 receipts already exist:** native AMD64 CI
[43452000528](https://github.com/shelajev/chromium-display-sbx-kit/actions/runs/43452000528),
actual SBX v0.53.0 correctly selected compositor, one visible matching-token
window confirmed by Oleg, healthy CDP/MCP/WebMCP and same-connection restart /
repeat start. These receipts are historical proof of that exact candidate,
not validation of this changed head. Prior foundation and clipboard reports
remain intact in crew archives; FOUNDATION-REPORT.md now distinguishes the dates.

After exact-commit Claude QC, the host leader can push, reply to the three
review threads, run native CI at the new exact SHA, and perform the affected
native SBX launch/probe/ownership/restart check using an owned test instance.
Use the accepted local-source kit build/install route with the same official
Codex 0.166.0 workload as the 43d68c8 host receipt (not the older workload in the
historical initial handoff), recording new SHA and SBX build; exercise the minimal-loader and cross-profile suite in
native CI and confirm one intended browser/CDP/MCP session after restart. Do not
interact with or replace the existing visible sibling window. Merge when green;
Oleg authorized this without another approval pause. No push, comment, merge,
publication/tag, host execution or runtime/window change is performed by this
crew. Publication remains separately owned, not implied by fixing its workflow.

**Clipboard stays deferred/unresolved** with a reported failure and a bounded
SBX/Sailor source diagnosis; neither text nor image-paste policy is changed.
Proxy/profile security, GPU validation, updater and all later workflow backlog
remain open. The four scoped Beans remain in-progress pending changed-head
validation; no later Bean was modified.

Dependabot PR #1/source `16384a8` was assessed independently:
[DEPENDABOT-PR1-ASSESSMENT.md](DEPENDABOT-PR1-ASSESSMENT.md). The exact official
SHA/tag metadata and releases satisfy the seven-day age rule and declared
Node24/hosted-runner/input compatibility. Recommend its separate merge after
rebasing/reviewing the new merge-job checkout and hosted CI; no proposed action
pin has been applied to this branch.

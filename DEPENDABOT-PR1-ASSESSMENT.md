# Independent Dependabot PR #1 assessment — 2026-11-13

Recommendation: **merge separately after rebasing/reviewing the new publish
merge-job checkout and passing hosted CI**. No age or declared input/runtime
compatibility blocker was found for the exact supplied diff, source `16384a8`.
This branch retains existing action pins; none of these upgrades was merged.

GitHub API release/tag/commit responses and pinned `action.yml` / README files
were read from the official `actions/*` repositories. All four version tags
resolve directly to the proposed full commit SHA; commit responses match and
GitHub reports their signatures verified. Release and commit ages both exceed
seven days as of 2026-11-13 (no cooldown exception):

| Action | Proposed immutable SHA | Release UTC | Commit UTC | Release age |
| --- | --- | --- | --- | --- |
| checkout v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-07-20 15:10:05 | 2026-07-17 18:45:11 | 116 days |
| upload-artifact v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | 2026-10-07 10:08:14 | 2026-10-07 10:00:52 | 37 days |
| download-artifact v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | 2026-10-07 10:09:51 | 2026-10-07 10:00:57 | 37 days |
| setup-go v7.0.0 | `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e` | 2026-07-16 02:50:50 | 2026-07-16 02:47:49 | 120 days |

Primary release/commit records:
[checkout release](https://github.com/actions/checkout/releases/tag/v7.0.1),
[checkout commit](https://api.github.com/repos/actions/checkout/commits/3d3c42e5aac5ba805825da76410c181273ba90b1),
[upload release](https://github.com/actions/upload-artifact/releases/tag/v7.0.2),
[upload commit](https://api.github.com/repos/actions/upload-artifact/commits/cf430e030ddbb5b0abf93d22962f4752f3646cd9),
[download release](https://github.com/actions/download-artifact/releases/tag/v8.0.2),
[download commit](https://api.github.com/repos/actions/download-artifact/commits/9000827ccba6bdab643e8b6fd33ac0654aef8333),
[setup-go release](https://github.com/actions/setup-go/releases/tag/v7.0.0),
[setup-go commit](https://api.github.com/repos/actions/setup-go/commits/b7ad1dad31e06c5925ef5d2fc7ad053ef454303e).
Tag endpoints are `/repos/actions/<action>/git/ref/tags/<version>` on the same
API. Complete responses and pinned action metadata are retained in the guest at
`/tmp/chromium-merge-evidence/actions/`.

All four action manifests declare **Node 24**, executed by the Actions runner,
not the Chromium kit's bundled Node. Checkout and setup-go document runner
**≥2.327.1**; authenticated Git from Docker container actions additionally needs
**≥2.329.0** for checkout. The workflows use GitHub-hosted `ubuntu-latest`,
`ubuntu-24.04`, and `ubuntu-24.04-arm`, without container jobs or custom runners;
no authenticated Git container action use is present. Host CI should record the
actual runner version; this static review does not prove a future runner's
installed runtime. No unsupported GHES deployment is assumed.
See pinned [checkout README](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/README.md)
and [setup-go README](https://github.com/actions/setup-go/blob/b7ad1dad31e06c5925ef5d2fc7ad053ef454303e/README.md).

Input/behavior compatibility:

* Checkout v7's fork-sensitive trigger restrictions do not affect existing
  main-push/manual/tag workflows; no PR or workflow_run trigger is introduced.
  Source-checkout inputs remain default; `contents: read` is retained.
* Upload v7 keeps `archive: true` by default. Existing named `digest-<platform>`
  artifacts, wildcard paths, `if-no-files-found: error` and one-day retention
  remain supported. Empty digest marker files are ordinary nonhidden files.
  Do not opt into unarchived upload, which would use file-derived naming.
  [Pinned upload manifest](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml).
* Download v8 supports `pattern`, `path`, and `merge-multiple: true`; these keep
  the two platform digest markers in one directory for imagetools. Both artifact
  actions target GitHub.com (v4+ GHES restrictions remain irrelevant here).
  [Pinned download manifest](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/action.yml).
* Setup-go v7's ESM/dependency changes retain `go-version: stable` and Node24;
  no new workflow input is needed. The repository has no root go.sum; default
  cache lookup can warn, as before, while the TCK script builds its pinned module.
  [Pinned setup-go manifest](https://github.com/actions/setup-go/blob/b7ad1dad31e06c5925ef5d2fc7ad053ef454303e/action.yml).

Host sequence: land/rebase the focused merge fixes, then rebase PR #1 and update
its action-pin change to cover the **new** merge-job checkout as well as the
existing build/validate steps. The original diff may apply without conflict yet
leave that added step on v5; inspect all occurrences. Run the workflow checkout
and trigger guard and native validation at the resulting exact head before
merging PR #1. No real publication/tag test is authorized by this assessment;
publication remains a separately owned release action. Dependabot grouping and
weekly schedule are unchanged.

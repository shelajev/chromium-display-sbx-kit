---
# chromium-clpb
title: Resolve SBX display clipboard transport
status: in-progress
type: task
priority: high
created_at: 2026-11-13T16:03:00Z
updated_at: 2026-11-14T17:40:00Z
---

Epic chromium-brow. Oleg resumed this as an actual repair on November14 and
selected Herdr. Central execution ai-contrib-bclp, task chromium-clipboard,
isolated SBX source clone matching installed0.53.0 commit2c62838074738845f8f1096ff5f8920df61152fb.
Deliver a tested policy-preserving source fix or a concrete unavailable-upstream
patch/interface dependency with evidence. Native deployment and real clipboard
verification remain separate authority/manual boundaries.

Prior bounded investigation independently assessed PASS at unchanged43d68c8.
Host report .local/chromium-foundation/clipboard-result/report.md,
SHA2565614a4ae3e15edd825c6c915b4b1cbd98781d82a5c9bd56eceb196f841986a6f.
It identified an intentional payload-dropping display compositor stub, not a
wrong rendering socket. Agent HTTP/text-copy shims are separate and cannot
establish graphical clipboard behavior. Both-direction human retries failed;
no clean consent-preserving kit-only fix has been established.

The new task traces actual compositor initialization/settings/authorizer and
uses synthetic protocol tests. Preserve focus/serial/gesture gates, MIME limits,
expiry/cancellation and denied image behavior. Never scrape/poll host clipboard,
invent a textPaste setting or bypass host consent. No host code execution,
runtime rebuild/activation, CUA/UI automation or upstream posting authorized.
Actual bidirectional native clipboard acceptance remains unresolved.

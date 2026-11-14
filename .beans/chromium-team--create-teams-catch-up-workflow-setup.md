---
# chromium-team
title: Create Teams catch up workflow setup
status: todo
type: feature
priority: normal
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T13:35:23Z
---

Epic chromium-brow; order 10. Deliver runnable setup and concise guide: dedicated
browser profile, human SSO/MFA, user-selected conversation, linked catch-up/action
draft, return tomorrow. Handle tenant/device-policy restrictions and prompt
injection in untrusted page content. Browser automation cannot promise access
that a tenant administrator forbids.

Accept synthetic reproducible journey and, when a specific account/tenant is
authorized, real Teams handoff evidence. Keep synthetic and real results distinct.
No message sends, new credentials or broad account access implied. Depends on
foundation/ship; coordinate attachment needs with file.

Use Teams web as a fallback when a native integration is unavailable or lacks
the needed workflow. Start only after kit maturity, profile/secret-storage and
proxy trust/injection boundaries are accepted. Human performs authentication
and any desktop interaction; no login, tenant access or implementation is
currently authorized by this backlog entry. Keep the synthetic fixture runnable
without an actual Teams account and make the later account authorization explicit.

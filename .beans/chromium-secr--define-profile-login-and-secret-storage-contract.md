---
# chromium-secr
title: Define profile login and secret storage contract
status: todo
type: task
priority: high
created_at: 2026-11-13T13:35:23Z
updated_at: 2026-11-13T13:35:23Z
---

Epic chromium-brow; order 4. Verify this Chromium build's basic password backend,
cookie/token/local storage and persistence with synthetic credentials. Explain
what is plaintext, reversibly protected or backed by an actual secret store;
do not claim host Keychain protection. Distinguish proxy secrets from website
sessions and same-guest agent/CDP access from host isolation.

Deliver appropriate named/ephemeral profile controls and deletion/logout/revoke
guidance. Review no-sandbox necessity and nested protection options. Accept
version-specific evidence and tested lifecycle behavior with clear limitations.
Coordinate shared profile interfaces with chromium-life.

Owner: Chromium delivery; central follow-up ai-contrib-bsec. Before advertising
authenticated Teams or expense workflows, reconcile the private operator design
note .local/chromium-repairs/PROFILE-SECURITY-NOTE.md. Current launcher uses
password-store=basic; treat saved passwords as unprotected guest data until the
exact build is verified. Cookies/local storage can retain authenticated sessions
independently of Save Password. A guest keyring does not isolate an unlocked
browser from a same-user agent with filesystem/MCP access. Proxy credential
injection is request-level and does not establish website-session secrecy.
No fourth repair crew or feature implementation is started by this note; use
synthetic fixture data later, never existing real profile/account contents.

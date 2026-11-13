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

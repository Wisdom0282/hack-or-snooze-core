# Hack or Snooze: core

A framework-free Hacker News clone core: models, API contract, and tests. The live UI demo is published separately.

## Run
`npm test` (Node 20+, zero dependencies).

## Architecture
```
UI (render from state) -> models (Story, StoryList, User) -> api contract -> mock | HTTP adapter
```
Dependencies (api, storage, clock) are injected, so every layer is testable without a browser.

## Decisions
1. **Injected api, storage and clock.** Tests run in milliseconds and a real backend is a drop-in adapter.
2. **Server-confirmed state changes.** Local favorites change only after the API accepts the call.
3. **Typed errors (`ApiError.code`).** The UI branches on codes, not message strings.
4. **Opaque session tokens and PBKDF2 hashing.** An earlier prototype used a username-derived token and plaintext passwords. Both were replaced.

## Known limits
Mock backend only: hashing runs client-side and is not a real security boundary. No rate limiting, token expiry or CSRF model. The UI layer is not yet split into modules or covered by browser tests.

---
name: kazer-frontend-quality
description: Use when writing or reviewing KAZER front-end JavaScript (vanilla ES modules). Covers module boundaries, lazy loading, network handling, keyboard behaviour, forms, and the mobile-first QA routine with Playwright screenshots.
---

# KAZER front-end quality

## Architecture rules
- One module per screen/feature; heavy screens are `import()`-ed on first open
  (see `screens.js`). The chat path must not grow for features nobody opened.
- All HTTP goes through `request()` in `net.js` (timeout, retry on idempotent calls,
  offline detection, `kazer:unauthenticated` / `kazer:maintenance` events).
- Authorization is the server's job. The client never decides plan, quota or ownership;
  it renders what the API returns.
- State lives in the module closure; persist only UI conveniences via `store` (dom.js).

## Interaction rules
- Enter/Escape/Tab work everywhere; focus is trapped in dialogs (`trapFocus`) and restored
  on close. Shortcuts never steal keys while a field has focus.
- Forms: label every field, show errors next to the field in pt-BR, keep the draft on failure.
- Long operations show real progress or an honest indeterminate state; never fake percentages.
- Listeners added on open are removed on close; `requestAnimationFrame` loops stop when
  hidden (`document.visibilityState`).

## QA routine (do it, don't assume)
1. `find kazer/interfaces/web/static -name '*.js' -print0 | xargs -0 -n1 node --check`
2. Run the app locally with a fake provider and drive it with Playwright
   (Chromium is preinstalled; `deviceScaleFactor: 1` for self-review).
3. Capture 390×844 and 1366×820; collect `pageerror` and console errors — must be empty
   (CSP violations show up there).
4. Check slow network and error responses, not just the happy path.

## Anti-patterns
`innerHTML` with data, `setTimeout` polling without visibility check, global event
listeners that are never removed, blocking the main thread in `input` handlers.

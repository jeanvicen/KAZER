---
name: kazer-design-system
description: Use when adding or changing CSS, components or states in the KAZER web UI. Lists the real design tokens, the component primitives that already exist, the required states and the accessibility bar (WCAG 2.2 AA).
---

# KAZER design system

No build step, no framework: plain CSS + ES modules in
`kazer/interfaces/web/static/assets/`. CSP forbids inline styles and scripts.

## Tokens (never hard-code what a token covers)
| Group | Where | Examples |
|---|---|---|
| Brand/neutral | `kazer.css :root` | `--gold`, `--gold-hi`, `--black`, `--surface`, `--text`, `--text-2`, `--text-3`, `--border` |
| Semantic | `kazer.css :root` | `--color-accent`, `--color-danger`, `--color-success`, `--color-warning`, `--color-focus-ring` |
| Chat neutrals | `chat.css` | `--n-<hex>` ramp, `--c-text`, `--c-text-2`, `--c-text-3`, `--ov` (overlay rgb) |
| Refinement | `refine.css` | `--font-ui`, `--hairline`, `--hairline-strong`, `--wash`, `--wash-strong`, `--lift`, `--ease-quiet` |

Light theme exists **inside the chat only** (`html.in-chat[data-theme="light"]`); every new
surface must be checked in both.

## Primitives that already exist — reuse them
- DOM: `h()`, `icon()`, `mark()` in `dom.js` (text via `textContent` only).
- Overlays: `sheets.js` (bottom sheet on mobile, floating panel on desktop, confirm, toast).
- Full screens: `screens.js` + `screens.css` (`.screen`, header, back button).
- Loading: `loader.js` (appears only after 420 ms). Offline: `offline.js`.
- Notices: `aviso.js` (owner banner), `.msg__notice` (inline).

## Every interactive component needs
default · hover · `:focus-visible` (2px `--color-focus-ring`, offset 2px) · active ·
disabled · loading · error · empty. Touch targets ≥ 44px on `pointer: coarse`.

## Checklist
- [ ] New visible string added to `i18n-en.js` (trimmed, unique key).
- [ ] New shell file added to `SHELL` in `sw.js` and cache version bumped.
- [ ] No `style=""`, no `innerHTML` with dynamic data, dynamic CSS only via CSSOM.
- [ ] Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries.
- [ ] No horizontal overflow at 360px width; dialogs fit 100dvh with safe-area insets.
- [ ] `node --check` passes for every touched `.js`.

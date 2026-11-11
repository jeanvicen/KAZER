---
name: kazer-art-direction
description: Use when designing or reviewing any KAZER screen, component, illustration or motion. Encodes the brand's visual identity (obsidian + champagne gold), hierarchy, composition and motion restraint so new UI does not drift into a generic AI dashboard.
---

# KAZER art direction

Source of truth: `docs/brand.md`, `kazer/interfaces/web/static/assets/kazer.css` (tokens),
`refine.css` (type + surfaces). Read them before proposing visuals.

## Identity in one paragraph
Near-black obsidian surfaces, soft-white text, **champagne gold (`--gold #d5b15a`) only for
the primary action and brand moments**. One UI typeface (Inter, self-hosted); the gothic
face (Grenze Gotisch) appears **only** in the word KAZER. Pixel-art scene and the alien
mark are the signature; particles are a short intro, never a background loop.

## Checklist before shipping a screen
- [ ] One primary action per view, and it is the only solid-gold element.
- [ ] Hierarchy readable in 3 seconds: title → supporting line → action.
- [ ] Spacing from the scale (0.25rem steps); no one-off pixel values.
- [ ] Borders are hairlines (`--hairline`), surfaces are washes (`--wash`); no glow, no glass
      stacks, no purple/blue "AI" gradients.
- [ ] Icons: 1.5–2px stroke, from `dom.js` `icon()`; no emoji as UI.
- [ ] Motion ≤ 280ms, ease `--ease-quiet`, and disabled under `prefers-reduced-motion`
      and `html[data-motion="reduzido"]`.
- [ ] Copy in natural pt-BR, specific, no hype ("ilimitado", "revolucionário" are banned).
- [ ] Screenshot at 390×844 and 1366×820 and actually look at them.

## Anti-patterns
- Card grids with equal weight for everything.
- Gold text on gold, gold borders everywhere, gold gradients as decoration.
- Decorative animation that runs while the person types or scrolls.
- Cloning another product's layout pixel for pixel.

## Acceptance
A reviewer can name the screen's single purpose from the screenshot, contrast passes AA,
and nothing on screen is fake (no dead buttons, no invented numbers).

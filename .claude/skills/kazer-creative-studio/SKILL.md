---
name: kazer-creative-studio
description: Use when working on KAZER Studio (the design editor) — canvas objects, templates, layers, export, and project persistence. Defines the document format, what "done" means for an editor feature, and the mobile editing model.
---

# KAZER Studio

Code: `static/assets/studio.js`, `studio.css`, vendored `vendor/fabric.min.js` (Fabric.js,
MIT — keep `vendor/fabric.LICENSE`). Server: `kazer/studio/` + `/api/designs`.

## Document format (versioned)
```json
{"v": 1, "w": 1080, "h": 1080, "bg": "#0b0b0b", "canvas": { /* fabric toObject() */ }}
```
- Stored per account (RLS). Max size enforced on the server (`MAX_DESIGN_BYTES`).
- Images inside a design are embedded as data URLs after being downscaled client-side;
  never hot-link third-party images (rights + CSP).

## A Studio feature is done only if
- [ ] It survives save → reload → reopen with identical result.
- [ ] Undo/redo covers it (history is a bounded stack of serialized states).
- [ ] It works with touch (drag, pinch-free controls via the bottom bar) at 390px width.
- [ ] Export (PNG/JPEG/PDF) contains it at the document's real pixel size.
- [ ] No console/CSP errors.

## Mobile model
The canvas is scaled to fit; editing happens through a bottom toolbar (add text/shape/image,
colour, size, order, duplicate, delete). Never force a desktop panel layout on a phone.

## Never
- Ship a static mock as "editor". Present templates that are not real editable documents.
- Use an SDK with production licensing (e.g. tldraw) as if it were free.
- Use fonts or images without a licence that allows redistribution.

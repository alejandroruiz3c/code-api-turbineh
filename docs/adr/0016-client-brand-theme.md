# ADR-0016 · Client brand as theme tokens

- Status: accepted (owner request, 2026-10-11)
- Date: 2026-10-11

## Decision

When asking for an app, the client can optionally give a **main colour**, a **typeface** (from a short list of
local system font stacks) and a **logo** (PNG, JPEG or WebP, ≤ 256 KB). The assembler applies them
deterministically — no model is involved:

- Recipe templates use theme tokens (`--color-brand`, `--color-brand-contrast`, `--font-brand`) instead of fixed
  colours; the assembler rewrites the `@theme` block of `src/app/globals.css`.
- The text colour on the brand colour is computed with the WCAG contrast formula (white or black, whichever is more
  readable), so a light brand colour never produces unreadable buttons.
- The logo is written to `public/brand/` and shown in the home page and the dashboard header (`src/brand.ts`).

## Safety

- Validated twice: API schema (hex colour, font enum, data-URL shape and size) and worker (`parseBrand`), where the
  logo type is checked by its **content** (magic bytes). SVG is not accepted (it can carry scripts).
- Fonts are system stacks only: the generated app never downloads fonts from a third party (privacy, offline builds).
- Free-form `options.brand` is stripped from the public API; only the validated `brand` field is used.

## Not in scope now

Screen previews, visual change requests and more UI layouts are future work (owner decision, 2026-10-11).

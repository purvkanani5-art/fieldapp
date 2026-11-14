# Kshetralekha design system: MASTER

The single source of truth for how Kshetralekha looks. The tokens live at the top of `frontend/styles.css`, and
that block must match this file. Page-specific rules, if ever needed, go in `design-system/pages/<page>.md`; they
override this file for that page only.

**Basis.** The ui-ux-pro-max design-system generator ("Minimalism & Swiss style": enterprise apps, dashboards,
light neutral base, high contrast, low motion), adapted to the owner's brief (plan: `docs/ui-redesign-plan.md`):
- Sajeevan green as the only accent, in place of the generator's blue.
- IBM Plex Sans in place of Inter.
- Light and dark themes.

**Character.** A calm, light work surface, like a well-kept register book. Neutral greys do the structure. Green
appears only where someone can act (primary button, link, selection) or where something is confirmed. Status
colours mean status and nothing else. The one memorable element is the status language: the same chips and day
codes on every screen.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F6F5` | `#101513` | Page background |
| `--surface` | `#FFFFFF` | `#171D1A` | Panels, tables, cards |
| `--surface-2` | `#F0F2F1` | `#1E2622` | Table header, hover, input fill, chips |
| `--surface-3` | `#E7EBE9` | `#26302B` | Pressed, selected neutral |
| `--border` | `#DDE2DF` | `#2C3632` | 1 px dividers and panel edges |
| `--border-strong` | `#C5CCC8` | `#3A4640` | Emphasised dividers |
| `--border-control` | `#7E8983` | `#66726C` | Input and checkbox edges (≥ 3:1, WCAG 1.4.11) |
| `--text` | `#18211D` | `#E8EDEA` | Body text, headings |
| `--text-2` | `#4A5550` | `#AEB8B3` | Secondary text |
| `--muted` | `#66716C` | `#8E9A94` | Labels, captions, placeholders |
| `--accent` | `#1C6B45` | `#5BBF8C` | Primary action, links, selection, focus within lists |
| `--accent-hover` | `#155636` | `#74CC9E` | Hover/pressed accent |
| `--accent-tint` | `#E6F1EB` | `#183427` | Selected row, active nav item |
| `--on-accent` / `--on-solid` | `#FFFFFF` | `#0E1A13` | Text on any solid accent or status fill |
| `--success` / tint | `#1C7A47` / `#E7F3EC` | `#5CC08A` / `#173024` | Approved, present, synced |
| `--warning` / tint | `#A15C07` / `#FBF1E2` | `#E2A44B` / `#33270F` | Pending, late, half day, saved on phone |
| `--danger` / tint | `#B42318` / `#FBEAE8` | `#F07A6B` / `#3A1D18` | Rejected, absent, errors, destructive |
| `--info` / tint | `#1F5FBF` / `#E8EFFA` | `#7FA8EC` / `#16243D` | Information, leave, focus ring |

**Contrast** (WCAG 2.2, checked 2026-11-14). The lowest pairs:

| Pair | Light | Dark |
|---|---|---|
| `--muted` on `--surface-2` | 4.51 | 5.31 |
| `--warning` on its tint | 4.64 | 6.71 |
| `--success` on its tint | 4.70 | 6.31 |
| `--on-accent` on `--accent` | 6.48 | 7.89 |
| Avatar initials (white on muted avatar colours) | ≥ 6.68 | – |

Every other text pair is higher. Field staff read the app in sunlight, so do not lighten `--muted` or any status
colour.

**Rules.**
- No gradients, glows, frosted glass or decorative blobs. The only gradients allowed are functional ones: the
  select chevron, the map grid, the loading skeleton and the camera scrim.
- Never put white text on a token colour directly; use `--on-solid`, which flips in dark mode.
- Colour is never the only signal. Every status chip and attendance cell also carries a word or letter.
- Project identity (Biochar, Gasifier, Agroforestry) uses a neutral icon tile plus the name, not colour.

## Typography

- **Family:**
  - `"IBM Plex Sans"`, self-hosted (`frontend/fonts/plex-sans-latin*.woff2`, variable 400–600; ₹ is in the
    latin-ext file).
  - Then `"Noto Sans Gujarati"` and `"Noto Sans Devanagari"`, loaded by `unicode-range` only when those scripts
    appear.
  - Then the system UI fonts.
- **Numbers:** `font-feature-settings: 'tnum' 1, 'lnum' 1` on `body`, so every figure is tabular and lining.
  Numbers in tables are right-aligned.
- **Scale:** 12 / 14 / 16 / 20 / 24 / 32 px (`--fs-*`). Body 16 on phones; 14 in dense desktop tables. Line
  height 1.5 for body, 1.25 for headings.
- **Weights:** 400 body, 500 labels and table headers, 600 headings and emphasis. Nothing heavier.
- **Wording:** headings in sentence case. No all-caps labels, no tracked-out eyebrows, no italic or coloured
  single words in headings.

## Space, shape, depth

- **Spacing:** 4 / 8 / 12 / 16 / 24 / 32 px (`--sp-1` … `--sp-6`).
- **Radius:**
  - `--r-sm` 6 px: buttons, inputs, chips inside tables.
  - `--r-md` 8 px: panels, drawers, modals.
  - Fully round only for avatars and pill chips.
- **Borders:** 1 px `--border`. Panels use `--shadow-1`, a 1 px ring with no blur.
- **Shadows:** only for things that float above the page: drawer, modal, menus, toast, bottom nav (`--shadow-3`).

## Motion

- 150 ms (`--t-fast`) for hover and press; 200 ms (`--t`) for opening drawer, modal, toast and menus.
- Easing `--ease` (no overshoot, no springs).
- The page change is a single 200 ms fade: no staggered entrances, no count-up numbers, no infinite animations
  except a loading spinner.
- `prefers-reduced-motion: reduce` turns every animation and transition off.

## Icons

- The in-house outline set in `core.js` (`ICONS`, 24 px grid, round caps, stroke 1.85). One set, no emoji, no
  mixed libraries.
- Icon-only buttons need `aria-label`. Decorative icons are `aria-hidden`, which `ic()` already sets.

## Components (built in phase 2)

App shell · page header (breadcrumb, title, one primary action) · panel · KPI tile with sparkline · data table
(sticky header, sort, filter bar, pagination, density, empty state, row actions; list rows on phones) · form field
(label above, helper, required marker, inline error) · buttons (primary, secondary, ghost, danger; 44 px minimum
touch target on phones) · status chip · tabs · drawer (desktop) / full screen (phone) · modal · toast · skeleton ·
empty state with one action · timeline · approval card.

**Status chip vocabulary** (the same words everywhere):

| Status | Words |
|---|---|
| success | Approved, Present, Synced, Locked, Done |
| warning | Pending, Late, Half day, Saved on phone, Due soon |
| danger | Rejected, Absent, Overdue, Failed |
| info | On leave, In progress, Draft |
| neutral | Closed, Weekly off, Holiday |

## Pre-delivery checklist (from ui-ux-pro-max, per screen)

- [ ] No emoji as icons; one icon set
- [ ] Every clickable element has a pointer cursor and a visible pressed/hover state (150–200 ms)
- [ ] Text contrast ≥ 4.5:1 in light and dark; control borders ≥ 3:1
- [ ] Visible keyboard focus (`:focus-visible` ring in `--focus`)
- [ ] `prefers-reduced-motion` respected
- [ ] Touch targets ≥ 44 × 44 px on phones, ≥ 8 px apart
- [ ] Works at 360, 768 and 1440 px with no horizontal page scroll (tables scroll inside their panel)
- [ ] English, Gujarati and Hindi render without clipping
- [ ] Loading, empty, error and offline states present

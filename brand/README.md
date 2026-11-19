# Kshetralekha by Sajeevan — logo kit ("Rooted Flame")

Hand this folder to Claude Code. All files share one 120 × 120 viewBox and the same geometry.

## Files
| File | Use |
|---|---|
| `kshetralekha-icon-square.svg` | Full-bleed square. Source for the **Android adaptive icon** and the Play Store icon (the launcher applies its own mask). |
| `kshetralekha-icon-rounded.svg` | Rounded square (rx 28). Web favicon, PWA icon, splash screen, desktop. |
| `kshetralekha-mark-circle.svg` | Circular badge. Login screen, reports, PDF headers, carbon-audit stamps. |
| `kshetralekha-mono.svg` | One-colour (black/white). Rubber stamps, fax/print, watermark. |

## Logo lockups (English, final)
All text is converted to vector outlines (Plus Jakarta Sans ExtraBold / SemiBold), so no font is needed to display them.

| File | Use |
|---|---|
| `kshetralekha-logo-horizontal.svg` | Main logo: app header, website, letterheads, reports (light backgrounds) |
| `kshetralekha-logo-horizontal-on-dark.svg` | Same on dark backgrounds (Bone text, "Sajeevan" in Kiln ochre) |
| `kshetralekha-logo-stacked.svg` | Login screen, splash screen, square spaces |
| `kshetralekha-logo-stacked-on-dark.svg` | Stacked, for dark backgrounds |
| `kshetralekha-wordmark.svg` | Name only, for tight horizontal spaces |

Rules:
- Name: always **Kshetralekha by Sajeevan**. "by" in grey `#5C5C55`, "Sajeevan" in Canopy green `#2E7D4F` (on dark: ochre `#D08A2E`).
- Keep clear space around the logo equal to the height of the "K".
- Don't stretch, recolour or add effects; minimum horizontal logo width 120 px.
- For live UI text use the font **Plus Jakarta Sans** (Google Fonts): 800 for the name, 600 for body.

## Colours
| Token | Hex | Where |
|---|---|---|
| Bone (sky) | `#F4F1E8` | Background above horizon, leaf veins, seam |
| Biochar (soil) | `#1E1F1C` | Ground below y = 74 |
| Kiln (flame) | `#D08A2E` | Left half of drop, granules |
| Ember (inner flame / roots) | `#EDB04A` | Inner flame tongue, roots |
| Canopy (leaf) | `#2E7D4F` | Right half of drop |

## Construction
- Canvas 120 × 120. Horizon line at **y = 74**.
- Drop outline: `M60 14 C86 38 94 62 84 84 C78 96 69 102 60 102 C51 102 42 96 36 84 C26 62 34 38 60 14 Z`
  drawn at scale 0.64 with its base point (60, 102) moved to (60, 74).
- Split exactly at x = 60: flame left, leaf right; 3.5-unit Bone seam down the middle.
- 5 roots from the base, 6 granules in the soil.

## Tasks for Claude Code
1. **Android launcher icon:** In Android Studio, use Image Asset → Launcher Icons (Adaptive and Legacy).
   - Foreground: `kshetralekha-icon-square.svg`, scaled to about 66% so it fits the safe zone.
   - Background colour: `#F4F1E8`.
   - Turn off the legacy shape padding.
   - Or convert the SVG to a VectorDrawable with Vector Asset Studio. It supports clip-path groups and transforms.
2. **Exports:** Generate PNGs at 48, 72, 96, 144, 192 and 512 px, plus a 1024 px Play Store icon, using `rsvg-convert` or `sharp`.
3. **Web:** Create `favicon.ico` (16/32/48) and `apple-touch-icon.png` (180) from the rounded version.
4. **Splash screen:** Centre the circle mark at 160 dp on `#F4F1E8`.
   - Below it, use `kshetralekha-logo-stacked.svg`, or the wordmark "Kshetralekha" with "by Sajeevan" in Plus Jakarta Sans.
   - Then the tagline "Every acre. Every batch. On record."
5. **In-app logo component:** Embed the rounded SVG inline so it stays sharp. Don't use a raster image.

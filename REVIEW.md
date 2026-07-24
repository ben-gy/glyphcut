# Glyphcut — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **Custom domain:** https://glyphcut.benrichardson.dev
- **GitHub Pages:** https://ben-gy.github.io/glyphcut/ *(redirects to the custom domain)*

## What it does

Subsets fonts and converts them to WOFF2 entirely client-side, using HarfBuzz's `hb-subset`
compiled to WebAssembly. Drop a `.ttf` / `.otf` / `.woff` / `.woff2`, keep only the characters you
need, get a WOFF2 back.

The differentiator is the privacy story, and it is unusually concrete: every competing online
subsetter (Transfonter, Font Squirrel) requires uploading the font file, which a great many
commercial font EULAs prohibit outright. Glyphcut removes the upload entirely.

## Verified in a real browser

Driven end-to-end against a real 733 KB, 3,381-glyph TrueType font:

| Mode | Result |
|------|--------|
| Latin charset | 733.4 KB → 11.3 KB — **98.5% smaller**, 3,381 → 263 glyphs, 262 ms |
| Custom text (`"Glyphcut"`) | 733.4 KB → 1.4 KB — **99.8% smaller**, 8 characters, 9 glyphs, 15 ms |

Also confirmed: metadata inspector (family, glyph count, em square, `fsType` decoded to
"Editable"), correct `unicode-range` generation, live specimen rendering with the **output** font,
multi-file handling with no stale state, removal, all three modals opening and closing via Escape,
the log drawer's `×` and Escape at 375 px, no console errors, and no horizontal overflow on mobile.

## DNS

Already configured — Cloudflare `CNAME glyphcut → ben-gy.github.io` (DNS only) was created during
the build, and the GitHub Pages CNAME is set.

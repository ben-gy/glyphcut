# Tool Plan: Glyphcut

## Overview
- **Name:** Glyphcut
- **Repo name:** glyphcut
- **Tagline:** Subset and convert fonts to WOFF2 in your browser — without uploading a licensed font file anywhere.

## Problem It Solves

A front-end developer has been handed a 750 KB `.ttf` of the company's brand typeface and told to
get it onto the site without wrecking the Largest Contentful Paint. The font contains 3,381 glyphs
covering Cyrillic, Greek and Vietnamese; the site is English-only and uses maybe 90 distinct
characters. They need two things: the file converted to WOFF2, and everything they don't use cut
out of it.

The tools that come up when they search — Transfonter, Font Squirrel's Webfont Generator, and a
long tail of "convert ttf to woff2" sites — all work the same way: **upload the font file to our
server**. That is a genuine problem, not a hypothetical one:

- Commercial font EULAs routinely prohibit transferring the font software to a third party.
  Uploading a licensed font to a random conversion site is, for many foundry licences, a
  straightforward breach.
- If it's a bespoke or unreleased brand typeface, the file *is* the confidential asset. It has not
  shipped yet and it is now sitting on someone else's disk.
- In an agency or enterprise setting, "I uploaded the client's licensed font to a free website"
  is the kind of sentence that starts a legal conversation.

So the developer either breaks the licence, or installs a Python toolchain (`fonttools`,
`brotli`, `pyftsubset`) to run one command, or ships the 750 KB file. Glyphcut is the fourth
option: the same `pyftsubset` engine — HarfBuzz — compiled to WebAssembly and run inside their own
tab. The font never goes anywhere.

## Why This Must Be Client-Side

- **Licensing.** This is the central argument. The tool's whole reason to exist is that the
  competing tools require an upload that the user's font licence may forbid. Client-side is not a
  nice-to-have here; it is the product.
- **Sensitive-data handling.** An unreleased typeface is confidential IP in exactly the way a
  draft contract is.
- **No-account friction.** No sign-up, no queue, no "your file will be deleted in 24 hours"
  promise that the user has to take on trust.
- **Speed.** Subsetting a 750 KB font takes ~50 ms of WASM. A round trip to a server is slower
  than doing the work.

## Browser APIs / Libraries Used

| API / Library | What it does for us | Fallback if unsupported |
|---------------|----------------------|-------------------------|
| WebAssembly (HarfBuzz `hb-subset`) | The actual subsetting engine — same code as `pyftsubset` | N/A — hard requirement; detected at load with a clear error |
| WebAssembly (`woff2-encoder`, Brotli) | SFNT ↔ WOFF2 compression and decompression | N/A — hard requirement |
| Web Workers | Whole font pipeline off the main thread; UI never freezes | Would block UI; worker support is universal in targets |
| Transferable ArrayBuffer | Zero-copy handoff of font bytes to/from the worker | Structured clone (slower, still correct) |
| CSS Font Loading API (`FontFace`) | Live preview rendered with the **actual subsetted output**, not the original | Preview panel hidden; downloads still work |
| `opentype.js` | Name table, OS/2 `fsType` embedding permissions, cmap coverage, variable axes | N/A — pure JS |
| File API + Drag and Drop | Multi-font ingest | `<input type=file>` tap-to-pick |
| Clipboard API | Copy the generated `@font-face` CSS | Manual select |
| Web Share API | Share the output file on mobile | Download link |
| Service Worker (PWA) | Works offline after first load — including the WASM | Online-only |

## Workflow (input → process → output)

1. User drops one or more `.ttf` / `.otf` / `.woff` / `.woff2` files.
2. Glyphcut parses each font locally and shows an **inspector**: family, style, outline format,
   glyph count, unit-per-em, variable axes, Unicode blocks covered, and the OS/2 `fsType`
   embedding permission decoded into plain English ("Editable embedding — web use permitted by
   the font's own embedding bits").
3. User picks what to keep — preset charsets (Latin, Latin Extended, Cyrillic, Greek, Vietnamese,
   numerals/punctuation), or pastes the **actual text of their site** and Glyphcut keeps exactly
   those characters and nothing else.
4. A worker runs HarfBuzz `hb-subset`, then Brotli-compresses the result to WOFF2.
5. User gets: the WOFF2 (and optionally the subsetted TTF/OTF), a before/after size readout, a
   ready-to-paste `@font-face` block with the correct `unicode-range`, and a **live preview
   rendered using the subsetted file itself** — so they can see the cut font actually working
   before they download it.

## Non-Goals

- No WOFF1 output. It is obsolete; every browser that matters takes WOFF2.
- No font *editing* — no glyph drawing, no metric changes, no renaming. Cutting and converting only.
- No cloud sync, no accounts, no server. Ever.
- No font format conversion beyond the SFNT/WOFF2 family (no SVG fonts, no EOT, no bitmap).
- v1 subsets each font independently; no cross-font "shared subset" optimisation.

## Target Audience

Front-end developers and web designers optimising web font delivery. Specifically: someone at
their desk with a licensed brand font, a Lighthouse report complaining about render-blocking
resources, and a font EULA they'd rather not breach. Technical, comfortable with `@font-face` and
`unicode-range`, on a desktop, and skeptical by default — which is exactly why the preview renders
with the real output rather than asking them to trust a number.

## Style Direction

**Tone:** technical — precise, quantitative, no hand-holding. Numbers front and centre.
**Colour palette:** dark, near-black slate base with a single warm amber accent. Dark because this
is a developer tool used alongside an editor and a terminal; amber because the tool is fundamentally
about *cutting away*, and amber reads as "precision instrument" rather than the default dev-tool
blue — it also keeps the type specimen (which is always rendered in near-white) the brightest thing
on the screen, which is correct for a font tool.
**UI density:** dense — this is an inspector, and the user wants the numbers visible at once.
**Dark/light theme:** dark.
**Reference tools for feel:** Transfonter (the layout it should have had) and Wakamai Fondue
(font inspection presented as something worth reading).

## Technical Architecture

- **Stack:** Vanilla TypeScript + Vite. No React — the state is one font list and one options
  object; a component tree would be pure overhead.
- **Key libraries:** `harfbuzzjs` (for `harfbuzz-subset.wasm`, driven through hand-written raw
  WASM bindings — the package ships no JS wrapper for the subsetter), `woff2-encoder` (ESM,
  browser-first, bundles its own WASM, does both compress and decompress), `opentype.js`
  (metadata only).
- **Worker strategy:** one dedicated ES module worker owning both WASM modules for the whole
  session. Fonts go in as transferred ArrayBuffers, results come back the same way. The WASM is
  instantiated once and reused across every font and every re-subset, so changing the charset and
  re-cutting is instant.
- **WASM sourcing:** `harfbuzz-subset.wasm` is **vendored into `public/`** and fetched
  same-origin — never from a CDN. This matters for the privacy claim (no third-party request can
  observe that you're using the tool) and for the offline guarantee.
- **Storage:** `localStorage` for UI preferences (last-used charset selection, preview text) only.
  Font bytes are held in memory for the session and never persisted.

## Privacy & Trust Model

**Protected**
- The font file itself. It is read with the File API, processed in a Web Worker by WASM, and
  written back out as a Blob. There is no code path in the app that sends font bytes anywhere.
- The custom text you paste to subset against — which, for a real site, is your unreleased copy.
- Font metadata: family names, foundry, version, embedding permissions. All parsed locally.
- The tool works with the network fully disconnected after first load (Service Worker).

**Not protected**
- GitHub Pages serves the page and logs the request (IP, user agent) like any web server. That
  happens on page load, before any font is involved.
- A Cloudflare Web Analytics beacon records an anonymous page view.
- If you use the feedback form, what you type in it is sent — deliberately, and only then.
- Glyphcut does not and cannot check your font licence. It removes the *technical* need to upload
  the font; whether you're licensed to subset and self-host it at all is between you and the
  foundry. The `fsType` bits it shows you are the font's own machine-readable embedding
  permissions, which are informative but are **not** the licence.

**Trust surface**
- The static site bundle served by GitHub Pages over TLS.
- The two vendored WASM binaries (HarfBuzz and the WOFF2/Brotli encoder), both built from the
  upstream open-source projects and pinned in the repo.
- No third-party origin is contacted at runtime for the tool to function.

## UX Required Surfaces

- Multi-file drop zone with drag-drop, tap-to-pick, and accepted-format caption
- Per-font inspector card with coverage, axes and `fsType` decoded
- Determinate progress per font with byte readout
- Live specimen preview rendered from the subsetted output via `FontFace`
- Copy-to-clipboard `@font-face` snippet with generated `unicode-range`
- Event log drawer with in-drawer `×` and Escape-to-close (verified at 375px)
- How-It-Works modal (5 steps)
- Privacy modal (Protected / Not protected / Trust surface)
- About modal with benrichardson.dev + sites.benrichardson.dev attribution and repo link
- Download per file + Web Share
- Keyboard: Escape closes, Cmd/Ctrl+Enter re-cuts, `?` shows shortcuts
- Sticky footer with attribution + feedback widget

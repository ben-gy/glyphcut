# glyphcut

**Subset fonts and convert them to WOFF2 in your browser — without uploading a licensed font file anywhere.**

Live: https://glyphcut.benrichardson.dev

---

## what it is

You have a 750 KB `.ttf` of a brand typeface and a site that uses about ninety characters of it.
You need it converted to WOFF2 and stripped of the 3,000 glyphs you'll never render. Glyphcut does
that in the browser tab you already have open.

Every other online font subsetter — Transfonter, Font Squirrel's Webfont Generator, and the long
tail of "convert ttf to woff2" sites — works by uploading the font to a server. That is a real
problem, not a hypothetical one. Commercial font EULAs routinely prohibit transferring the font
software to a third party, so uploading a licensed font to a conversion site is a plain breach of
many foundry licences. If the typeface is bespoke or unreleased, the file *is* the confidential
asset, and it is now on somebody else's disk.

Glyphcut removes the upload. It runs the same subsetting engine the command-line tools use —
HarfBuzz's `hb-subset`, the engine behind `pyftsubset` — compiled to WebAssembly and executed
inside your tab. Drop a font in, choose the characters to keep, get a WOFF2 back. Typical results
are 90–98% smaller; subsetting to the exact text of a page routinely lands above 99%.

It also tells you what you're working with: family and foundry, glyph count, Unicode coverage by
block, variable-font axes, and the OS/2 `fsType` embedding permissions the font declares about
itself.

## how it works

```
  .ttf / .otf ──────────────────────────┐
  .woff  ── DecompressionStream ────────┤
  .woff2 ── Brotli (woff2-encoder) ─────┤
                                        ▼
                                   SFNT bytes
                                        │
                          ┌─────────────┴──────────────┐
                          ▼                            ▼
                  first-party table            HarfBuzz hb-subset
                  reader (inspector)              (WebAssembly)
                          │                            │
              family · glyphs · cmap             subsetted SFNT
              fvar axes · fsType                       │
                                          ┌────────────┴────────────┐
                                          ▼                         ▼
                                   Brotli → WOFF2            subsetted TTF/OTF
                                          │
                                    FontFace(bytes)
                                          │
                                  live specimen preview
```

Everything above happens inside one dedicated Web Worker. Font bytes are transferred into it once
and stay there for the session, so changing the character set and re-cutting never re-reads the
file — and the main thread never touches font data at all.

The specimen preview is deliberately rendered from the **output** file, loaded back into the page
with the CSS Font Loading API. You are looking at the font you're about to download, not a
rendering of the original with a size claim next to it.

### the inspector

Rather than pulling in a full font parser, Glyphcut ships a small first-party SFNT table reader
that understands exactly six tables: `head`, `maxp`, `name`, `OS/2`, `cmap` and `fvar`. This is
more robust, not less — a complete parser has to understand every table it meets and tends to
throw on unusual ones, whereas this reader skips what it doesn't recognise, so a font it cannot
fully describe still loads and still subsets.

## browser APIs used

- **WebAssembly** — HarfBuzz `hb-subset` does the cutting; Google's WOFF2 encoder does the Brotli
  compression. Both binaries are vendored in this repo and served same-origin, never from a CDN.
- **Web Workers** — the entire font pipeline runs off the main thread.
- **Transferable ArrayBuffer** — zero-copy handoff of font bytes in both directions.
- **CSS Font Loading API (`FontFace`)** — loads the subsetted output back into the page for the
  live specimen.
- **Compression Streams (`DecompressionStream`)** — inflates WOFF 1.0 tables natively, so `.woff`
  input needs no extra dependency.
- **File API + Drag and Drop** — multi-font ingest.
- **Clipboard API** — copies the generated `@font-face` block.
- **Web Share API** — shares the output file where the browser supports it.
- **Service Worker** — the app and its WebAssembly keep working with the network disconnected.

## security / privacy model

**Protected**

- The font file never leaves your device. It is read with the File API, processed by WebAssembly
  in a Web Worker, and written back out as a Blob. No code path exists that sends font bytes
  anywhere.
- The custom text you paste to subset against — often unreleased site copy — is treated the same.
- Font metadata is parsed locally; nothing is looked up remotely.
- No third-party origin is contacted for the tool to function.
- It works fully offline after first load, which is also the easiest way to verify the claims
  above for yourself.

**Not protected**

- GitHub Pages serves this site and logs the page request (IP, user agent) like any web server.
  That happens before a font is involved.
- A Cloudflare Web Analytics beacon records an anonymous page view.
- Anything typed into the feedback form is sent, deliberately, and only when you press Send.
- Glyphcut cannot check your font licence. It removes the *technical* need to upload the font;
  whether you may subset and self-host it at all is between you and the foundry. The `fsType` bits
  shown in the inspector are the font's own machine-readable embedding declaration and are **not**
  the licence.

**Trust model**

- The static bundle served by GitHub Pages, and the TLS chain to it.
- The two vendored WebAssembly binaries, built from their upstream open-source projects and pinned
  in this repository.

## stack

- Vite 6 + vanilla TypeScript — no framework
- `harfbuzz-subset.wasm` from [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) 1.4.0, vendored
  into `public/`
- [`woff2-encoder`](https://github.com/itskyedo/woff2-encoder) for WOFF2 compression and
  decompression
- A first-party SFNT table reader (`src/sfnt.ts`) and WOFF 1.0 unwrapper (`src/woff.ts`)
- Vitest for unit tests — including an end-to-end test that drives the real HarfBuzz binary
  against a TrueType font synthesised in the test suite
- GitHub Pages for hosting, deployed via GitHub Actions

No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via
Cloudflare Web Analytics — no personal data, no cross-site tracking.

## local development

```bash
npm install
npm run dev      # vite dev server on :5173
npm test         # run vitest suite
npm run build    # produce dist/ for deploy
npm run preview  # serve dist/ locally
```

## deploying

A push to `main` triggers `.github/workflows/deploy.yml`, which runs tests, builds, and deploys
`dist/` to GitHub Pages. The custom domain is set via `public/CNAME` — point a `CNAME` DNS record
for `glyphcut.benrichardson.dev` at `ben-gy.github.io`.

When changing anything the service worker caches, bump `VERSION` in `public/sw.js`; a fixed cache
key would serve stale HTML to returning visitors.

## license

MIT — see [LICENSE](./LICENSE).

HarfBuzz is MIT licensed; the WOFF2 reference implementation is MIT licensed. Both are vendored
here in binary form with their upstream licences intact.

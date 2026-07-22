// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/** Modal shell plus the four content panels: how it works, privacy, about, shortcuts. */
import { term } from './glossary';

let openModal: HTMLElement | null = null;
let lastFocused: HTMLElement | null = null;

export function closeModal(): void {
  if (!openModal) return;
  openModal.remove();
  openModal = null;
  document.body.classList.remove('modal-open');
  lastFocused?.focus();
  lastFocused = null;
}

export function isModalOpen(): boolean {
  return openModal !== null;
}

function showModal(title: string, bodyHtml: string): void {
  closeModal();
  lastFocused = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);

  overlay.innerHTML = `
    <div class="modal">
      <header class="modal-head">
        <h2>${title}</h2>
        <button class="modal-close" type="button" aria-label="Close dialog">&times;</button>
      </header>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  `;

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  overlay.querySelector('.modal-close')?.addEventListener('click', closeModal);

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  openModal = overlay;
  overlay.querySelector<HTMLElement>('.modal-close')?.focus();
}

export function showHowItWorks(): void {
  showModal(
    'How Glyphcut works',
    `
    <ol class="steps">
      <li>
        <h3>Your font is read in the page, not uploaded</h3>
        <p>Dropping a file hands Glyphcut an ordinary <code>File</code> object. The bytes are read with
        the File API and passed straight to a Web Worker. No <code>fetch</code>, no form post, no upload
        of any kind exists in the code.</p>
      </li>
      <li>
        <h3>The container is unwrapped to ${term('SFNT', 'sfnt')}</h3>
        <p><code>.woff2</code> is Brotli-decompressed and <code>.woff</code> is inflated with the browser's
        own Compression Streams API. <code>.ttf</code> and <code>.otf</code> are already SFNT and pass through
        untouched.</p>
      </li>
      <li>
        <h3>The font is parsed to show you what's inside</h3>
        <p>Glyphcut reads the <code>name</code>, <code>OS/2</code>, ${term('cmap', 'cmap')}, <code>head</code>,
        <code>maxp</code> and <code>fvar</code> tables to report the family, the glyph count, the Unicode
        coverage, any ${term('variable font', 'variable-font')} axes, and the ${term('fsType', 'fstype')}
        embedding bits the font declares about itself.</p>
      </li>
      <li>
        <h3>${term('HarfBuzz', 'harfbuzz')} cuts the glyphs you don't need</h3>
        <p>The subsetting engine is HarfBuzz's <code>hb-subset</code> — the same code behind the
        <code>pyftsubset</code> command-line tool — compiled to ${term('WebAssembly', 'wasm')} and running
        inside your tab. You give it a set of ${term('codepoints', 'codepoint')}; it rebuilds the font
        containing only the glyphs those characters need, plus whatever they depend on.</p>
      </li>
      <li>
        <h3>The result is compressed to ${term('WOFF2', 'woff2')} and previewed</h3>
        <p>The cut font is ${term('Brotli', 'brotli')}-compressed into a WOFF2, then loaded back into the
        page with the CSS Font Loading API. The specimen you see is rendered <em>with the output file
        itself</em> — so you are checking the real thing, not a promise about it.</p>
      </li>
    </ol>
  `,
  );
}

export function showPrivacy(): void {
  showModal(
    'Privacy &amp; threat model',
    `
    <p class="modal-lede">Glyphcut exists because the alternatives require you to upload a font file that
    your licence may not permit you to share. Here is exactly what it does and does not do.</p>

    <h3 class="tm-head tm-good">Protected</h3>
    <ul>
      <li><strong>The font file never leaves your device.</strong> It is read with the File API, processed
      by WebAssembly in a Web Worker, and written back out as a Blob you download. There is no network
      code path that font bytes can reach.</li>
      <li><strong>The text you paste to subset against stays local too.</strong> For a real project that
      is often unreleased site copy, so it is treated exactly like the font.</li>
      <li><strong>Font metadata is parsed locally</strong> — family name, foundry, version and embedding
      permissions are read in the page, never looked up remotely.</li>
      <li><strong>No third-party requests are needed to work.</strong> The HarfBuzz and WOFF2 WebAssembly
      binaries are served from this same origin, not a CDN.</li>
      <li><strong>It works offline.</strong> After the first load a Service Worker caches the app and the
      WebAssembly, so you can disconnect entirely and keep cutting fonts. That is also the simplest way
      to verify the claim above for yourself.</li>
    </ul>

    <h3 class="tm-head tm-bad">Not protected</h3>
    <ul>
      <li><strong>The page load itself is a normal web request.</strong> GitHub Pages serves this site and
      logs the request — your IP and user agent — as any web server would. That happens before a font is
      involved.</li>
      <li><strong>Anonymous page views are counted.</strong> See the trust surface below.</li>
      <li><strong>Anything you type into the feedback form is sent</strong>, deliberately, and only when
      you press Send.</li>
      <li><strong>Glyphcut cannot check your font licence.</strong> It removes the technical need to upload
      the font. Whether you are permitted to subset and self-host that font at all is between you and the
      foundry. The fsType bits shown in the inspector are the font's own embedding declaration and are
      <em>not</em> the licence.</li>
    </ul>

    <h3 class="tm-head tm-info">Trust surface</h3>
    <ul>
      <li>The static bundle served by GitHub Pages, and the TLS chain between you and it.</li>
      <li>The two vendored WebAssembly binaries — HarfBuzz's subsetter and the WOFF2/Brotli encoder —
      both built from their upstream open-source projects and pinned in this repository.</li>
      <li>A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting,
      no cross-site tracking; your files and data are never sent to it.</li>
      <li>Feedback you choose to send (and an email address, only if you supply one) is sent to
      feedback.benrichardson.dev. Nothing is sent unless you open the feedback form and press Send; your
      files and data never are.</li>
    </ul>
  `,
  );
}

export function showAbout(): void {
  showModal(
    'About Glyphcut',
    `
    <p>Glyphcut subsets and converts fonts entirely inside your browser. Drop in a
    <code>.ttf</code>, <code>.otf</code>, <code>.woff</code> or <code>.woff2</code>, keep only the
    characters your site actually uses, and get a WOFF2 that is routinely 90–98% smaller than the
    original — without the font file ever being uploaded anywhere.</p>

    <p>It was built because every other online font subsetter works by taking your font onto their
    server, and a great many commercial font licences do not permit that.</p>

    <h3>Built with</h3>
    <ul>
      <li><a href="https://harfbuzz.github.io/" target="_blank" rel="noopener">HarfBuzz</a> —
      <code>hb-subset</code> compiled to WebAssembly, doing the actual cutting.</li>
      <li><a href="https://github.com/itskyedo/woff2-encoder" target="_blank" rel="noopener">woff2-encoder</a>
      — Google's WOFF2 reference implementation, for Brotli compression both ways.</li>
      <li>A small first-party SFNT table reader for the inspector.</li>
      <li>Vite and TypeScript. No framework, no tracking, no accounts.</li>
    </ul>

    <h3>Who made it</h3>
    <p>Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>.
    The full catalogue of tools and sites lives at
    <a href="https://sites.benrichardson.dev" target="_blank" rel="noopener">sites.benrichardson.dev</a>.</p>
    <p>Source: <a href="https://github.com/ben-gy/glyphcut" target="_blank" rel="noopener">github.com/ben-gy/glyphcut</a>.</p>
  `,
  );
}

export function showShortcuts(): void {
  showModal(
    'Keyboard shortcuts',
    `
    <table class="shortcuts">
      <tbody>
        <tr><td><kbd>?</kbd></td><td>Show this list</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close a dialog, the log drawer, or a tooltip</td></tr>
        <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd></td><td>Re-cut all loaded fonts</td></tr>
        <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>O</kbd></td><td>Open the file picker</td></tr>
        <tr><td><kbd>L</kbd></td><td>Toggle the event log drawer</td></tr>
      </tbody>
    </table>
    <p class="modal-note">Shortcuts are ignored while you are typing in a text field.</p>
  `,
  );
}

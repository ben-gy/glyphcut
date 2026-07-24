// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
import './styles/main.css';
import { CHARSETS, blockCoverage, formatBytes, percentSaved, toUnicodeRange } from './charsets';
import { eventLog } from './eventlog';
import { hideGlossary, initGlossary, term } from './glossary';
import { closeModal, isModalOpen, showAbout, showHowItWorks, showPrivacy, showShortcuts } from './modals';
import { fontService, type LoadedFontResponse } from './fontservice';
import { describeEmbedding } from './sfnt';
import type { SubsetOptions, SubsetResult } from './types';

const PREFS_KEY = 'glyphcut.prefs.v1';
const DEFAULT_PREVIEW_TEXT = 'Handgloves & Quartz — 0123456789';

interface FontEntry {
  info: LoadedFontResponse;
  status: 'idle' | 'working' | 'done' | 'error';
  stage?: string;
  result?: SubsetResult;
  error?: string;
  previewFamily?: string;
  urls: string[];
}

const entries: FontEntry[] = [];

let options: SubsetOptions = {
  charsets: ['latin'],
  customText: '',
  keepAll: false,
  keepLayoutFeatures: true,
  keepHinting: false,
  pinAxesToDefault: false,
  outputs: ['woff2'],
};

let previewText = DEFAULT_PREVIEW_TEXT;
let previewSeq = 0;

// ─────────────────────────── preferences ───────────────────────────

function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<SubsetOptions> & { previewText?: string };
    options = {
      ...options,
      ...saved,
      // Guard against a malformed or hand-edited value.
      charsets: Array.isArray(saved.charsets) ? saved.charsets : options.charsets,
      outputs: Array.isArray(saved.outputs) && saved.outputs.length ? saved.outputs : options.outputs,
    };
    if (typeof saved.previewText === 'string' && saved.previewText) previewText = saved.previewText;
  } catch {
    // A corrupt preference blob should never stop the app loading.
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...options, previewText }));
  } catch {
    // Private browsing / quota — preferences are a nicety, not a requirement.
  }
}

// ─────────────────────────── shell ───────────────────────────

function shell(): string {
  return `
    <header class="site-header">
      <div class="brand">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#1a1c24"/>
          <text x="16" y="23.5" font-family="Georgia, serif" font-size="22" font-weight="700"
                text-anchor="middle" fill="#f5b544">G</text>
          <path d="M4 26.5 L28 9.5" stroke="#1a1c24" stroke-width="3.2" stroke-linecap="round"/>
          <path d="M4 26.5 L28 9.5" stroke="#f5b544" stroke-width="1" stroke-linecap="round"
                opacity="0.55" stroke-dasharray="2 3"/>
        </svg>
        <div class="brand-text">
          <h1>Glyphcut</h1>
          <p>Font subsetter &amp; WOFF2 converter</p>
        </div>
      </div>
      <nav class="site-nav">
        <button type="button" data-action="how">How it works</button>
        <button type="button" data-action="privacy">Privacy</button>
        <button type="button" data-action="about">About</button>
        <button type="button" data-action="log" class="log-toggle" aria-expanded="false">
          Log <span class="log-badge" id="log-badge" hidden>0</span>
        </button>
      </nav>
    </header>

    <main class="main-content">
      <button type="button" class="trust-banner" data-action="privacy">
        <span class="trust-dot" aria-hidden="true"></span>
        <span><strong>Runs entirely in your browser.</strong> Your font file is never uploaded — which is
        the point, because most commercial font licences don't permit it.</span>
        <span class="trust-more">Read the threat model →</span>
      </button>

      <section class="dropzone" id="dropzone" tabindex="0" role="button"
               aria-label="Add font files. Drag and drop, or press Enter to browse.">
        <input type="file" id="file-input" multiple accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden />
        <div class="dz-inner">
          <svg class="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M12 4v16"/><path d="M9 20h6"/>
          </svg>
          <p class="dz-title">Drop font files here</p>
          <p class="dz-sub">or <span class="dz-link">browse</span> — .ttf, .otf, .woff, .woff2 · multiple files welcome</p>
        </div>
      </section>

      <section class="panel options-panel" id="options-panel" hidden>
        <h2 class="panel-title">What to keep</h2>
        <div class="options-grid">
          <div class="opt-col">
            <h3>Character sets</h3>
            <div class="charset-list" id="charset-list"></div>
          </div>
          <div class="opt-col">
            <h3>…or the exact text you use</h3>
            <p class="opt-hint">Paste your site's copy. Glyphcut keeps only the characters that appear in
            it — usually the smallest possible font.</p>
            <textarea id="custom-text" class="text-input" rows="4"
                      placeholder="Paste headings, nav labels, body copy…"></textarea>
            <p class="opt-count" id="custom-count"></p>
          </div>
          <div class="opt-col">
            <h3>Options</h3>
            <label class="check"><input type="checkbox" id="opt-keepall" />
              <span>Keep every character <em>(convert only, no subsetting)</em></span></label>
            <label class="check"><input type="checkbox" id="opt-features" />
              <span>Keep ${term('layout features', 'layout-features')} <em>(kerning, ligatures)</em></span></label>
            <label class="check"><input type="checkbox" id="opt-hinting" />
              <span>Keep ${term('hinting', 'hinting')} <em>(larger; rarely needed)</em></span></label>
            <label class="check"><input type="checkbox" id="opt-pin" />
              <span>Flatten ${term('variable fonts', 'variable-font')} to default instance</span></label>
            <h3 class="opt-subhead">Output</h3>
            <label class="check"><input type="checkbox" id="out-woff2" />
              <span>${term('WOFF2', 'woff2')} <em>(for the web)</em></span></label>
            <label class="check"><input type="checkbox" id="out-sfnt" />
              <span>TTF / OTF <em>(for desktop or further tooling)</em></span></label>
            <h3 class="opt-subhead">Preview text</h3>
            <input type="text" id="preview-text" class="text-input" aria-label="Specimen preview text" />
          </div>
        </div>
        <div class="options-actions">
          <button type="button" class="btn btn-primary" id="recut">Cut fonts</button>
          <span class="options-note">Changing any option re-cuts automatically.</span>
        </div>
      </section>

      <section id="fonts" class="fonts"></section>
    </main>

    <footer class="site-footer">
      <div class="footer-inner">
        <span>Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
        · <a href="https://sites.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a></span>
      </div>
    </footer>

    <aside class="log-drawer" id="log-drawer" aria-hidden="true" aria-label="Event log">
      <header class="log-head">
        <h2>Event log</h2>
        <div class="log-head-actions">
          <button type="button" class="log-copy" id="log-copy">Copy</button>
          <button type="button" class="log-close" id="log-close" aria-label="Close event log">&times;</button>
        </div>
      </header>
      <div class="log-list" id="log-list"></div>
      <p class="log-foot">Every step above ran on this device.</p>
    </aside>
  `;
}

// ─────────────────────────── rendering ───────────────────────────

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function renderCharsets(): void {
  const host = document.getElementById('charset-list');
  if (!host) return;
  host.innerHTML = CHARSETS.map(
    (c) => `
    <label class="check charset" title="${escapeHtml(c.description)}">
      <input type="checkbox" data-charset="${c.id}" ${options.charsets.includes(c.id) ? 'checked' : ''} />
      <span>${escapeHtml(c.label)}</span>
    </label>`,
  ).join('');
}

function syncOptionInputs(): void {
  const set = (id: string, value: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.checked = value;
  };
  set('opt-keepall', options.keepAll);
  set('opt-features', options.keepLayoutFeatures);
  set('opt-hinting', options.keepHinting);
  set('opt-pin', options.pinAxesToDefault);
  set('out-woff2', options.outputs.includes('woff2'));
  set('out-sfnt', options.outputs.includes('sfnt'));

  const text = document.getElementById('custom-text') as HTMLTextAreaElement | null;
  if (text && text.value !== options.customText) text.value = options.customText;

  const preview = document.getElementById('preview-text') as HTMLInputElement | null;
  if (preview && preview.value !== previewText) preview.value = previewText;

  // When keeping everything, the character pickers are irrelevant.
  const disabled = options.keepAll;
  document.querySelectorAll<HTMLInputElement>('[data-charset]').forEach((el) => {
    el.disabled = disabled;
  });
  if (text) text.disabled = disabled;
  document.getElementById('charset-list')?.classList.toggle('is-disabled', disabled);

  updateCustomCount();
}

function updateCustomCount(): void {
  const el = document.getElementById('custom-count');
  if (!el) return;
  const unique = new Set([...options.customText].map((c) => c.codePointAt(0)));
  el.textContent = options.customText ? `${unique.size} unique characters` : '';
}

function embeddingBadge(fsType: number): string {
  const perm = describeEmbedding(fsType);
  return `<span class="badge badge-${perm.level}" title="${escapeHtml(perm.detail)}">${escapeHtml(
    perm.label,
  )}</span>`;
}

function renderInspector(entry: FontEntry): string {
  const { meta, originalSize, sfntSize, sourceFormat, fileName } = entry.info;
  const coverage = blockCoverage(meta.codepoints).slice(0, 6);
  const title = meta.family || fileName;
  const style = meta.subfamily ? ` <span class="fnt-style">${escapeHtml(meta.subfamily)}</span>` : '';

  const axes = meta.axes
    .map((a) => `<code>${escapeHtml(a.tag)}</code> ${a.min}–${a.max}`)
    .join(', ');

  return `
    <div class="fnt-head">
      <div class="fnt-id">
        <h3>${escapeHtml(title)}${style}</h3>
        <p class="fnt-file">${escapeHtml(fileName)} · ${sourceFormat.toUpperCase()} · ${formatBytes(originalSize)}</p>
      </div>
      <button type="button" class="fnt-remove" data-remove="${entry.info.fontId}" aria-label="Remove ${escapeHtml(
        fileName,
      )}">&times;</button>
    </div>
    <dl class="fnt-stats">
      <div><dt>Glyphs</dt><dd>${meta.numGlyphs.toLocaleString()}</dd></div>
      <div><dt>Characters</dt><dd>${meta.codepoints.length.toLocaleString()}</dd></div>
      <div><dt>Outlines</dt><dd>${meta.outlines === 'cff' ? 'CFF (PostScript)' : meta.outlines === 'truetype' ? 'TrueType' : 'Unknown'}</dd></div>
      <div><dt>${term('Em square', 'em-square')}</dt><dd>${meta.unitsPerEm || '—'}</dd></div>
      ${sourceFormat !== 'ttf' && sourceFormat !== 'otf' ? `<div><dt>Decompressed</dt><dd>${formatBytes(sfntSize)}</dd></div>` : ''}
      <div><dt>${term('Embedding', 'fstype')}</dt><dd>${embeddingBadge(meta.fsType)}</dd></div>
    </dl>
    ${meta.isVariable ? `<p class="fnt-var">${term('Variable font', 'variable-font')} · ${axes}</p>` : ''}
    ${
      coverage.length
        ? `<div class="coverage">${coverage
            .map((b) => `<span class="cov"><em>${escapeHtml(b.name)}</em> ${b.covered}</span>`)
            .join('')}</div>`
        : ''
    }
  `;
}

function cssSnippet(entry: FontEntry): string {
  const result = entry.result;
  if (!result) return '';
  const family = entry.info.meta.family || entry.info.fileName.replace(/\.[^.]+$/, '');
  const woff2 = result.files.find((f) => f.format === 'woff2');
  const sfnt = result.files.find((f) => f.format === 'sfnt');
  const sources: string[] = [];
  if (woff2) sources.push(`url('${woff2.fileName}') format('woff2')`);
  if (sfnt) {
    sources.push(`url('${sfnt.fileName}') format('${sfnt.fileName.endsWith('.otf') ? 'opentype' : 'truetype'}')`);
  }

  const range = toUnicodeRange(result.keptCodepoints);
  // A full CJK font produces an enormous range list; past a point it stops being useful to paste.
  const rangeLine = range && range.length <= 2000 ? `\n  unicode-range: ${range};` : '';

  const weight = entry.info.meta.axes.find((a) => a.tag === 'wght');
  const weightLine =
    weight && !options.pinAxesToDefault ? `\n  font-weight: ${weight.min} ${weight.max};` : '';

  return `@font-face {
  font-family: '${family}';
  src: ${sources.join(',\n       ')};
  font-display: swap;${weightLine}${rangeLine}
}`;
}

function renderResult(entry: FontEntry): string {
  if (entry.status === 'working') {
    return `<div class="fnt-progress"><span class="spinner" aria-hidden="true"></span>
      <span>${escapeHtml(entry.stage ?? 'Working')}…</span></div>`;
  }
  if (entry.status === 'error') {
    return `<div class="fnt-error" role="alert">
      <p><strong>Couldn't cut this font.</strong> ${escapeHtml(entry.error ?? '')}</p>
      <button type="button" class="btn btn-ghost" data-retry="${entry.info.fontId}">Try again</button>
    </div>`;
  }
  const result = entry.result;
  if (!result || entry.status !== 'done') return '';

  const primary = result.files[0];
  const saved = percentSaved(result.originalSize, primary?.size ?? result.originalSize);

  const downloads = result.files
    .map(
      (f, i) => `<button type="button" class="btn ${i === 0 ? 'btn-primary' : 'btn-ghost'}"
        data-download="${entry.info.fontId}" data-index="${i}">
        Download ${f.format === 'woff2' ? 'WOFF2' : 'TTF/OTF'} <span class="btn-size">${formatBytes(f.size)}</span>
      </button>`,
    )
    .join('');

  const missing = result.missingCodepoints.length;
  const missingSample = result.missingCodepoints
    .slice(0, 12)
    .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');

  return `
    <div class="result">
      <div class="result-headline">
        <div class="saving">
          <span class="saving-pct">${saved}%</span>
          <span class="saving-label">smaller</span>
        </div>
        <div class="saving-detail">
          <p><span class="before">${formatBytes(result.originalSize)}</span>
             <span class="arrow" aria-hidden="true">→</span>
             <strong class="after">${formatBytes(primary?.size ?? 0)}</strong></p>
          <p class="saving-sub">${result.glyphsBefore.toLocaleString()} → ${result.glyphsAfter.toLocaleString()} glyphs
             · ${result.keptCodepoints.length.toLocaleString()} characters · ${result.elapsedMs} ms</p>
        </div>
      </div>

      ${
        missing
          ? `<p class="notice notice-warn">${missing} requested character${missing === 1 ? '' : 's'}
             ${missing === 1 ? 'is' : 'are'} not in this font and could not be included${
               missingSample ? ` — ${escapeHtml(missingSample)}${missing > 12 ? ' …' : ''}` : ''
             }.</p>`
          : ''
      }

      <div class="specimen">
        <div class="specimen-label">Rendered with the cut font itself</div>
        <div class="specimen-text"${
          entry.previewFamily ? ` style="font-family: '${entry.previewFamily}', system-ui;"` : ''
        }>${escapeHtml(previewText)}</div>
      </div>

      <div class="result-actions">
        ${downloads}
        <button type="button" class="btn btn-ghost" data-share="${entry.info.fontId}" hidden>Share</button>
      </div>

      <details class="css-block">
        <summary>@font-face CSS</summary>
        <pre><code id="css-${entry.info.fontId}">${escapeHtml(cssSnippet(entry))}</code></pre>
        <button type="button" class="btn btn-ghost btn-sm" data-copycss="${entry.info.fontId}">Copy CSS</button>
      </details>
    </div>
  `;
}

function renderFonts(): void {
  const host = document.getElementById('fonts');
  if (!host) return;

  if (!entries.length) {
    host.innerHTML = '';
    document.getElementById('options-panel')?.setAttribute('hidden', '');
    return;
  }
  document.getElementById('options-panel')?.removeAttribute('hidden');

  host.innerHTML = entries
    .map(
      (entry) => `<article class="panel font-card" data-font="${entry.info.fontId}">
        ${renderInspector(entry)}
        ${renderResult(entry)}
      </article>`,
    )
    .join('');

  // Web Share is only offered where the browser can actually share files.
  for (const entry of entries) {
    if (entry.status !== 'done' || !entry.result) continue;
    const button = host.querySelector<HTMLButtonElement>(`[data-share="${entry.info.fontId}"]`);
    if (!button) continue;
    const file = entry.result.files[0];
    if (!file) continue;
    try {
      const probe = new File([file.bytes as BlobPart], file.fileName, { type: 'font/woff2' });
      if (navigator.canShare?.({ files: [probe] })) button.hidden = false;
    } catch {
      // canShare can throw on some engines; leaving the button hidden is the right fallback.
    }
  }
}

// ─────────────────────────── preview font loading ───────────────────────────

/** Register the subsetted font with the page so the specimen renders using the real output. */
async function installPreview(entry: FontEntry): Promise<void> {
  const file = entry.result?.files.find((f) => f.format === 'woff2') ?? entry.result?.files[0];
  if (!file) return;
  const family = `GlyphcutPreview${previewSeq++}`;
  try {
    // Copy the bytes: the FontFace holds onto the buffer, and the entry's copy is reused elsewhere.
    const face = new FontFace(family, file.bytes.slice().buffer as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    entry.previewFamily = family;
  } catch {
    eventLog.log(`Preview unavailable for ${entry.info.fileName} (the browser declined to load it)`, 'warn');
  }
}

// ─────────────────────────── pipeline ───────────────────────────

function revokeUrls(entry: FontEntry): void {
  for (const url of entry.urls) URL.revokeObjectURL(url);
  entry.urls = [];
}

async function cutOne(entry: FontEntry): Promise<void> {
  if (!options.outputs.length) {
    entry.status = 'error';
    entry.error = 'Choose at least one output format.';
    renderFonts();
    return;
  }

  entry.status = 'working';
  entry.stage = 'Starting';
  entry.error = undefined;
  revokeUrls(entry);
  renderFonts();

  try {
    const result = await fontService.subset(entry.info.fontId, options, (stage, detail) => {
      entry.stage = detail ? `${stage} — ${detail}` : stage;
      const node = document.querySelector(`[data-font="${entry.info.fontId}"] .fnt-progress span:last-child`);
      if (node) node.textContent = `${entry.stage}…`;
    });
    entry.result = result;
    entry.status = 'done';
    await installPreview(entry);

    const primary = result.files[0];
    eventLog.log(
      `Cut ${entry.info.fileName}: ${formatBytes(result.originalSize)} → ${formatBytes(primary.size)} ` +
        `(${percentSaved(result.originalSize, primary.size)}% smaller, ${result.glyphsAfter} glyphs, ${result.elapsedMs} ms)`,
      'good',
    );
    if (result.missingCodepoints.length) {
      eventLog.log(
        `${result.missingCodepoints.length} requested characters are absent from ${entry.info.fileName}`,
        'warn',
      );
    }
  } catch (err) {
    entry.status = 'error';
    entry.error = err instanceof Error ? err.message : 'Unknown error.';
    eventLog.log(`Failed to cut ${entry.info.fileName}: ${entry.error}`, 'bad');
  }
  renderFonts();
}

async function cutAll(): Promise<void> {
  if (!entries.length) return;
  await Promise.all(entries.map((entry) => cutOne(entry)));
}

let recutTimer: number | undefined;
function scheduleRecut(): void {
  window.clearTimeout(recutTimer);
  recutTimer = window.setTimeout(() => void cutAll(), 350);
}

async function addFiles(files: FileList | File[]): Promise<void> {
  const list = [...files];
  if (!list.length) return;

  for (const file of list) {
    eventLog.log(`Reading ${file.name} (${formatBytes(file.size)})`);
    try {
      const info = await fontService.load(file, (stage) => eventLog.log(`${file.name}: ${stage}`));
      const entry: FontEntry = { info, status: 'idle', urls: [] };
      entries.push(entry);
      const name = info.meta.family || file.name;
      eventLog.log(
        `Loaded ${name} — ${info.meta.numGlyphs.toLocaleString()} glyphs, ${info.meta.codepoints.length.toLocaleString()} characters`,
        'good',
      );
      if (info.meta.fsType >= 0) {
        const perm = describeEmbedding(info.meta.fsType);
        eventLog.log(`${name} declares embedding: ${perm.label}`, perm.level === 'warn' ? 'warn' : 'info');
      }
      renderFonts();
      await cutOne(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      eventLog.log(`Could not read ${file.name}: ${message}`, 'bad');
      showToast(`${file.name}: ${message}`);
    }
  }
  renderFonts();
}

// ─────────────────────────── toast ───────────────────────────

let toastTimer: number | undefined;
function showToast(message: string): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.classList.remove('is-visible'), 4000);
}

// ─────────────────────────── actions ───────────────────────────

function entryById(id: string): FontEntry | undefined {
  return entries.find((e) => e.info.fontId === id);
}

function downloadFile(entry: FontEntry, index: number): void {
  const file = entry.result?.files[index];
  if (!file) return;
  const blob = new Blob([file.bytes as BlobPart], { type: file.format === 'woff2' ? 'font/woff2' : 'font/sfnt' });
  const url = URL.createObjectURL(blob);
  entry.urls.push(url);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  eventLog.log(`Downloaded ${file.fileName} (${formatBytes(file.size)})`, 'good');
}

async function shareFile(entry: FontEntry): Promise<void> {
  const file = entry.result?.files[0];
  if (!file) return;
  try {
    const shareFileObj = new File([file.bytes as BlobPart], file.fileName, { type: 'font/woff2' });
    await navigator.share({ files: [shareFileObj], title: file.fileName });
    eventLog.log(`Shared ${file.fileName}`, 'good');
  } catch (err) {
    // An AbortError just means the user dismissed the sheet — not worth reporting.
    if (err instanceof Error && err.name !== 'AbortError') {
      showToast(`Share failed: ${err.message}`);
    }
  }
}

async function copyCss(entry: FontEntry): Promise<void> {
  const css = cssSnippet(entry);
  try {
    await navigator.clipboard.writeText(css);
    showToast('@font-face CSS copied');
    eventLog.log('Copied @font-face CSS to the clipboard');
  } catch {
    showToast('Clipboard blocked — select the CSS and copy manually.');
  }
}

async function removeEntry(id: string): Promise<void> {
  const index = entries.findIndex((e) => e.info.fontId === id);
  if (index < 0) return;
  const [entry] = entries.splice(index, 1);
  revokeUrls(entry);
  eventLog.log(`Removed ${entry.info.fileName}`);
  renderFonts();
  try {
    await fontService.release(id);
  } catch {
    // The worker may already be gone; nothing to clean up.
  }
}

// ─────────────────────────── wiring ───────────────────────────

function wireDropzone(): void {
  const dropzone = document.getElementById('dropzone');
  const input = document.getElementById('file-input') as HTMLInputElement | null;
  if (!dropzone || !input) return;

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => {
    if (input.files) void addFiles(input.files);
    input.value = '';
  });

  // Dragging anywhere over the page should not navigate away from it.
  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'dragleave' && dropzone.contains((event as DragEvent).relatedTarget as Node)) return;
      dropzone.classList.remove('is-over');
    });
  }
  dropzone.addEventListener('drop', (event) => {
    const dt = (event as DragEvent).dataTransfer;
    if (dt?.files?.length) void addFiles(dt.files);
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

function wireOptions(): void {
  const panel = document.getElementById('options-panel');
  if (!panel) return;

  panel.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    const charset = target.dataset.charset;
    if (charset) {
      options.charsets = target.checked
        ? [...options.charsets, charset]
        : options.charsets.filter((c) => c !== charset);
    } else {
      switch (target.id) {
        case 'opt-keepall':
          options.keepAll = target.checked;
          break;
        case 'opt-features':
          options.keepLayoutFeatures = target.checked;
          break;
        case 'opt-hinting':
          options.keepHinting = target.checked;
          break;
        case 'opt-pin':
          options.pinAxesToDefault = target.checked;
          break;
        case 'out-woff2':
        case 'out-sfnt': {
          const format = target.id === 'out-woff2' ? 'woff2' : 'sfnt';
          options.outputs = target.checked
            ? [...options.outputs, format as 'woff2' | 'sfnt']
            : options.outputs.filter((f) => f !== format);
          // WOFF2 first, so it stays the headline result.
          options.outputs.sort((a, b) => (a === b ? 0 : a === 'woff2' ? -1 : 1));
          if (!options.outputs.length) {
            showToast('Pick at least one output format.');
          }
          break;
        }
        default:
          return;
      }
    }
    syncOptionInputs();
    savePrefs();
    scheduleRecut();
  });

  const text = document.getElementById('custom-text') as HTMLTextAreaElement | null;
  text?.addEventListener('input', () => {
    options.customText = text.value;
    updateCustomCount();
    savePrefs();
    scheduleRecut();
  });

  const preview = document.getElementById('preview-text') as HTMLInputElement | null;
  preview?.addEventListener('input', () => {
    previewText = preview.value;
    savePrefs();
    // Update the specimens in place — a full re-render would drop focus from this field.
    document.querySelectorAll<HTMLElement>('.specimen-text').forEach((node) => {
      node.textContent = previewText;
    });
  });

  document.getElementById('recut')?.addEventListener('click', () => void cutAll());
}

function wireFontActions(): void {
  document.getElementById('fonts')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>('[data-download],[data-share],[data-copycss],[data-remove],[data-retry]');
    if (!button) return;

    const { download, share, copycss, remove, retry } = button.dataset;
    if (download) {
      const entry = entryById(download);
      if (entry) downloadFile(entry, Number(button.dataset.index ?? 0));
    } else if (share) {
      const entry = entryById(share);
      if (entry) void shareFile(entry);
    } else if (copycss) {
      const entry = entryById(copycss);
      if (entry) void copyCss(entry);
    } else if (remove) {
      void removeEntry(remove);
    } else if (retry) {
      const entry = entryById(retry);
      if (entry) void cutOne(entry);
    }
  });
}

function wireNav(): void {
  document.querySelector('.site-nav')?.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'how') showHowItWorks();
    else if (action === 'privacy') showPrivacy();
    else if (action === 'about') showAbout();
    else if (action === 'log') toggleLog();
  });

  document.querySelector('.trust-banner')?.addEventListener('click', () => showPrivacy());
  document.getElementById('log-close')?.addEventListener('click', () => setLogOpen(false));
  document.getElementById('log-copy')?.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(eventLog.asText())
      .then(() => showToast('Event log copied'))
      .catch(() => showToast('Clipboard blocked'));
  });
}

function setLogOpen(open: boolean): void {
  if (open) eventLog.open();
  else eventLog.close();
  document.querySelector('.log-toggle')?.setAttribute('aria-expanded', String(open));
}

function toggleLog(): void {
  setLogOpen(!eventLog.isOpen());
}

function wireKeyboard(): void {
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;

    if (event.key === 'Escape') {
      if (isModalOpen()) closeModal();
      else if (eventLog.isOpen()) setLogOpen(false);
      else hideGlossary();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void cutAll();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      (document.getElementById('file-input') as HTMLInputElement | null)?.click();
      return;
    }

    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === '?') {
      event.preventDefault();
      showShortcuts();
    } else if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      toggleLog();
    }
  });
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || location.protocol === 'http:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is a bonus; failing to register must not surface as an error.
    });
  });
}

// ─────────────────────────── boot ───────────────────────────

function init(): void {
  const app = document.getElementById('app');
  if (!app) return;
  loadPrefs();
  app.innerHTML = shell();

  renderCharsets();
  syncOptionInputs();
  renderFonts();

  const drawer = document.getElementById('log-drawer');
  const list = document.getElementById('log-list');
  const badge = document.getElementById('log-badge');
  if (drawer && list && badge) eventLog.mount(drawer, list, badge);

  initGlossary();
  wireDropzone();
  wireOptions();
  wireFontActions();
  wireNav();
  wireKeyboard();
  registerServiceWorker();

  eventLog.log('Glyphcut ready — everything runs on this device', 'good');

  if (typeof WebAssembly === 'undefined') {
    showToast('This browser has no WebAssembly support, so Glyphcut cannot run.');
    eventLog.log('WebAssembly is unavailable in this browser', 'bad');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

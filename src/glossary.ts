/**
 * Click-to-define tooltips. Font tooling is dense with jargon and the audience is technical but
 * not necessarily typographic — plenty of good front-end developers have never had a reason to
 * learn what an em square is.
 */

export const GLOSSARY: Record<string, string> = {
  subset:
    'Cutting glyphs out of a font so only the characters you actually use remain. A 3,000-glyph font trimmed to the ~100 characters an English page needs is often 95% smaller.',
  woff2:
    'Web Open Font Format 2 — the standard web font container. It wraps an ordinary font in Brotli compression and is supported by every browser in current use.',
  sfnt: 'The shared binary layout behind TrueType and OpenType fonts: a directory of named tables (glyf, cmap, name…) followed by the table data itself.',
  glyph:
    'A single drawn shape in a font. Not the same as a character: one character can have several glyphs (alternates, small caps), and one glyph can serve several characters.',
  codepoint:
    'A number Unicode assigns to a character — U+0041 is "A". Fonts map codepoints to glyphs through their cmap table.',
  cmap: 'The font table mapping Unicode codepoints to glyph indices. If a character is missing from cmap, the font cannot render it.',
  hinting:
    'Extra instructions telling the rasteriser how to snap outlines to the pixel grid at small sizes. Modern rendering largely ignores it, so dropping hinting usually saves bytes with no visible change.',
  'layout-features':
    'OpenType features like kerning (kern), ligatures (liga) and old-style figures (onum). Dropping them shrinks the file but loses the typography they provide.',
  'unicode-range':
    'A CSS descriptor listing which characters a @font-face covers. The browser only downloads the font if the page actually uses a character in that range.',
  'variable-font':
    'A single font file containing a continuous range of styles along one or more axes — weight, width, optical size — instead of one file per style.',
  axis: 'A dimension of variation in a variable font, identified by a four-letter tag such as wght (weight) or wdth (width).',
  fstype:
    'Bits in the OS/2 table where the font declares how it may be embedded. They are the font’s own machine-readable statement of intent, and are not a substitute for reading the licence.',
  harfbuzz:
    'The open-source text shaping engine used by Chrome, Firefox, Android and LibreOffice. Its subsetter is the same engine behind the pyftsubset command-line tool — here compiled to WebAssembly and run in your tab.',
  'em-square':
    'The design grid a font is drawn on, given in units per em. 1000 and 2048 are the usual values; it sets the resolution of the outlines, not their visual size.',
  brotli:
    'The compression algorithm WOFF2 uses. It reaches noticeably smaller sizes than gzip on font data, which is why WOFF2 beats WOFF.',
  wasm: 'WebAssembly — a portable binary format that lets compiled C/C++ (like HarfBuzz) run in a browser at near-native speed.',
};

let tooltip: HTMLElement | null = null;

function ensureTooltip(): HTMLElement {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'glossary-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

export function hideGlossary(): void {
  if (tooltip) tooltip.hidden = true;
}

function showFor(target: HTMLElement): void {
  const term = target.dataset.term;
  if (!term) return;
  const definition = GLOSSARY[term];
  if (!definition) return;

  const tip = ensureTooltip();
  tip.textContent = definition;
  tip.hidden = false;

  // Position under the term, clamped into the viewport.
  const rect = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  let top = rect.bottom + 6;
  if (top + tipRect.height > window.innerHeight - margin) top = rect.top - tipRect.height - 6;

  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(margin, top)}px`;
}

/** Wire up global click handling once. */
export function initGlossary(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest<HTMLElement>('.glossary-link');
    if (link) {
      event.preventDefault();
      const tip = ensureTooltip();
      const same = tip.dataset.for === link.dataset.term && !tip.hidden;
      tip.dataset.for = link.dataset.term ?? '';
      if (same) hideGlossary();
      else showFor(link);
      return;
    }
    if (!target?.closest('.glossary-tooltip')) hideGlossary();
  });

  window.addEventListener('resize', hideGlossary);
  window.addEventListener('scroll', hideGlossary, true);
}

/** Build a glossary-linked span. */
export function term(text: string, key: string): string {
  return `<span class="glossary-link" data-term="${key}" role="button" tabindex="0">${text}</span>`;
}

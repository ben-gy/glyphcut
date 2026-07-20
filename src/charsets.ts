/**
 * Preset character sets, expressed as CSS-style unicode ranges.
 *
 * These mirror the subset definitions Google Fonts uses to slice its own families, so a font cut
 * with the "Latin" preset here covers the same characters as the `latin` slice a developer is
 * already used to seeing in a Google Fonts `@font-face` block.
 */

export interface Charset {
  id: string;
  label: string;
  description: string;
  /** Inclusive [start, end] codepoint pairs. */
  ranges: [number, number][];
}

/** Parse a "U+0-FF, U+131, U+152-153" style string into inclusive pairs. */
export function parseUnicodeRanges(spec: string): [number, number][] {
  const out: [number, number][] = [];
  for (const partRaw of spec.split(',')) {
    const part = partRaw.trim().replace(/^U\+/i, '');
    if (!part) continue;
    const [a, b] = part.split('-');
    const start = parseInt(a, 16);
    if (Number.isNaN(start)) continue;
    const end = b === undefined ? start : parseInt(b, 16);
    out.push([start, Number.isNaN(end) ? start : end]);
  }
  return out;
}

function cs(id: string, label: string, description: string, spec: string): Charset {
  return { id, label, description, ranges: parseUnicodeRanges(spec) };
}

export const CHARSETS: Charset[] = [
  cs(
    'latin',
    'Latin',
    'English and most Western European languages, plus common punctuation, quotes and the euro sign.',
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  ),
  cs(
    'latin-ext',
    'Latin Extended',
    'Central and Eastern European Latin scripts — Polish, Czech, Turkish, Romanian and friends.',
    'U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  ),
  cs(
    'cyrillic',
    'Cyrillic',
    'Russian, Ukrainian, Bulgarian and other core Cyrillic alphabets.',
    'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  ),
  cs(
    'cyrillic-ext',
    'Cyrillic Extended',
    'Historic and minority Cyrillic letterforms beyond the core set.',
    'U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
  ),
  cs('greek', 'Greek', 'Modern monotonic Greek.', 'U+0370-03FF'),
  cs('greek-ext', 'Greek Extended', 'Polytonic Greek with the full set of accents and breathings.', 'U+1F00-1FFF'),
  cs(
    'vietnamese',
    'Vietnamese',
    'The stacked diacritics Vietnamese needs on top of Latin.',
    'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
  ),
  cs(
    'numeric',
    'Numerals & punctuation',
    'Digits, currency and punctuation only — right for a font used just for figures or UI chrome.',
    'U+0020-0040, U+005B-0060, U+007B-007E, U+2000-206F, U+20A0-20BF, U+2212',
  ),
];

export const CHARSETS_BY_ID = new Map(CHARSETS.map((c) => [c.id, c]));

/** Expand a set of preset ids into a flat, sorted codepoint list. */
export function expandCharsets(ids: readonly string[]): number[] {
  const out = new Set<number>();
  for (const id of ids) {
    const set = CHARSETS_BY_ID.get(id);
    if (!set) continue;
    for (const [start, end] of set.ranges) {
      for (let c = start; c <= end; c++) out.add(c);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Every distinct codepoint in a string, iterated by code point so astral characters
 * (emoji, rare CJK) count as one rather than as two surrogate halves.
 */
export function codepointsOfText(text: string): number[] {
  const out = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) out.add(cp);
  }
  return [...out].sort((a, b) => a - b);
}

/** Collapse a sorted codepoint list into a compact CSS `unicode-range` value. */
export function toUnicodeRange(codepoints: readonly number[]): string {
  if (!codepoints.length) return '';
  const sorted = [...new Set(codepoints)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
  const flush = () => {
    parts.push(start === prev ? `U+${hex(start)}` : `U+${hex(start)}-${hex(prev)}`);
  };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    flush();
    start = sorted[i];
    prev = sorted[i];
  }
  flush();
  return parts.join(', ');
}

/** Named Unicode blocks, used to describe what a font covers at a glance. */
const BLOCKS: [string, number, number][] = [
  ['Basic Latin', 0x0000, 0x007f],
  ['Latin-1 Supplement', 0x0080, 0x00ff],
  ['Latin Extended-A', 0x0100, 0x017f],
  ['Latin Extended-B', 0x0180, 0x024f],
  ['IPA Extensions', 0x0250, 0x02af],
  ['Spacing Modifiers', 0x02b0, 0x02ff],
  ['Combining Diacriticals', 0x0300, 0x036f],
  ['Greek & Coptic', 0x0370, 0x03ff],
  ['Cyrillic', 0x0400, 0x04ff],
  ['Cyrillic Supplement', 0x0500, 0x052f],
  ['Armenian', 0x0530, 0x058f],
  ['Hebrew', 0x0590, 0x05ff],
  ['Arabic', 0x0600, 0x06ff],
  ['Devanagari', 0x0900, 0x097f],
  ['Bengali', 0x0980, 0x09ff],
  ['Thai', 0x0e00, 0x0e7f],
  ['Georgian', 0x10a0, 0x10ff],
  ['Hangul Jamo', 0x1100, 0x11ff],
  ['Latin Extended Additional', 0x1e00, 0x1eff],
  ['Greek Extended', 0x1f00, 0x1fff],
  ['General Punctuation', 0x2000, 0x206f],
  ['Currency Symbols', 0x20a0, 0x20cf],
  ['Letterlike Symbols', 0x2100, 0x214f],
  ['Number Forms', 0x2150, 0x218f],
  ['Arrows', 0x2190, 0x21ff],
  ['Mathematical Operators', 0x2200, 0x22ff],
  ['Box Drawing', 0x2500, 0x257f],
  ['Block Elements', 0x2580, 0x259f],
  ['Geometric Shapes', 0x25a0, 0x25ff],
  ['Miscellaneous Symbols', 0x2600, 0x26ff],
  ['Dingbats', 0x2700, 0x27bf],
  ['CJK Symbols & Punctuation', 0x3000, 0x303f],
  ['Hiragana', 0x3040, 0x309f],
  ['Katakana', 0x30a0, 0x30ff],
  ['CJK Unified Ideographs', 0x4e00, 0x9fff],
  ['Hangul Syllables', 0xac00, 0xd7af],
  ['Private Use Area', 0xe000, 0xf8ff],
  ['Alphabetic Presentation Forms', 0xfb00, 0xfb4f],
  ['Specials', 0xfff0, 0xffff],
  ['Emoji & Pictographs', 0x1f300, 0x1f9ff],
];

export interface BlockCoverage {
  name: string;
  covered: number;
  total: number;
}

/** Summarise which Unicode blocks a codepoint list touches, busiest first. */
export function blockCoverage(codepoints: readonly number[]): BlockCoverage[] {
  const counts = new Map<string, number>();
  for (const cp of codepoints) {
    const block = BLOCKS.find(([, start, end]) => cp >= start && cp <= end);
    if (!block) continue;
    counts.set(block[0], (counts.get(block[0]) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, covered]) => {
      const block = BLOCKS.find((b) => b[0] === name)!;
      return { name, covered, total: block[2] - block[1] + 1 };
    })
    .sort((a, b) => b.covered - a.covered);
}

/**
 * Whether a missing codepoint is worth telling the user about.
 *
 * The standard charset definitions (and Google Fonts' own) include whole blocks such as
 * U+0000-00FF, which sweep up C0/C1 control characters and invisible formatting marks. No font
 * maps those, so reporting them as "missing" turns a perfectly good subset into a wall of
 * alarming U+0000s. Only visible characters the user could actually have meant are reported.
 */
export function isReportableCodepoint(cp: number): boolean {
  if (cp <= 0x001f) return false; // C0 controls
  if (cp >= 0x007f && cp <= 0x009f) return false; // DEL + C1 controls
  if (cp === 0x00ad) return false; // soft hyphen
  if (cp >= 0x200b && cp <= 0x200f) return false; // zero-width and bidi marks
  if (cp >= 0x2028 && cp <= 0x202f) return false; // line/paragraph separators, bidi overrides
  if (cp >= 0x2060 && cp <= 0x2064) return false; // word joiner and invisible operators
  if (cp === 0xfeff || cp === 0xfffd) return false; // BOM, replacement character
  return true;
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Percentage saved going from `before` to `after`. */
export function percentSaved(before: number, after: number): number {
  if (!before || before <= 0) return 0;
  return Math.max(0, Math.round((1 - after / before) * 1000) / 10);
}

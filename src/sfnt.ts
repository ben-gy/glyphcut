/**
 * A deliberately narrow SFNT (TrueType/OpenType) reader.
 *
 * We only need six tables — head, maxp, name, OS/2, cmap and fvar — so this parses those and
 * ignores everything else. That is a feature, not a shortcut: a full font parser has to
 * understand every table it encounters and tends to throw on the unusual ones (CFF2, exotic
 * cmap encodings, subsetted fonts with stripped tables). This reader skips what it does not
 * recognise, so a font it cannot fully describe still loads and still subsets.
 *
 * Nothing here mutates the input buffer.
 */
import type { FontMeta, OutlineFormat, SourceFormat, VarAxis } from './types';

export const SFNT_TRUETYPE = 0x00010000;
export const TAG_OTTO = 0x4f54544f; // 'OTTO'
export const TAG_TRUE = 0x74727565; // 'true'
export const TAG_TTCF = 0x74746366; // 'ttcf'
export const TAG_WOFF = 0x774f4646; // 'wOFF'
export const TAG_WOF2 = 0x774f4632; // 'wOF2'

export class FontParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontParseError';
  }
}

function u8(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

export function tagToString(tag: number): string {
  return String.fromCharCode((tag >>> 24) & 0xff, (tag >>> 16) & 0xff, (tag >>> 8) & 0xff, tag & 0xff);
}

/** Sniff the container from the first four bytes. */
export function detectFormat(data: Uint8Array): SourceFormat {
  if (data.length < 4) return 'unknown';
  const sig = u8(data).getUint32(0);
  switch (sig) {
    case TAG_WOFF:
      return 'woff';
    case TAG_WOF2:
      return 'woff2';
    case TAG_OTTO:
      return 'otf';
    case SFNT_TRUETYPE:
    case TAG_TRUE:
    case TAG_TTCF:
      return 'ttf';
    default:
      return 'unknown';
  }
}

export interface TableRecord {
  tag: string;
  offset: number;
  length: number;
}

/** Read the SFNT table directory. Handles a TrueType Collection by taking its first font. */
export function readTableDirectory(data: Uint8Array): Map<string, TableRecord> {
  if (data.length < 12) throw new FontParseError('File is too short to be a font.');
  const view = u8(data);
  let base = 0;

  if (view.getUint32(0) === TAG_TTCF) {
    // TrueType Collection: header is tag/version/numFonts then an array of font offsets.
    if (data.length < 16) throw new FontParseError('Truncated TrueType Collection header.');
    const numFonts = view.getUint32(8);
    if (numFonts === 0) throw new FontParseError('TrueType Collection contains no fonts.');
    base = view.getUint32(12);
    if (base + 12 > data.length) throw new FontParseError('TrueType Collection offset is out of range.');
  }

  const numTables = view.getUint16(base + 4);
  const dirEnd = base + 12 + numTables * 16;
  if (numTables === 0) throw new FontParseError('Font contains no tables.');
  if (dirEnd > data.length) throw new FontParseError('Font table directory is truncated.');

  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < numTables; i++) {
    const p = base + 12 + i * 16;
    const tag = tagToString(view.getUint32(p));
    const offset = view.getUint32(p + 8);
    const length = view.getUint32(p + 12);
    // Skip records that point outside the file rather than failing the whole parse.
    if (offset >= data.length) continue;
    tables.set(tag, { tag, offset, length: Math.min(length, data.length - offset) });
  }
  return tables;
}

function slice(data: Uint8Array, rec: TableRecord | undefined): Uint8Array | null {
  if (!rec) return null;
  return data.subarray(rec.offset, rec.offset + rec.length);
}

// ─────────────────────────── name table ───────────────────────────

const NAME_IDS = {
  FAMILY: 1,
  SUBFAMILY: 2,
  FULL: 4,
  VERSION: 5,
  DESIGNER: 9,
  MANUFACTURER: 8,
  LICENSE: 13,
  LICENSE_URL: 14,
  TYPOGRAPHIC_FAMILY: 16,
  TYPOGRAPHIC_SUBFAMILY: 17,
} as const;

interface NameRecord {
  platformID: number;
  languageID: number;
  nameID: number;
  value: string;
}

function decodeName(bytes: Uint8Array, platformID: number, encodingID: number): string {
  // Windows (3) and Unicode (0) platforms use UTF-16BE. Mac (1) uses MacRoman, which is
  // ASCII-compatible for the Latin range we care about here.
  const isUtf16 = platformID === 3 || platformID === 0 || (platformID === 1 && encodingID !== 0);
  try {
    if (isUtf16) return new TextDecoder('utf-16be').decode(bytes).replace(/\0/g, '').trim();
    return new TextDecoder('macintosh').decode(bytes).trim();
  } catch {
    // Some environments lack the macintosh/utf-16be labels; fall back to a manual read.
    if (isUtf16) {
      let out = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return out.replace(/\0/g, '').trim();
    }
    return String.fromCharCode(...bytes).trim();
  }
}

function parseNameTable(table: Uint8Array | null): NameRecord[] {
  if (!table || table.length < 6) return [];
  const view = u8(table);
  const count = view.getUint16(2);
  const stringOffset = view.getUint16(4);
  const records: NameRecord[] = [];

  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12;
    if (p + 12 > table.length) break;
    const platformID = view.getUint16(p);
    const encodingID = view.getUint16(p + 2);
    const languageID = view.getUint16(p + 4);
    const nameID = view.getUint16(p + 6);
    const length = view.getUint16(p + 8);
    const offset = view.getUint16(p + 10);
    const start = stringOffset + offset;
    if (start + length > table.length) continue;
    const value = decodeName(table.subarray(start, start + length), platformID, encodingID);
    if (value) records.push({ platformID, languageID, nameID, value });
  }
  return records;
}

/**
 * Pick the best string for a name ID. Windows/English wins, then any Windows record, then
 * Mac/English, then whatever exists — this ordering is what makes non-English fonts still
 * produce a sensible Latin family name where one is present.
 */
function pickName(records: NameRecord[], ...nameIDs: number[]): string {
  for (const nameID of nameIDs) {
    const candidates = records.filter((r) => r.nameID === nameID);
    if (!candidates.length) continue;
    const ranked =
      candidates.find((r) => r.platformID === 3 && r.languageID === 0x409) ??
      candidates.find((r) => r.platformID === 3) ??
      candidates.find((r) => r.platformID === 1 && r.languageID === 0) ??
      candidates[0];
    if (ranked?.value) return ranked.value;
  }
  return '';
}

// ─────────────────────────── cmap ───────────────────────────

/**
 * Collect every codepoint the font maps to a real (non-zero) glyph.
 * Supports formats 4, 12, 6 and 0 — which between them cover essentially every shipping font.
 */
export function parseCmapCodepoints(table: Uint8Array | null): number[] {
  if (!table || table.length < 4) return [];
  const view = u8(table);
  const numTables = view.getUint16(2);

  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numTables; i++) {
    const p = 4 + i * 8;
    if (p + 8 > table.length) break;
    const platformID = view.getUint16(p);
    const encodingID = view.getUint16(p + 2);
    const offset = view.getUint32(p + 4);
    if (offset >= table.length) continue;
    // Prefer full-Unicode subtables over BMP-only ones.
    let score = 0;
    if (platformID === 3 && encodingID === 10) score = 5;
    else if (platformID === 0 && encodingID >= 4) score = 4;
    else if (platformID === 3 && encodingID === 1) score = 3;
    else if (platformID === 0) score = 2;
    else if (platformID === 1) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  }
  if (best < 0) return [];

  const sub = table.subarray(best);
  if (sub.length < 4) return [];
  const sv = u8(sub);
  const format = sv.getUint16(0);
  const out = new Set<number>();

  if (format === 4) {
    const segCountX2 = sv.getUint16(6);
    const segCount = segCountX2 / 2;
    const endBase = 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;
    if (rangeBase + segCountX2 > sub.length) return [];

    for (let s = 0; s < segCount; s++) {
      const end = sv.getUint16(endBase + s * 2);
      const start = sv.getUint16(startBase + s * 2);
      if (start > end || start === 0xffff) continue;
      const idDelta = sv.getInt16(deltaBase + s * 2);
      const idRangeOffset = sv.getUint16(rangeBase + s * 2);

      for (let c = start; c <= end && c <= 0xffff; c++) {
        let gid: number;
        if (idRangeOffset === 0) {
          gid = (c + idDelta) & 0xffff;
        } else {
          const gp = rangeBase + s * 2 + idRangeOffset + (c - start) * 2;
          if (gp + 2 > sub.length) continue;
          gid = sv.getUint16(gp);
          if (gid !== 0) gid = (gid + idDelta) & 0xffff;
        }
        if (gid !== 0) out.add(c);
      }
    }
  } else if (format === 12) {
    if (sub.length < 16) return [];
    const nGroups = sv.getUint32(12);
    for (let g = 0; g < nGroups; g++) {
      const p = 16 + g * 12;
      if (p + 12 > sub.length) break;
      const startChar = sv.getUint32(p);
      const endChar = sv.getUint32(p + 4);
      const startGid = sv.getUint32(p + 8);
      if (startChar > endChar || endChar > 0x10ffff) continue;
      // Guard against absurd ranges in malformed fonts.
      if (endChar - startChar > 0x20000) continue;
      for (let c = startChar; c <= endChar; c++) {
        if (startGid + (c - startChar) !== 0) out.add(c);
      }
    }
  } else if (format === 6) {
    if (sub.length < 10) return [];
    const first = sv.getUint16(6);
    const count = sv.getUint16(8);
    for (let i = 0; i < count; i++) {
      const p = 10 + i * 2;
      if (p + 2 > sub.length) break;
      if (sv.getUint16(p) !== 0) out.add(first + i);
    }
  } else if (format === 0) {
    for (let c = 0; c < 256; c++) {
      const p = 6 + c;
      if (p >= sub.length) break;
      if (sub[p] !== 0) out.add(c);
    }
  }

  return [...out].sort((a, b) => a - b);
}

// ─────────────────────────── fvar ───────────────────────────

function parseFvar(table: Uint8Array | null): VarAxis[] {
  if (!table || table.length < 16) return [];
  const view = u8(table);
  const axesOffset = view.getUint16(4);
  const axisCount = view.getUint16(8);
  const axisSize = view.getUint16(10);
  const axes: VarAxis[] = [];
  for (let i = 0; i < axisCount; i++) {
    const p = axesOffset + i * axisSize;
    if (p + 20 > table.length) break;
    axes.push({
      tag: tagToString(view.getUint32(p)),
      min: view.getInt32(p + 4) / 65536,
      def: view.getInt32(p + 8) / 65536,
      max: view.getInt32(p + 12) / 65536,
    });
  }
  return axes;
}

// ─────────────────────────── public entry point ───────────────────────────

/** Parse metadata out of decompressed SFNT bytes. */
export function parseFont(data: Uint8Array): FontMeta {
  const tables = readTableDirectory(data);
  const view = u8(data);
  const sig = view.getUint32(0);

  const head = slice(data, tables.get('head'));
  const maxp = slice(data, tables.get('maxp'));
  const os2 = slice(data, tables.get('OS/2'));
  const names = parseNameTable(slice(data, tables.get('name')));

  const unitsPerEm = head && head.length >= 20 ? u8(head).getUint16(18) : 0;
  const numGlyphs = maxp && maxp.length >= 6 ? u8(maxp).getUint16(4) : 0;
  const fsType = os2 && os2.length >= 10 ? u8(os2).getUint16(8) : -1;

  let outlines: OutlineFormat = 'unknown';
  if (tables.has('glyf')) outlines = 'truetype';
  else if (tables.has('CFF ') || tables.has('CFF2')) outlines = 'cff';
  else if (sig === TAG_OTTO) outlines = 'cff';
  else if (sig === SFNT_TRUETYPE) outlines = 'truetype';

  const axes = parseFvar(slice(data, tables.get('fvar')));

  return {
    family: pickName(names, NAME_IDS.TYPOGRAPHIC_FAMILY, NAME_IDS.FAMILY),
    subfamily: pickName(names, NAME_IDS.TYPOGRAPHIC_SUBFAMILY, NAME_IDS.SUBFAMILY),
    fullName: pickName(names, NAME_IDS.FULL),
    version: pickName(names, NAME_IDS.VERSION),
    manufacturer: pickName(names, NAME_IDS.MANUFACTURER),
    designer: pickName(names, NAME_IDS.DESIGNER),
    license: pickName(names, NAME_IDS.LICENSE),
    licenseUrl: pickName(names, NAME_IDS.LICENSE_URL),
    numGlyphs,
    unitsPerEm,
    outlines,
    isVariable: axes.length > 0,
    axes,
    fsType,
    codepoints: parseCmapCodepoints(slice(data, tables.get('cmap'))),
    tables: [...tables.keys()].sort(),
  };
}

// ─────────────────────────── fsType decoding ───────────────────────────

export interface EmbeddingPermission {
  label: string;
  detail: string;
  /** 'ok' — embedding allowed; 'warn' — restricted; 'unknown' — no OS/2 table. */
  level: 'ok' | 'warn' | 'unknown';
}

/**
 * Decode the OS/2 fsType bits into something a human can act on.
 *
 * These are the font's own machine-readable embedding permissions. They are informative and
 * worth showing, but they are NOT the licence — the UI says so explicitly.
 */
export function describeEmbedding(fsType: number): EmbeddingPermission {
  if (fsType < 0) {
    return {
      label: 'Not declared',
      detail: 'This font has no OS/2 table, so it states no embedding permissions. Check its licence.',
      level: 'unknown',
    };
  }
  // Bit 9 (0x0200) no-subsetting, bit 8 (0x0100) bitmap-embedding-only.
  const noSubset = (fsType & 0x0200) !== 0;
  const bitmapOnly = (fsType & 0x0100) !== 0;
  // The low bits are mutually exclusive in practice; mask to bits 0–3.
  const level = fsType & 0x000f;

  let label: string;
  let detail: string;
  let flag: EmbeddingPermission['level'] = 'ok';

  if (level === 0) {
    label = 'Installable';
    detail = 'The font declares no embedding restrictions.';
  } else if (level & 0x0002) {
    label = 'Restricted';
    detail = 'The font declares that it must not be embedded or subset without explicit permission.';
    flag = 'warn';
  } else if (level & 0x0004) {
    label = 'Preview & print';
    detail = 'Embedding is declared for preview and printing only, not for editing.';
    flag = 'warn';
  } else if (level & 0x0008) {
    label = 'Editable';
    detail = 'The font declares that embedding is permitted, including in editable documents.';
  } else {
    label = `Unrecognised (0x${fsType.toString(16)})`;
    detail = 'The embedding bits do not match a known value.';
    flag = 'unknown';
  }

  const extras: string[] = [];
  if (noSubset) {
    extras.push('The font sets the no-subsetting bit — it asks not to be subset.');
    flag = 'warn';
  }
  if (bitmapOnly) {
    extras.push('Only bitmap embedding is declared as permitted.');
    flag = 'warn';
  }

  return { label, detail: [detail, ...extras].join(' '), level: flag };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
export type OutlineFormat = 'truetype' | 'cff' | 'unknown';

export interface VarAxis {
  tag: string;
  min: number;
  def: number;
  max: number;
}

/** Everything we surface about a font, all parsed locally. */
export interface FontMeta {
  family: string;
  subfamily: string;
  fullName: string;
  version: string;
  manufacturer: string;
  designer: string;
  license: string;
  licenseUrl: string;
  numGlyphs: number;
  unitsPerEm: number;
  outlines: OutlineFormat;
  isVariable: boolean;
  axes: VarAxis[];
  /** OS/2 fsType embedding bits; -1 when the table is absent. */
  fsType: number;
  /** Sorted, de-duplicated list of codepoints the font actually maps to a glyph. */
  codepoints: number[];
  tables: string[];
}

/** The container the user handed us, before any decompression. */
export type SourceFormat = 'ttf' | 'otf' | 'woff' | 'woff2' | 'unknown';

export interface LoadedFont {
  id: string;
  fileName: string;
  sourceFormat: SourceFormat;
  /** Original file size in bytes, as it arrived. */
  originalSize: number;
  /** Decompressed SFNT bytes — what HarfBuzz actually operates on. */
  sfntSize: number;
  meta: FontMeta;
}

export type OutputFormat = 'woff2' | 'sfnt';

/** What the user asked us to keep. */
export interface SubsetOptions {
  /** Preset charset ids to union together. */
  charsets: string[];
  /** Free text — every character in it is kept. */
  customText: string;
  /** Keep every codepoint the font has (convert-only mode). */
  keepAll: boolean;
  /** Retain OpenType layout features (kerning, ligatures…). */
  keepLayoutFeatures: boolean;
  /** Keep hinting instructions. */
  keepHinting: boolean;
  /** Flatten a variable font to its default instance. */
  pinAxesToDefault: boolean;
  outputs: OutputFormat[];
}

export interface SubsetResultFile {
  format: OutputFormat;
  fileName: string;
  bytes: Uint8Array;
  size: number;
}

export interface SubsetResult {
  fontId: string;
  files: SubsetResultFile[];
  /** Codepoints actually present in the output. */
  keptCodepoints: number[];
  /** Requested codepoints the source font had no glyph for. */
  missingCodepoints: number[];
  glyphsBefore: number;
  glyphsAfter: number;
  originalSize: number;
  elapsedMs: number;
}

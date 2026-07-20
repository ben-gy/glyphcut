/**
 * Builds a real, valid TrueType font in memory.
 *
 * Using a synthetic font rather than a committed binary keeps the repo free of third-party font
 * licensing questions, and means the parser is tested against bytes whose every field is known.
 * The output is valid enough that HarfBuzz will genuinely subset it, so the integration test
 * exercises the real engine.
 */

const Sizes = {
  HEAD: 54,
  MAXP: 32,
  HHEA: 36,
  OS2: 96,
  POST: 32,
} as const;

class Writer {
  private bytes: number[] = [];

  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    this.bytes.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  i16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number): this {
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return this;
  }
  raw(data: Uint8Array): this {
    for (const b of data) this.bytes.push(b);
    return this;
  }
  padTo(n: number): this {
    while (this.bytes.length < n) this.bytes.push(0);
    return this;
  }
  get length(): number {
    return this.bytes.length;
  }
  done(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

function tagToU32(tag: string): number {
  return ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0;
}

/** A single square contour — enough to be a real, renderable glyph. */
function squareGlyph(): Uint8Array {
  const w = new Writer();
  w.i16(1); // numberOfContours
  w.i16(100).i16(0).i16(600).i16(700); // xMin yMin xMax yMax
  w.u16(3); // endPtsOfContours[0] — 4 points
  w.u16(0); // instructionLength
  for (let i = 0; i < 4; i++) w.u8(0x01); // flags: on-curve, 16-bit deltas
  for (const dx of [100, 500, 0, -500]) w.i16(dx);
  for (const dy of [0, 0, 700, 0]) w.i16(dy);
  return w.done(); // 34 bytes — even, so short loca offsets stay valid
}

function nameTable(family: string, subfamily: string): Uint8Array {
  const records: [number, string][] = [
    [1, family],
    [2, subfamily],
    [4, `${family} ${subfamily}`],
    [5, 'Version 1.000'],
    [8, 'Glyphcut Test Foundry'],
  ];

  const encode = (s: string): Uint8Array => {
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      out[i * 2] = code >> 8;
      out[i * 2 + 1] = code & 0xff;
    }
    return out;
  };

  const encoded = records.map(([id, value]) => ({ id, data: encode(value) }));
  const storageOffset = 6 + encoded.length * 12;

  const w = new Writer();
  w.u16(0); // format
  w.u16(encoded.length);
  w.u16(storageOffset);

  let offset = 0;
  for (const rec of encoded) {
    w.u16(3); // platformID: Windows
    w.u16(1); // encodingID: BMP
    w.u16(0x409); // languageID: en-US
    w.u16(rec.id);
    w.u16(rec.data.length);
    w.u16(offset);
    offset += rec.data.length;
  }
  for (const rec of encoded) w.raw(rec.data);
  return w.done();
}

/** cmap format 4 mapping a contiguous run of characters to consecutive glyph ids. */
function cmapTable(firstChar: number, glyphCount: number): Uint8Array {
  const lastChar = firstChar + glyphCount - 1;
  const sub = new Writer();
  sub.u16(4); // format
  sub.u16(32); // length
  sub.u16(0); // language
  sub.u16(4); // segCountX2 — two segments
  sub.u16(4); // searchRange
  sub.u16(1); // entrySelector
  sub.u16(0); // rangeShift
  sub.u16(lastChar).u16(0xffff); // endCode[]
  sub.u16(0); // reservedPad
  sub.u16(firstChar).u16(0xffff); // startCode[]
  // idDelta: firstChar maps to glyph 1, and the terminator segment maps 0xFFFF to glyph 0.
  sub.i16(1 - firstChar).u16(1);
  sub.u16(0).u16(0); // idRangeOffset[]

  const w = new Writer();
  w.u16(0); // version
  w.u16(1); // numTables
  w.u16(3).u16(1).u32(12); // Windows BMP record pointing just past this header
  w.raw(sub.done());
  return w.done();
}

export interface TestFontOptions {
  family?: string;
  subfamily?: string;
  /** OS/2 fsType embedding bits. */
  fsType?: number;
  /** Number of real glyphs beyond .notdef. */
  glyphCount?: number;
  /** Codepoint the first real glyph maps to. */
  firstChar?: number;
  unitsPerEm?: number;
}

/** Assemble a complete, parseable TrueType font. */
export function buildTestFont(options: TestFontOptions = {}): Uint8Array {
  const {
    family = 'Glyphcut Test',
    subfamily = 'Regular',
    fsType = 8,
    glyphCount = 4,
    firstChar = 0x41,
    unitsPerEm = 1000,
  } = options;

  const numGlyphs = glyphCount + 1; // plus .notdef

  // glyf + loca (short format). Glyph 0 (.notdef) is empty; glyphs 1..n-1 are each one square.
  const glyph = squareGlyph();
  const glyfWriter = new Writer();
  for (let i = 1; i < numGlyphs; i++) glyfWriter.raw(glyph);
  const glyf = glyfWriter.done();

  // loca holds numGlyphs+1 offsets: the start of every glyph, plus the end of the last one.
  // .notdef is zero-length, so entries 0 and 1 both point at 0.
  const locaWriter = new Writer();
  locaWriter.u16(0);
  for (let k = 1; k <= numGlyphs; k++) locaWriter.u16(((k - 1) * glyph.length) / 2);
  const loca = locaWriter.done();

  // head
  const head = new Writer()
    .u32(0x00010000) // version
    .u32(0x00010000) // fontRevision
    .u32(0) // checkSumAdjustment — HarfBuzz does not verify this
    .u32(0x5f0f3cf5) // magicNumber
    .u16(0x000b) // flags
    .u16(unitsPerEm)
    .zeros(16) // created + modified
    .i16(0)
    .i16(0)
    .i16(600)
    .i16(700) // bounding box
    .u16(0) // macStyle
    .u16(8) // lowestRecPPEM
    .i16(2) // fontDirectionHint
    .i16(0) // indexToLocFormat: short
    .i16(0) // glyphDataFormat
    .padTo(Sizes.HEAD)
    .done();

  const maxp = new Writer().u32(0x00010000).u16(numGlyphs).padTo(Sizes.MAXP).done();

  const hhea = new Writer()
    .u32(0x00010000)
    .i16(800) // ascender
    .i16(-200) // descender
    .i16(0) // lineGap
    .u16(700) // advanceWidthMax
    .i16(0)
    .i16(0)
    .i16(600)
    .i16(1)
    .i16(0)
    .i16(0)
    .zeros(8) // reserved
    .i16(0) // metricDataFormat
    .u16(numGlyphs) // numberOfHMetrics
    .padTo(Sizes.HHEA)
    .done();

  const hmtxWriter = new Writer();
  for (let i = 0; i < numGlyphs; i++) hmtxWriter.u16(700).i16(100);
  const hmtx = hmtxWriter.done();

  const os2 = new Writer()
    .u16(4) // version
    .i16(600) // xAvgCharWidth
    .u16(400) // usWeightClass
    .u16(5) // usWidthClass
    .u16(fsType)
    .padTo(Sizes.OS2)
    .done();

  const post = new Writer().u32(0x00030000).padTo(Sizes.POST).done();

  const tables: [string, Uint8Array][] = [
    ['OS/2', os2],
    ['cmap', cmapTable(firstChar, glyphCount)],
    ['glyf', glyf],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['loca', loca],
    ['maxp', maxp],
    ['name', nameTable(family, subfamily)],
    ['post', post],
  ];
  tables.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const align4 = (n: number) => (n + 3) & ~3;
  const dirSize = 12 + tables.length * 16;
  let cursor = dirSize;
  const placed = tables.map(([tag, data]) => {
    const entry = { tag, data, offset: cursor };
    cursor += align4(data.length);
    return entry;
  });

  const entrySelector = Math.floor(Math.log2(tables.length));
  const searchRange = 2 ** entrySelector * 16;

  const out = new Writer();
  out.u32(0x00010000);
  out.u16(tables.length);
  out.u16(searchRange);
  out.u16(entrySelector);
  out.u16(tables.length * 16 - searchRange);
  for (const entry of placed) {
    out.u32(tagToU32(entry.tag));
    out.u32(0); // checksum
    out.u32(entry.offset);
    out.u32(entry.data.length);
  }
  for (const entry of placed) {
    out.padTo(entry.offset);
    out.raw(entry.data);
  }
  out.padTo(cursor);
  return out.done();
}

import { describe, expect, it } from 'vitest';
import {
  FontParseError,
  describeEmbedding,
  detectFormat,
  parseCmapCodepoints,
  parseFont,
  readTableDirectory,
  tagToString,
} from '../src/sfnt';
import { checksum } from '../src/woff';
import { buildTestFont } from './fixtures';

describe('detectFormat', () => {
  it('recognises a TrueType font', () => {
    expect(detectFormat(buildTestFont())).toBe('ttf');
  });

  it('recognises OTTO, wOFF and wOF2 signatures', () => {
    const sig = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    expect(detectFormat(sig('OTTO'))).toBe('otf');
    expect(detectFormat(sig('wOFF'))).toBe('woff');
    expect(detectFormat(sig('wOF2'))).toBe('woff2');
  });

  it('returns unknown for arbitrary data and short input', () => {
    expect(detectFormat(new Uint8Array([1, 2, 3, 4]))).toBe('unknown');
    expect(detectFormat(new Uint8Array([0, 1]))).toBe('unknown');
    expect(detectFormat(new Uint8Array())).toBe('unknown');
  });
});

describe('tagToString', () => {
  it('converts a packed tag to its four characters', () => {
    expect(tagToString(0x676c7966)).toBe('glyf');
    expect(tagToString(0x4f532f32)).toBe('OS/2');
  });
});

describe('readTableDirectory', () => {
  it('finds every table written into the fixture', () => {
    const tables = readTableDirectory(buildTestFont());
    for (const tag of ['head', 'maxp', 'name', 'OS/2', 'cmap', 'glyf', 'loca', 'hhea', 'hmtx', 'post']) {
      expect(tables.has(tag), tag).toBe(true);
    }
  });

  it('records plausible offsets and lengths', () => {
    const font = buildTestFont();
    const head = readTableDirectory(font).get('head')!;
    expect(head.length).toBe(54);
    expect(head.offset).toBeGreaterThan(0);
    expect(head.offset + head.length).toBeLessThanOrEqual(font.length);
  });

  it('throws on input too short to be a font', () => {
    expect(() => readTableDirectory(new Uint8Array([0, 1, 0, 0]))).toThrow(FontParseError);
  });

  it('throws when the table directory runs past the end of the file', () => {
    const font = buildTestFont();
    // Claim far more tables than the file actually contains.
    const broken = font.slice();
    new DataView(broken.buffer).setUint16(4, 400);
    expect(() => readTableDirectory(broken)).toThrow(FontParseError);
  });
});

describe('parseFont', () => {
  it('reads the name table', () => {
    const meta = parseFont(buildTestFont({ family: 'Testface', subfamily: 'Bold' }));
    expect(meta.family).toBe('Testface');
    expect(meta.subfamily).toBe('Bold');
    expect(meta.fullName).toBe('Testface Bold');
    expect(meta.manufacturer).toBe('Glyphcut Test Foundry');
  });

  it('reads head and maxp values', () => {
    const meta = parseFont(buildTestFont({ glyphCount: 6, unitsPerEm: 2048 }));
    expect(meta.numGlyphs).toBe(7); // 6 glyphs plus .notdef
    expect(meta.unitsPerEm).toBe(2048);
  });

  it('identifies TrueType outlines', () => {
    expect(parseFont(buildTestFont()).outlines).toBe('truetype');
  });

  it('extracts the mapped codepoints from cmap', () => {
    const meta = parseFont(buildTestFont({ glyphCount: 3, firstChar: 0x41 }));
    expect(meta.codepoints).toEqual([0x41, 0x42, 0x43]);
  });

  it('reads the OS/2 fsType bits', () => {
    expect(parseFont(buildTestFont({ fsType: 0 })).fsType).toBe(0);
    expect(parseFont(buildTestFont({ fsType: 8 })).fsType).toBe(8);
    expect(parseFont(buildTestFont({ fsType: 2 })).fsType).toBe(2);
  });

  it('reports a non-variable font as having no axes', () => {
    const meta = parseFont(buildTestFont());
    expect(meta.isVariable).toBe(false);
    expect(meta.axes).toEqual([]);
  });

  it('lists the table tags it found', () => {
    expect(parseFont(buildTestFont()).tables).toContain('glyf');
  });
});

describe('parseCmapCodepoints', () => {
  it('returns nothing for a missing or truncated table', () => {
    expect(parseCmapCodepoints(null)).toEqual([]);
    expect(parseCmapCodepoints(new Uint8Array([0, 0]))).toEqual([]);
  });

  it('excludes the 0xFFFF terminator segment', () => {
    const meta = parseFont(buildTestFont({ glyphCount: 2, firstChar: 0x41 }));
    expect(meta.codepoints).not.toContain(0xffff);
  });
});

describe('describeEmbedding', () => {
  it('reports installable fonts as unrestricted', () => {
    const perm = describeEmbedding(0);
    expect(perm.label).toBe('Installable');
    expect(perm.level).toBe('ok');
  });

  it('flags restricted fonts', () => {
    const perm = describeEmbedding(2);
    expect(perm.label).toBe('Restricted');
    expect(perm.level).toBe('warn');
  });

  it('flags preview-and-print as restricted', () => {
    expect(describeEmbedding(4).level).toBe('warn');
  });

  it('treats editable embedding as permitted', () => {
    const perm = describeEmbedding(8);
    expect(perm.label).toBe('Editable');
    expect(perm.level).toBe('ok');
  });

  it('surfaces the no-subsetting bit as a warning', () => {
    const perm = describeEmbedding(0x0208);
    expect(perm.level).toBe('warn');
    expect(perm.detail).toMatch(/no-subsetting/i);
  });

  it('reports an absent OS/2 table as undeclared', () => {
    expect(describeEmbedding(-1).level).toBe('unknown');
  });
});

describe('checksum', () => {
  it('sums big-endian words', () => {
    expect(checksum(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 2]))).toBe(3);
  });

  it('zero-pads a trailing partial word', () => {
    expect(checksum(new Uint8Array([0, 0, 0, 1, 0x10]))).toBe(0x10000001);
  });

  it('returns zero for empty data', () => {
    expect(checksum(new Uint8Array())).toBe(0);
  });

  it('stays within uint32 on overflow', () => {
    const result = checksum(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
  });
});

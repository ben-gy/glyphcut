/**
 * End-to-end test of the real pipeline: a synthetic font goes through the vendored HarfBuzz
 * subsetter and the WOFF2 encoder, and the output is re-parsed to prove it is a valid font
 * containing exactly the characters that were asked for.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compress as woff2Compress, decompress as woff2Decompress } from 'woff2-encoder';
import { SubsetError, subsetFont } from '../src/hbsubset';
import { detectFormat, parseFont } from '../src/sfnt';
import { buildTestFont } from './fixtures';

// Resolved from the project root: under the jsdom environment `import.meta.url` is an http URL.
const WASM_PATH = resolve(process.cwd(), 'public/harfbuzz-subset.wasm');

// The worker fetches this over HTTP; in the test it is instantiated straight off disk so the
// same binary that ships is the one under test.
let hb: Parameters<typeof subsetFont>[0];

beforeAll(async () => {
  const bytes = readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  hb = instance.exports as unknown as typeof hb;
});

const baseOptions = {
  keepAllCodepoints: false,
  keepLayoutFeatures: true,
  keepHinting: false,
  pinAxesToDefault: false,
};

describe('subsetFont', () => {
  it('keeps only the requested characters', () => {
    const font = buildTestFont({ glyphCount: 6, firstChar: 0x41 }); // A–F
    const out = subsetFont(hb, font, { ...baseOptions, codepoints: [0x41, 0x42] });

    const meta = parseFont(out);
    expect(meta.codepoints).toEqual([0x41, 0x42]);
  });

  it('produces a smaller font than it started with', () => {
    const font = buildTestFont({ glyphCount: 20, firstChar: 0x41 });
    const out = subsetFont(hb, font, { ...baseOptions, codepoints: [0x41] });
    expect(out.length).toBeLessThan(font.length);
  });

  it('produces a still-valid TrueType font', () => {
    const font = buildTestFont({ glyphCount: 4 });
    const out = subsetFont(hb, font, { ...baseOptions, codepoints: [0x41] });
    expect(detectFormat(out)).toBe('ttf');
    expect(() => parseFont(out)).not.toThrow();
  });

  it('drops the glyphs that were cut', () => {
    const font = buildTestFont({ glyphCount: 10, firstChar: 0x41 });
    const before = parseFont(font).numGlyphs;
    const after = parseFont(subsetFont(hb, font, { ...baseOptions, codepoints: [0x41, 0x42] })).numGlyphs;
    expect(after).toBeLessThan(before);
  });

  it('retains the family name so the output identifies itself', () => {
    const font = buildTestFont({ family: 'Retained Name', glyphCount: 4 });
    const meta = parseFont(subsetFont(hb, font, { ...baseOptions, codepoints: [0x41] }));
    expect(meta.family).toBe('Retained Name');
  });

  it('keeps everything when asked to', () => {
    const font = buildTestFont({ glyphCount: 5, firstChar: 0x41 });
    const out = subsetFont(hb, font, { ...baseOptions, codepoints: [], keepAllCodepoints: true });
    expect(parseFont(out).codepoints).toEqual([0x41, 0x42, 0x43, 0x44, 0x45]);
  });

  it('rejects an empty codepoint set rather than producing an empty font', () => {
    const font = buildTestFont();
    expect(() => subsetFont(hb, font, { ...baseOptions, codepoints: [] })).toThrow(SubsetError);
  });

  it('rejects data that is not a font', () => {
    const junk = new Uint8Array(2048).fill(0x7f);
    expect(() => subsetFont(hb, junk, { ...baseOptions, codepoints: [0x41] })).toThrow(SubsetError);
  });

  it('survives being called repeatedly on the same engine instance', () => {
    // The WASM heap is reused across calls; a leak or a stale pointer would surface here.
    const font = buildTestFont({ glyphCount: 8 });
    for (let i = 0; i < 25; i++) {
      const out = subsetFont(hb, font, { ...baseOptions, codepoints: [0x41, 0x42] });
      expect(parseFont(out).codepoints).toEqual([0x41, 0x42]);
    }
  });

  it('handles a font whose requested characters are only partly present', () => {
    const font = buildTestFont({ glyphCount: 2, firstChar: 0x41 }); // A, B only
    const out = subsetFont(hb, font, { ...baseOptions, codepoints: [0x41] });
    expect(parseFont(out).codepoints).toEqual([0x41]);
  });
});

describe('woff2 round trip', () => {
  it('compresses a subsetted font and decompresses back to a valid font', async () => {
    const font = buildTestFont({ glyphCount: 6 });
    const subset = subsetFont(hb, font, { ...baseOptions, codepoints: [0x41, 0x42, 0x43] });

    const woff2 = new Uint8Array(await woff2Compress(subset));
    expect(detectFormat(woff2)).toBe('woff2');

    const back = new Uint8Array(await woff2Decompress(woff2));
    expect(detectFormat(back)).toBe('ttf');
    expect(parseFont(back).codepoints).toEqual([0x41, 0x42, 0x43]);
  });

  it('preserves the family name through compression', async () => {
    const font = buildTestFont({ family: 'RoundTrip', glyphCount: 4 });
    const subset = subsetFont(hb, font, { ...baseOptions, codepoints: [0x41] });
    const back = new Uint8Array(await woff2Decompress(new Uint8Array(await woff2Compress(subset))));
    expect(parseFont(back).family).toBe('RoundTrip');
  });
});

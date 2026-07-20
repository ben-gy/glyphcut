import { describe, expect, it } from 'vitest';
import {
  CHARSETS,
  blockCoverage,
  codepointsOfText,
  expandCharsets,
  formatBytes,
  isReportableCodepoint,
  parseUnicodeRanges,
  percentSaved,
  toUnicodeRange,
} from '../src/charsets';

describe('parseUnicodeRanges', () => {
  it('parses single codepoints and ranges', () => {
    expect(parseUnicodeRanges('U+0041')).toEqual([[0x41, 0x41]]);
    expect(parseUnicodeRanges('U+0041-005A')).toEqual([[0x41, 0x5a]]);
  });

  it('parses a comma separated list with mixed forms', () => {
    expect(parseUnicodeRanges('U+0-FF, U+131, U+152-153')).toEqual([
      [0x0, 0xff],
      [0x131, 0x131],
      [0x152, 0x153],
    ]);
  });

  it('is case insensitive and tolerates whitespace', () => {
    expect(parseUnicodeRanges('  u+00ff ,U+0100-01ff ')).toEqual([
      [0xff, 0xff],
      [0x100, 0x1ff],
    ]);
  });

  it('ignores empty and unparseable entries', () => {
    expect(parseUnicodeRanges('')).toEqual([]);
    expect(parseUnicodeRanges('U+0041, , zzz, U+0042')).toEqual([
      [0x41, 0x41],
      [0x42, 0x42],
    ]);
  });

  it('works without the U+ prefix', () => {
    expect(parseUnicodeRanges('41-5A')).toEqual([[0x41, 0x5a]]);
  });
});

describe('expandCharsets', () => {
  it('expands a preset into sorted codepoints', () => {
    const latin = expandCharsets(['latin']);
    expect(latin).toContain(0x41);
    expect(latin).toContain(0x20ac); // euro
    expect([...latin]).toEqual([...latin].sort((a, b) => a - b));
  });

  it('unions multiple presets without duplicates', () => {
    const combined = expandCharsets(['latin', 'greek']);
    expect(new Set(combined).size).toBe(combined.length);
    expect(combined).toContain(0x03b1); // greek alpha
    expect(combined).toContain(0x41);
  });

  it('ignores unknown ids', () => {
    expect(expandCharsets(['not-a-charset'])).toEqual([]);
    expect(expandCharsets(['latin', 'nope']).length).toBe(expandCharsets(['latin']).length);
  });

  it('returns an empty list for no input', () => {
    expect(expandCharsets([])).toEqual([]);
  });

  it('every shipped preset expands to something', () => {
    for (const charset of CHARSETS) {
      expect(expandCharsets([charset.id]).length, charset.id).toBeGreaterThan(0);
    }
  });
});

describe('codepointsOfText', () => {
  it('returns unique sorted codepoints', () => {
    expect(codepointsOfText('BAA')).toEqual([0x41, 0x42]);
  });

  it('handles the empty string', () => {
    expect(codepointsOfText('')).toEqual([]);
  });

  it('counts astral characters once, not as surrogate halves', () => {
    const result = codepointsOfText('😀');
    expect(result).toEqual([0x1f600]);
  });

  it('keeps combining marks as separate codepoints', () => {
    // "e" + combining acute
    expect(codepointsOfText('é')).toEqual([0x65, 0x301]);
  });

  it('handles whitespace and punctuation', () => {
    expect(codepointsOfText('a b')).toEqual([0x20, 0x61, 0x62]);
  });
});

describe('toUnicodeRange', () => {
  it('collapses a contiguous run into one range', () => {
    expect(toUnicodeRange([0x41, 0x42, 0x43])).toBe('U+0041-0043');
  });

  it('emits single codepoints without a dash', () => {
    expect(toUnicodeRange([0x41])).toBe('U+0041');
  });

  it('splits non-contiguous groups', () => {
    expect(toUnicodeRange([0x41, 0x42, 0x50, 0x60, 0x61])).toBe('U+0041-0042, U+0050, U+0060-0061');
  });

  it('sorts and de-duplicates unsorted input', () => {
    expect(toUnicodeRange([0x43, 0x41, 0x42, 0x41])).toBe('U+0041-0043');
  });

  it('returns an empty string for no codepoints', () => {
    expect(toUnicodeRange([])).toBe('');
  });

  it('pads to at least four hex digits and uppercases', () => {
    expect(toUnicodeRange([0x20])).toBe('U+0020');
    expect(toUnicodeRange([0x1f600])).toBe('U+1F600');
  });
});

describe('blockCoverage', () => {
  it('attributes codepoints to their Unicode block', () => {
    const coverage = blockCoverage([0x41, 0x42, 0x3b1]);
    const names = coverage.map((c) => c.name);
    expect(names).toContain('Basic Latin');
    expect(names).toContain('Greek & Coptic');
  });

  it('sorts busiest block first', () => {
    const coverage = blockCoverage([0x41, 0x42, 0x43, 0x3b1]);
    expect(coverage[0].name).toBe('Basic Latin');
    expect(coverage[0].covered).toBe(3);
  });

  it('returns nothing for an empty list', () => {
    expect(blockCoverage([])).toEqual([]);
  });

  it('skips codepoints in no known block', () => {
    expect(blockCoverage([0x0870])).toEqual([]);
  });
});

describe('isReportableCodepoint', () => {
  it('suppresses C0 control characters', () => {
    for (const cp of [0x00, 0x07, 0x0a, 0x1f]) expect(isReportableCodepoint(cp)).toBe(false);
  });

  it('suppresses DEL and C1 controls', () => {
    expect(isReportableCodepoint(0x7f)).toBe(false);
    expect(isReportableCodepoint(0x90)).toBe(false);
  });

  it('suppresses invisible formatting marks', () => {
    for (const cp of [0x00ad, 0x200b, 0x200d, 0x2028, 0x2060, 0xfeff, 0xfffd]) {
      expect(isReportableCodepoint(cp), cp.toString(16)).toBe(false);
    }
  });

  it('reports ordinary visible characters', () => {
    for (const cp of [0x20, 0x41, 0x7a, 0x00e9, 0x20ac, 0x4e00, 0x1f600]) {
      expect(isReportableCodepoint(cp), cp.toString(16)).toBe(true);
    }
  });

  it('filters the control characters the Latin preset sweeps in', () => {
    // The latin charset spans U+0000-00FF, so it necessarily includes control codepoints.
    const latin = expandCharsets(['latin']);
    expect(latin).toContain(0x00);
    expect(latin.filter(isReportableCodepoint)).not.toContain(0x00);
    expect(latin.filter(isReportableCodepoint)).toContain(0x41);
  });
});

describe('formatBytes', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });

  it('handles zero and invalid input', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('percentSaved', () => {
  it('computes the reduction', () => {
    expect(percentSaved(1000, 250)).toBe(75);
    expect(percentSaved(1000, 1000)).toBe(0);
  });

  it('never reports a negative saving when the output grew', () => {
    expect(percentSaved(100, 200)).toBe(0);
  });

  it('guards against a zero original size', () => {
    expect(percentSaved(0, 0)).toBe(0);
  });
});

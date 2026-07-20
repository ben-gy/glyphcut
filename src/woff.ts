/**
 * WOFF 1.0 → SFNT decompression.
 *
 * HarfBuzz only reads bare SFNT, and `woff2-encoder` only handles WOFF2, so `.woff` input needs
 * unwrapping here. WOFF1 stores each table zlib-compressed, which the Compression Streams API
 * ('deflate' is the zlib-wrapped variant) can inflate natively — no extra dependency needed.
 */
import { FontParseError, TAG_WOFF } from './sfnt';

const WOFF_HEADER_SIZE = 44;
const WOFF_ENTRY_SIZE = 20;

async function inflate(data: Uint8Array, expectedLength: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new FontParseError('This browser cannot decompress WOFF files (no Compression Streams support).');
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (expectedLength && out.length !== expectedLength) {
    throw new FontParseError('A compressed table in this WOFF file did not inflate to its declared size.');
  }
  return out;
}

/** Rebuild a plain SFNT from a WOFF 1.0 container. */
export async function woffToSfnt(data: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < WOFF_HEADER_SIZE || view.getUint32(0) !== TAG_WOFF) {
    throw new FontParseError('Not a WOFF 1.0 file.');
  }

  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);
  if (numTables === 0) throw new FontParseError('WOFF file declares no tables.');
  if (WOFF_HEADER_SIZE + numTables * WOFF_ENTRY_SIZE > data.length) {
    throw new FontParseError('WOFF table directory is truncated.');
  }

  interface Entry {
    tag: number;
    data: Uint8Array;
  }
  const entries: Entry[] = [];

  for (let i = 0; i < numTables; i++) {
    const p = WOFF_HEADER_SIZE + i * WOFF_ENTRY_SIZE;
    const tag = view.getUint32(p);
    const offset = view.getUint32(p + 4);
    const compLength = view.getUint32(p + 8);
    const origLength = view.getUint32(p + 12);
    if (offset + compLength > data.length) {
      throw new FontParseError('A WOFF table points past the end of the file.');
    }
    const raw = data.subarray(offset, offset + compLength);
    // Per spec: equal lengths mean the table is stored uncompressed.
    const table = compLength >= origLength ? raw.slice(0, origLength) : await inflate(raw, origLength);
    entries.push({ tag, data: table });
  }

  // Table records must be written in ascending tag order.
  entries.sort((a, b) => a.tag - b.tag);

  const align4 = (n: number) => (n + 3) & ~3;
  const dirSize = 12 + entries.length * 16;
  let total = dirSize;
  for (const e of entries) total += align4(e.data.length);

  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);

  // Search-range fields, per the SFNT spec.
  const entrySelector = Math.floor(Math.log2(entries.length));
  const searchRange = 2 ** entrySelector * 16;
  ov.setUint32(0, flavor);
  ov.setUint16(4, entries.length);
  ov.setUint16(6, searchRange);
  ov.setUint16(8, entrySelector);
  ov.setUint16(10, entries.length * 16 - searchRange);

  let cursor = dirSize;
  entries.forEach((e, i) => {
    const p = 12 + i * 16;
    ov.setUint32(p, e.tag);
    ov.setUint32(p + 4, checksum(e.data));
    ov.setUint32(p + 8, cursor);
    ov.setUint32(p + 12, e.data.length);
    out.set(e.data, cursor);
    cursor += align4(e.data.length);
  });

  return out;
}

/** SFNT table checksum: sum of big-endian uint32s, with the tail zero-padded. */
export function checksum(data: Uint8Array): number {
  let sum = 0;
  const full = data.length & ~3;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < full; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  if (full < data.length) {
    let tail = 0;
    for (let i = full; i < data.length; i++) tail |= data[i] << (24 - (i - full) * 8);
    sum = (sum + (tail >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

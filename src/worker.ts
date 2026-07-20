/// <reference lib="webworker" />
/**
 * The font worker. Owns both WASM modules and every byte of font data for the session.
 *
 * Fonts are held here rather than on the UI thread so that re-cutting with a different charset
 * never re-reads the file, and so the main thread never touches font bytes at all.
 */
import { compress as woff2Compress, decompress as woff2Decompress } from 'woff2-encoder';
import { loadHarfbuzz, subsetFont, SubsetError } from './hbsubset';
import { detectFormat, parseFont, FontParseError } from './sfnt';
import { woffToSfnt } from './woff';
import { codepointsOfText, expandCharsets, isReportableCodepoint } from './charsets';
import type { WorkerRequest, WorkerResponse } from './protocol';
import type { SubsetResultFile } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const WASM_URL = new URL('/harfbuzz-subset.wasm', ctx.location.href).href;

interface Held {
  fileName: string;
  sfnt: Uint8Array;
  originalSize: number;
  codepoints: Set<number>;
  numGlyphs: number;
  outlines: string;
}

const fonts = new Map<string, Held>();
let nextId = 0;

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}

function progress(id: string, stage: string, detail?: string): void {
  post({ type: 'progress', id, stage, detail });
}

function errorMessage(err: unknown): string {
  if (err instanceof SubsetError || err instanceof FontParseError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error.';
}

/** Strip the extension so we can build sensible output names. */
function baseName(fileName: string): string {
  return fileName.replace(/\.(ttf|otf|woff2?|ttc)$/i, '');
}

/** Unwrap whatever container arrived into plain SFNT bytes. */
async function toSfnt(bytes: Uint8Array, id: string): Promise<Uint8Array> {
  const format = detectFormat(bytes);
  if (format === 'woff2') {
    progress(id, 'Decompressing WOFF2');
    return new Uint8Array(await woff2Decompress(bytes));
  }
  if (format === 'woff') {
    progress(id, 'Decompressing WOFF');
    return woffToSfnt(bytes);
  }
  if (format === 'unknown') {
    throw new FontParseError(
      'This file is not a font Glyphcut recognises. Supported: .ttf, .otf, .woff and .woff2.',
    );
  }
  return bytes;
}

async function handleLoad(req: Extract<WorkerRequest, { type: 'load' }>): Promise<void> {
  const original = new Uint8Array(req.bytes);
  const originalSize = original.length;

  progress(req.id, 'Reading font');
  const sfnt = await toSfnt(original, req.id);

  progress(req.id, 'Parsing tables');
  const meta = parseFont(sfnt);

  const fontId = `font-${nextId++}`;
  fonts.set(fontId, {
    fileName: req.fileName,
    sfnt,
    originalSize,
    codepoints: new Set(meta.codepoints),
    numGlyphs: meta.numGlyphs,
    outlines: meta.outlines,
  });

  post({
    type: 'loaded',
    id: req.id,
    fontId,
    fileName: req.fileName,
    sourceFormat: detectFormat(original),
    originalSize,
    sfntSize: sfnt.length,
    meta,
  });
}

async function handleSubset(req: Extract<WorkerRequest, { type: 'subset' }>): Promise<void> {
  const held = fonts.get(req.fontId);
  if (!held) throw new Error('That font is no longer loaded. Add it again.');

  const started = performance.now();
  const { options } = req;

  // Work out the requested codepoints, and which of them this font simply does not have.
  const requested = options.keepAll
    ? [...held.codepoints]
    : [...new Set([...expandCharsets(options.charsets), ...codepointsOfText(options.customText)])].sort(
        (a, b) => a - b,
      );

  // Control and formatting codepoints are absent from every font; listing them would bury any
  // genuinely missing character the user cares about.
  const missingCodepoints = options.keepAll
    ? []
    : requested.filter((cp) => !held.codepoints.has(cp) && isReportableCodepoint(cp));
  // Only ask HarfBuzz for codepoints the font actually has; requesting absent ones is harmless
  // but reporting them back to the user is the useful part.
  const wanted = options.keepAll ? [] : requested.filter((cp) => held.codepoints.has(cp));

  if (!options.keepAll && wanted.length === 0) {
    throw new SubsetError(
      'None of the characters you asked for exist in this font. Try a different character set.',
    );
  }

  progress(req.id, 'Subsetting', `${options.keepAll ? held.codepoints.size : wanted.length} characters`);
  const hb = await loadHarfbuzz(WASM_URL);
  const subsetted = subsetFont(hb, held.sfnt, {
    codepoints: wanted,
    keepAllCodepoints: options.keepAll,
    keepLayoutFeatures: options.keepLayoutFeatures,
    keepHinting: options.keepHinting,
    pinAxesToDefault: options.pinAxesToDefault,
  });

  // Re-parse the output so the numbers we report describe the actual file, not our intent.
  let glyphsAfter = 0;
  let keptCodepoints: number[] = [];
  try {
    const outMeta = parseFont(subsetted);
    glyphsAfter = outMeta.numGlyphs;
    keptCodepoints = outMeta.codepoints;
  } catch {
    keptCodepoints = wanted;
  }

  const base = baseName(held.fileName);
  const files: SubsetResultFile[] = [];
  const transfer: Transferable[] = [];

  if (req.options.outputs.includes('woff2')) {
    progress(req.id, 'Compressing to WOFF2');
    const woff2 = new Uint8Array(await woff2Compress(subsetted));
    files.push({ format: 'woff2', fileName: `${base}.subset.woff2`, bytes: woff2, size: woff2.length });
    transfer.push(woff2.buffer);
  }

  if (req.options.outputs.includes('sfnt')) {
    const ext = held.outlines === 'cff' ? 'otf' : 'ttf';
    const copy = subsetted.slice();
    files.push({ format: 'sfnt', fileName: `${base}.subset.${ext}`, bytes: copy, size: copy.length });
    transfer.push(copy.buffer);
  }

  post(
    {
      type: 'subsetted',
      id: req.id,
      fontId: req.fontId,
      files,
      keptCodepoints,
      missingCodepoints,
      glyphsBefore: held.numGlyphs,
      glyphsAfter,
      originalSize: held.originalSize,
      elapsedMs: Math.round(performance.now() - started),
    },
    transfer,
  );
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  void (async () => {
    try {
      switch (req.type) {
        case 'load':
          await handleLoad(req);
          break;
        case 'subset':
          await handleSubset(req);
          break;
        case 'release':
          fonts.delete(req.fontId);
          post({ type: 'released', id: req.id });
          break;
      }
    } catch (err) {
      post({ type: 'error', id: req.id, message: errorMessage(err) });
    }
  })();
});

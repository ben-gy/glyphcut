// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Raw bindings to HarfBuzz's `hb-subset`, compiled to WebAssembly.
 *
 * `harfbuzzjs` ships `harfbuzz-subset.wasm` but no JavaScript wrapper for the subsetter, so the
 * calls are made by hand here. The binary is vendored into `public/` and fetched same-origin —
 * never from a CDN — so that using this tool makes no third-party request at all.
 *
 * Memory discipline: every HarfBuzz call can grow the WASM heap, which detaches any existing
 * typed-array view of it. `heap()` therefore builds a fresh view on every access and no view is
 * ever cached across a call.
 */

/** hb_memory_mode_t */
const HB_MEMORY_MODE_WRITABLE = 2;

/** hb_subset_sets_t */
const HB_SUBSET_SETS_NAME_ID = 4;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

/** hb_subset_flags_t */
const HB_SUBSET_FLAGS_DEFAULT = 0x00000000;
const HB_SUBSET_FLAGS_NO_HINTING = 0x00000001;

interface HbExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, lengthPtr: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_clear(set: number): void;
  hb_set_invert(set: number): void;
  hb_set_add(set: number, codepoint: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set(input: number, setType: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_input_pin_all_axes_to_default(input: number, face: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

export class SubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubsetError';
  }
}

let hbPromise: Promise<HbExports> | null = null;

/** Instantiate the subsetter once and reuse it for the whole session. */
export function loadHarfbuzz(wasmUrl: string): Promise<HbExports> {
  if (!hbPromise) {
    hbPromise = (async () => {
      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new SubsetError(`Could not load the subsetting engine (HTTP ${response.status}).`);
      }
      // streaming instantiation where the server sets the right MIME type, buffered otherwise
      let instance: WebAssembly.Instance;
      try {
        ({ instance } = await WebAssembly.instantiateStreaming(response.clone(), {}));
      } catch {
        const bytes = await response.arrayBuffer();
        ({ instance } = await WebAssembly.instantiate(bytes, {}));
      }
      return instance.exports as unknown as HbExports;
    })().catch((err) => {
      hbPromise = null; // allow a retry after a transient failure
      throw err;
    });
  }
  return hbPromise;
}

export interface HbSubsetOptions {
  /** Codepoints to keep. Ignored when `keepAllCodepoints` is set. */
  codepoints: readonly number[];
  keepAllCodepoints: boolean;
  keepLayoutFeatures: boolean;
  keepHinting: boolean;
  pinAxesToDefault: boolean;
}

/**
 * Subset SFNT bytes down to the requested codepoints.
 * Returns fresh SFNT bytes; the input is not modified.
 */
export function subsetFont(hb: HbExports, font: Uint8Array, options: HbSubsetOptions): Uint8Array {
  const heap = () => new Uint8Array(hb.memory.buffer);

  let fontPtr = 0;
  let face = 0;
  let input = 0;
  let subset = 0;
  let outBlob = 0;

  try {
    fontPtr = hb.malloc(font.length);
    if (!fontPtr) throw new SubsetError('Out of memory loading the font into the subsetter.');
    heap().set(font, fontPtr);

    const blob = hb.hb_blob_create(fontPtr, font.length, HB_MEMORY_MODE_WRITABLE, 0, 0);
    if (!blob) throw new SubsetError('HarfBuzz rejected the font data.');
    face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    if (!face) throw new SubsetError('HarfBuzz could not read this font.');

    input = hb.hb_subset_input_create_or_fail();
    if (!input) throw new SubsetError('Could not initialise the subsetter.');

    // Keep every name record so the cut font still identifies itself (family, style, licence).
    // hb-subset otherwise keeps only a handful of name IDs, which leaves the output anonymous.
    const nameSet = hb.hb_subset_input_set(input, HB_SUBSET_SETS_NAME_ID);
    hb.hb_set_clear(nameSet);
    hb.hb_set_invert(nameSet);

    if (options.keepLayoutFeatures) {
      // Equivalent of pyftsubset's `--layout-features='*'`.
      const featureSet = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
      hb.hb_set_clear(featureSet);
      hb.hb_set_invert(featureSet);
    }

    hb.hb_subset_input_set_flags(
      input,
      options.keepHinting ? HB_SUBSET_FLAGS_DEFAULT : HB_SUBSET_FLAGS_NO_HINTING,
    );

    const unicodes = hb.hb_subset_input_unicode_set(input);
    if (options.keepAllCodepoints) {
      hb.hb_set_clear(unicodes);
      hb.hb_set_invert(unicodes);
    } else {
      if (!options.codepoints.length) {
        throw new SubsetError('No characters selected — pick a character set or enter some text.');
      }
      for (const cp of options.codepoints) hb.hb_set_add(unicodes, cp);
    }

    if (options.pinAxesToDefault) {
      hb.hb_subset_input_pin_all_axes_to_default(input, face);
    }

    subset = hb.hb_subset_or_fail(face, input);
    if (!subset) {
      throw new SubsetError(
        'HarfBuzz could not subset this font. It may be malformed, or protected against subsetting.',
      );
    }

    outBlob = hb.hb_face_reference_blob(subset);
    if (!outBlob) throw new SubsetError('The subsetter produced no output.');
    const outLen = hb.hb_blob_get_length(outBlob);
    const outPtr = hb.hb_blob_get_data(outBlob, 0);
    if (!outPtr || !outLen) throw new SubsetError('The subsetter produced an empty font.');

    // slice() copies out of the WASM heap before anything can free or grow it.
    return heap().slice(outPtr, outPtr + outLen);
  } finally {
    if (outBlob) hb.hb_blob_destroy(outBlob);
    if (subset) hb.hb_face_destroy(subset);
    if (input) hb.hb_subset_input_destroy(input);
    if (face) hb.hb_face_destroy(face);
    if (fontPtr) hb.free(fontPtr);
  }
}

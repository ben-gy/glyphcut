/** Message contract between the UI thread and the font worker. */
import type { FontMeta, SubsetOptions, SubsetResultFile } from './types';

export type WorkerRequest =
  | { type: 'load'; id: string; fileName: string; bytes: ArrayBuffer }
  | { type: 'subset'; id: string; fontId: string; options: SubsetOptions }
  | { type: 'release'; id: string; fontId: string };

export type WorkerResponse =
  | {
      type: 'loaded';
      id: string;
      fontId: string;
      fileName: string;
      sourceFormat: string;
      originalSize: number;
      sfntSize: number;
      meta: FontMeta;
    }
  | {
      type: 'subsetted';
      id: string;
      fontId: string;
      files: SubsetResultFile[];
      keptCodepoints: number[];
      missingCodepoints: number[];
      glyphsBefore: number;
      glyphsAfter: number;
      originalSize: number;
      elapsedMs: number;
    }
  | { type: 'progress'; id: string; stage: string; detail?: string }
  | { type: 'released'; id: string }
  | { type: 'error'; id: string; message: string };

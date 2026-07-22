// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/** Promise-based RPC over the font worker, with streaming progress. */
import type { WorkerRequest, WorkerResponse } from './protocol';
import type { FontMeta, SubsetOptions, SubsetResult, SubsetResultFile } from './types';

type ProgressFn = (stage: string, detail?: string) => void;

/**
 * A plain `Omit` over a union collapses it to the keys every member shares, which would drop
 * `fileName`/`fontId`. Distributing over the union keeps each variant's own fields.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type RequestWithoutId = DistributiveOmit<WorkerRequest, 'id'>;

interface Pending {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
  onProgress?: ProgressFn;
}

export interface LoadedFontResponse {
  fontId: string;
  fileName: string;
  sourceFormat: string;
  originalSize: number;
  sfntSize: number;
  meta: FontMeta;
}

export class FontService {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        if (msg.type === 'progress') {
          entry.onProgress?.(msg.stage, msg.detail);
          return;
        }
        this.pending.delete(msg.id);
        if (msg.type === 'error') entry.reject(new Error(msg.message));
        else entry.resolve(msg);
      });
      this.worker.addEventListener('error', (event) => {
        const error = new Error(event.message || 'The font worker crashed.');
        for (const [, entry] of this.pending) entry.reject(error);
        this.pending.clear();
        // Drop the worker so the next call starts a fresh one rather than failing forever.
        this.worker?.terminate();
        this.worker = null;
      });
    }
    return this.worker;
  }

  private call(
    request: RequestWithoutId,
    transfer: Transferable[] = [],
    onProgress?: ProgressFn,
  ): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    const id = `req-${this.seq++}`;
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ ...request, id } as WorkerRequest, transfer);
    });
  }

  async load(file: File, onProgress?: ProgressFn): Promise<LoadedFontResponse> {
    const bytes = await file.arrayBuffer();
    const res = await this.call({ type: 'load', fileName: file.name, bytes }, [bytes], onProgress);
    if (res.type !== 'loaded') throw new Error('Unexpected response while loading the font.');
    return {
      fontId: res.fontId,
      fileName: res.fileName,
      sourceFormat: res.sourceFormat,
      originalSize: res.originalSize,
      sfntSize: res.sfntSize,
      meta: res.meta,
    };
  }

  async subset(fontId: string, options: SubsetOptions, onProgress?: ProgressFn): Promise<SubsetResult> {
    const res = await this.call({ type: 'subset', fontId, options }, [], onProgress);
    if (res.type !== 'subsetted') throw new Error('Unexpected response while subsetting.');
    return {
      fontId: res.fontId,
      files: res.files as SubsetResultFile[],
      keptCodepoints: res.keptCodepoints,
      missingCodepoints: res.missingCodepoints,
      glyphsBefore: res.glyphsBefore,
      glyphsAfter: res.glyphsAfter,
      originalSize: res.originalSize,
      elapsedMs: res.elapsedMs,
    };
  }

  async release(fontId: string): Promise<void> {
    await this.call({ type: 'release', fontId });
  }
}

export const fontService = new FontService();

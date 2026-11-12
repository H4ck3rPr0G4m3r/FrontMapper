/// <reference lib="webworker" />
import { buildExportZip, type ExportInput } from '../core/exportZip';

export type ExportRequest = { type: 'export' } & ExportInput;
export type ExportResponse = { type: 'done'; zip: Uint8Array } | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  try {
    const zip = await buildExportZip(e.data);
    (self as unknown as Worker).postMessage({ type: 'done', zip } satisfies ExportResponse, [zip.buffer as ArrayBuffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies ExportResponse);
  }
};

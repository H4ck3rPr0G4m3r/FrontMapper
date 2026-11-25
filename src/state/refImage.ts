import { del, get, set } from 'idb-keyval';
import { signal } from '@preact/signals';

export type RefFit = 'stretch' | 'contain';

export interface RefImage {
  img: HTMLImageElement;
  name: string;
  opacity: number;
  visible: boolean;
  fit: RefFit;
}

/** Image shown over the map to trace from. Kept per map in this browser; never exported. */
export const refImage = signal<RefImage | null>(null);

const key = (projectId: string) => `refimage:${projectId}`;
let url: string | null = null;

function decode(blob: Blob): Promise<HTMLImageElement> {
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

export async function loadRefImage(projectId: string) {
  refImage.value = null;
  try {
    const saved = (await get(key(projectId))) as { blob: Blob; name: string; opacity: number; visible: boolean; fit: RefFit } | undefined;
    if (!saved) return;
    refImage.value = { img: await decode(saved.blob), name: saved.name, opacity: saved.opacity, visible: saved.visible, fit: saved.fit };
  } catch {
    refImage.value = null;
  }
}

export async function setRefImage(projectId: string, file: File) {
  const img = await decode(file);
  refImage.value = { img, name: file.name, opacity: 0.5, visible: true, fit: 'stretch' };
  await persist(projectId, file);
}

export function updateRefImage(projectId: string, patch: Partial<Pick<RefImage, 'opacity' | 'visible' | 'fit'>>) {
  const r = refImage.value;
  if (!r) return;
  refImage.value = { ...r, ...patch };
  void persist(projectId);
}

export async function removeRefImage(projectId: string) {
  refImage.value = null;
  if (url) URL.revokeObjectURL(url);
  url = null;
  await del(key(projectId)).catch(() => undefined);
}

/** Save settings (and the image, when a new one is given) without blocking the UI. */
async function persist(projectId: string, blob?: Blob) {
  const r = refImage.value;
  if (!r) return;
  try {
    const old = (await get(key(projectId))) as { blob: Blob } | undefined;
    const b = blob ?? old?.blob;
    if (b) await set(key(projectId), { blob: b, name: r.name, opacity: r.opacity, visible: r.visible, fit: r.fit });
  } catch {
    /* storage full or blocked: the image still works for this session */
  }
}

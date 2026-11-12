/** Shared Earth-picker types. Functions using them live in projection.ts, selectionOps.ts and elevation.ts. */

export type LonLat = [number, number];

/** Map frame in Web Mercator metres; y grows southward; x1 may exceed the date line. */
export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FrameSize {
  frame: Frame;
  width: number;
  height: number;
  /** Mercator metres per output pixel. */
  mPerPx: number;
}

export type SelShape =
  | { kind: 'region'; level: 'country' | 'province'; id: string; /** Country (ADM0_A3) a province belongs to. */ country?: string }
  | { kind: 'rect'; a: LonLat; b: LonLat }
  | { kind: 'circle'; center: LonLat; radiusM: number }
  | { kind: 'lasso'; points: LonLat[] };

export interface SelOp {
  mode: 'add' | 'subtract';
  shape: SelShape;
}

export interface ElevationCurve {
  highlandsFrom: number;
  mountainsFrom: number;
  peak: number;
}

export const DEFAULT_CURVE: ElevationCurve = { highlandsFrom: 300, mountainsFrom: 1500, peak: 4000 };

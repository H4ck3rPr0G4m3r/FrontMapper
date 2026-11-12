import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HALF, autoFrame, fitSize, kmPerPx, lonLatToMerc, mercToLonLat, partsOf, setSide, wrapLonNear, type Part } from '../../src/earth/projection';

const part = (lonMin: number, lonMax: number, latMin: number, latMax: number, area = (lonMax - lonMin) * (latMax - latMin)): Part => ({ lonMin, lonMax, latMin, latMax, area });
const frameLonWidth = (f: { x0: number; x1: number }) => ((f.x1 - f.x0) / (2 * HALF)) * 360;

describe('mercator', () => {
  it('maps the date line to +-HALF and round-trips', () => {
    expect(lonLatToMerc(180, 0).x).toBeCloseTo(HALF, 3);
    const m = lonLatToMerc(113.4, -7.2);
    const back = mercToLonLat(m.x, m.y);
    expect(back.lon).toBeCloseTo(113.4, 9);
    expect(back.lat).toBeCloseTo(-7.2, 9);
    expect(lonLatToMerc(0, 10).y).toBeLessThan(0); // y grows southward
    expect(mercToLonLat(HALF + 1000, 0).lon).toBeLessThan(-179);
  });
});

describe('frame sizing', () => {
  const frame = { x0: 0, y0: 0, x1: 4_000_000, y1: 2_000_000 };

  it('fitSize derives height and scale from width', () => {
    const fs = fitSize(frame, 4000);
    expect(fs.mPerPx).toBe(1000);
    expect(fs.height).toBe(2000);
  });

  it('unlinked height change keeps the scale and grows the frame', () => {
    const fs = setSide(fitSize(frame, 4000), 'height', 3000, false);
    expect(fs.mPerPx).toBe(1000);
    expect(fs.height).toBe(3000);
    expect(fs.frame.y1 - fs.frame.y0).toBeCloseTo(3_000_000);
    expect((fs.frame.y0 + fs.frame.y1) / 2).toBeCloseTo(1_000_000);
  });

  it('linked width change keeps the frame and changes the scale', () => {
    const fs = setSide(fitSize(frame, 4000), 'width', 8000, true);
    expect(fs.mPerPx).toBe(500);
    expect(fs.frame).toEqual(frame);
    expect(fs.height).toBe(4000);
  });

  it('snaps sizes to multiples of 4', () => {
    expect(setSide(fitSize(frame, 4000), 'width', 4002, true).width).toBe(4000);
    expect(fitSize(frame, 4001).width).toBe(4000);
  });

  it('reports km per pixel at the frame centre', () => {
    const eq = fitSize({ x0: 0, y0: -1000, x1: 1_000_000, y1: 1000 }, 1000);
    expect(kmPerPx(eq)).toBeCloseTo(1, 2);
  });
});

describe('autoFrame', () => {
  it('keeps Fiji narrow across the date line', () => {
    const { frame, outliers } = autoFrame([part(177, 180, -19, -16), part(-180, -178, -17, -15.8)]);
    expect(frameLonWidth(frame)).toBeLessThan(8);
    expect(frame.x1).toBeGreaterThan(HALF);
    expect(outliers).toEqual([]);
  });

  it('leaves the Kermadec and Chatham islands out of New Zealand as outliers', () => {
    const north = part(172.6, 178.6, -41.6, -34.4, 30);
    const south = part(166.4, 174.4, -46.7, -40.5, 40);
    const stewart = part(167.5, 168.3, -47.3, -46.7, 0.4);
    const kermadec = part(-178, -177.8, -29.3, -29.2, 0.01);
    const chatham = part(-176.8, -176.2, -44.2, -43.7, 0.2);
    const { frame, outliers } = autoFrame([north, south, stewart, kermadec, chatham]);
    expect(outliers).toHaveLength(2);
    expect(outliers).toContain(kermadec);
    expect(outliers).toContain(chatham);
    expect(frameLonWidth(frame)).toBeLessThan(15);
  });

  it('frames all of Indonesia as one cluster', () => {
    const fc = JSON.parse(readFileSync('public/data/countries/IDN.json', 'utf8'));
    const parts = fc.features.flatMap((f: any) => partsOf(f.geometry));
    expect(parts.length).toBeGreaterThan(50);
    const { frame, outliers } = autoFrame(parts);
    expect(outliers).toEqual([]);
    const tl = mercToLonLat(frame.x0, frame.y0), br = mercToLonLat(frame.x1, frame.y1);
    expect(tl.lon).toBeLessThan(95.3);
    expect(br.lon).toBeGreaterThan(141);
    expect(tl.lat).toBeGreaterThan(5.9);
    expect(br.lat).toBeLessThan(-11);
  });
});

describe('wrapLonNear', () => {
  it('shifts longitudes next to the view centre', () => {
    expect(wrapLonNear(-170, 175)).toBe(190);
    expect(wrapLonNear(170, -175)).toBe(-190);
    expect(wrapLonNear(20, 0)).toBe(20);
  });
});

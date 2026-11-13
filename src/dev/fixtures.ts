import { LAND, VOID, createGrid, type MapGrid, type Terrain } from '../core/grid';

function rect(g: MapGrid, x0: number, y0: number, w: number, h: number, t: Terrain, mag = 0) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      g.terrain[y * g.width + x] = t;
      g.mag[y * g.width + x] = t === LAND ? mag : 0;
    }
}

/** Dev/test maps, selected with `?fixture=<name>`. */
export function buildFixture(name: string): MapGrid | null {
  if (name === 'render') {
    const g = createGrid(1024, 512);
    rect(g, 600, 50, 134, 400, LAND, 0);
    rect(g, 734, 50, 133, 400, LAND, 15);
    rect(g, 867, 50, 134, 400, LAND, 25);
    rect(g, 200, 100, 5, 2, LAND, 4); // 10-cell island, removed on export
    rect(g, 0, 480, 1024, 32, VOID);
    rect(g, 100, 300, 3, 3, LAND, 4);
    rect(g, 420, 380, 4, 2, LAND, 4);
    return g;
  }
  if (name === 'huge') {
    const g = createGrid(10000, 5000);
    rect(g, 2000, 1000, 6000, 3000, LAND, 8);
    return g;
  }
  return null;
}

/**
 * Search by Sketch: a rough drawing of where colors go (sky blue on top, green below) is compared
 * with each picture's color layout on a coarse grid in L*a*b*; cells the sketch leaves empty do not
 * count. Smaller is closer.
 */
import type { Raster } from '../codecs/raster';
import { rgbToLab, deltaE } from './colorSearch';

export const GRID = { cols: 12, rows: 9 };
export interface Layout { cols: number; rows: number; lab: ([number, number, number] | null)[]; painted?: number[] }

/** Average L*a*b* per grid cell; with `sketch`, only painted (opaque) pixels count and each cell records how much is painted. */
export function colorLayout(r: Raster, sketch = false, cols = GRID.cols, rows = GRID.rows): Layout {
  const sum = new Float64Array(cols * rows * 4), all = new Float64Array(cols * rows);
  for (let y = 0; y < r.height; y++) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / r.height));
    for (let x = 0; x < r.width; x++) {
      const cx = Math.min(cols - 1, Math.floor((x * cols) / r.width)), c = cy * cols + cx, i = (y * r.width + x) * 4;
      all[c]++;
      if (sketch && r.data[i + 3] < 128) continue;
      sum[c * 4] += r.data[i]; sum[c * 4 + 1] += r.data[i + 1]; sum[c * 4 + 2] += r.data[i + 2]; sum[c * 4 + 3]++;
    }
  }
  const lab: Layout['lab'] = [], painted: number[] = [];
  for (let c = 0; c < cols * rows; c++) {
    const n = sum[c * 4 + 3];
    painted.push(all[c] ? n / all[c] : 0);
    lab.push(n ? rgbToLab(sum[c * 4] / n, sum[c * 4 + 1] / n, sum[c * 4 + 2] / n) : null);
  }
  return sketch ? { cols, rows, lab, painted } : { cols, rows, lab };
}
/** Mean ΔE between a sketch and a picture over the cells the sketch paints at least `minPaint` of; null for an empty sketch. */
export function sketchDistance(sketch: Layout, picture: Layout, minPaint = 0.3): number | null {
  let s = 0, n = 0;
  for (let c = 0; c < sketch.lab.length; c++) {
    const a = sketch.lab[c], b = picture.lab[c];
    if (!a || !b || (sketch.painted?.[c] ?? 1) < minPaint) continue;
    s += deltaE(a, b); n++;
  }
  return n ? s / n : null;
}

/**
 * Shared view state the viewer consults: the Before/After slider, and the hook Synchronize
 * Windows uses to follow the active window's zoom and pan. Kept tiny so the viewer imports no
 * command code.
 */
import type { PictureTab } from '../app';
import type { Viewer } from './viewer';

export const split = {
  on: false, tab: null as PictureTab | null, before: null as CanvasImageSource | null, beforeW: 0, beforeH: 0,
  /** Divider position, 0..1 across the picture. */
  x: 0.5, labelA: 'Before', labelB: 'After',
};
export const viewHooks: { changed: (v: Viewer) => void; tiled: () => boolean } = { changed: () => undefined, tiled: () => false };

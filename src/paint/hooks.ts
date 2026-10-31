/** Slots the viewer and the save path call; the paint session fills them (no import cycle). */
import type { App, PictureTab } from '../app';
import type { Viewer } from '../ui/viewer';
export const paintHooks: {
  active: (tab: PictureTab) => boolean;
  override: (tab: PictureTab) => CanvasImageSource | null;
  down: (tab: PictureTab, x: number, y: number, e: PointerEvent) => void;
  move: (tab: PictureTab, x: number, y: number, e: PointerEvent) => void;
  up: (tab: PictureTab, e: PointerEvent) => void;
  overlay: (ctx: CanvasRenderingContext2D, v: Viewer, r: { x: number; y: number; w: number; h: number }, pointer: { x: number; y: number } | null) => void;
  cursor: (tab: PictureTab) => string;
  beforeSave: (app: App, tab: PictureTab) => Promise<boolean>;
} = {
  active: () => false, override: () => null, down: () => undefined, move: () => undefined, up: () => undefined, overlay: () => undefined, cursor: () => '', beforeSave: async () => true,
};

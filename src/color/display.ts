/**
 * Color-managed display: the picture's values are taken in its profile (sRGB when untagged) and
 * shown through the sRGB canvas, which the browser and the system map to the monitor. Soft proof
 * routes them through an output profile first. View-only; the pixels never change.
 */
import type { Page } from '../picture/model';
import { makeTransform, makeProof, type Intent, type PixelTransform } from './transform';
import { docProfile, profileOf } from './embedded';
import { spaceIcc, spaceProfile, isSrgb } from './spaces';

export interface ProofSetup { icc: Uint8Array; name: string; intent: Intent; bpc: boolean; paperWhite: boolean; gamutWarning: boolean }
export const cmState: { managed: boolean; proof: ProofSetup | null } = { managed: true, proof: null };

const ids = new WeakMap<Uint8Array, number>(); let nextId = 1;
const idOf = (b: Uint8Array) => { let i = ids.get(b); if (!i) { i = nextId++; ids.set(b, i); } return i; };
const transforms = new Map<string, PixelTransform | null>();

/** The display step for a page (null: draw the values as they are), with a cache key. */
export function colorStep(page?: Page | null): { key: string; fn: PixelTransform } | null {
  const proof = cmState.proof;
  const src = cmState.managed || proof ? page?.icc : undefined;
  if (!proof && !src) return null;
  const key = `cm:${src ? idOf(src) : 0}:${proof ? `${idOf(proof.icc)}:${proof.intent}:${+proof.bpc}:${+proof.paperWhite}:${+proof.gamutWarning}` : ''}`;
  if (!transforms.has(key)) {
    let fn: PixelTransform | null = null;
    try {
      const sp = docProfile(src) || spaceProfile('srgb'), display = spaceProfile('srgb');
      if (proof) { const pp = profileOf(proof.icc); if (pp) fn = makeProof(sp, pp, display, { intent: proof.intent, bpc: proof.bpc, paperWhite: proof.paperWhite, gamutWarning: proof.gamutWarning ? [255, 0, 255] : null }); }
      else if (!isSrgb(sp)) fn = makeTransform(sp, display);
    } catch (e) { console.warn(e); }
    if (transforms.size > 32) transforms.clear();
    transforms.set(key, fn);
  }
  const fn = transforms.get(key);
  return fn ? { key, fn } : null;
}
export const srgbIcc = () => spaceIcc('srgb');

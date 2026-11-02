/**
 * Favorite Folders: kept in the app's IndexedDB store with each folder's address (a file or
 * content URI) or, in browsers, its directory handle (the browser may ask for permission again).
 */
import { kvGet, kvSet } from '../util/store';
import { handleFor, dirUriFor, type FolderRef } from '../platform/native';

export interface Favorite { name: string; uri?: string; handle?: any }
const KEY = 'favoriteFolders.v1';
export const listFavorites = async (): Promise<Favorite[]> => (await kvGet<Favorite[]>(KEY)) || [];
export const saveFavorites = (f: Favorite[]): Promise<void> => kvSet(KEY, f);

/** A favorite for a folder address, or null when the folder cannot be kept (a folder of dropped files). */
export function favoriteOf(ref: FolderRef): Favorite | null {
  if (ref.uri.startsWith('fsadir:')) { const h = handleFor(ref.uri); return h ? { name: ref.name, handle: h } : null; }
  return ref.uri ? { name: ref.name, uri: ref.uri } : null;
}
export async function sameFavorite(a: Favorite, b: Favorite): Promise<boolean> {
  if (a.uri || b.uri) return a.uri === b.uri;
  try { return !!(await a.handle?.isSameEntry?.(b.handle)); } catch { return false; }
}
/** The folder address to open a favorite (asking a browser for read permission when needed); null when unavailable. */
export async function favoriteRef(f: Favorite): Promise<FolderRef | null> {
  if (f.uri) return { uri: f.uri, name: f.name };
  if (!f.handle) return null;
  try {
    let ok = (await f.handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (ok === 'prompt') ok = await f.handle.requestPermission?.({ mode: 'read' });
    if (ok !== 'granted' && ok !== undefined) return null;
    return { uri: await dirUriFor(f.handle), name: f.name };
  } catch { return null; }
}

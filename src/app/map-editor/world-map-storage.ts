/**
 * The one mutable home-island map shared by the standalone editor and the game. It is stored as
 * encoded map bytes in IndexedDB, so the game can load exactly the world the editor saved without
 * a URL slot, file download or a second copy of the terrain.
 */
const DATABASE = "island-world";
const STORE = "files";
/** One canonical authored home map per browser origin. */
export const WORLD_MAP_NAME = "World01.smap";
const KEY = WORLD_MAP_NAME;

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const bytesOf = async (value: unknown): Promise<Uint8Array | null> => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return null;
};

/** The shared World01.smap bytes, or null before the editor has saved one. */
export const hasWorldMap = async (): Promise<boolean> => {
  if (typeof indexedDB === "undefined") return false;
  try {
    const database = await open();
    try {
      const key = await new Promise<IDBValidKey | undefined>((resolve, reject) => {
        const request = database.transaction(STORE).objectStore(STORE).getKey(KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return key !== undefined;
    } finally {
      database.close();
    }
  } catch {
    return false;
  }
};

/** The shared World01.smap bytes, or null before the editor has saved one. */
export const readWorldMap = async (): Promise<Uint8Array | null> => {
  if (typeof indexedDB === "undefined") return null;
  try {
    const database = await open();
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(STORE).objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return await bytesOf(value);
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
};

/** Replaces the shared home map with the editor's validated encoded bytes. */
export const writeWorldMap = async (bytes: Uint8Array): Promise<void> => {
  if (typeof indexedDB === "undefined") throw new Error(`This browser cannot store ${WORLD_MAP_NAME}`);
  const database = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(new Blob([bytes as Uint8Array<ArrayBuffer>], {
        type: "application/octet-stream"
      }), KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

/** Removes the shared map so the next new game falls back to the published starter. */
export const clearWorldMap = async (): Promise<void> => {
  if (typeof indexedDB === "undefined") return;
  const database = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

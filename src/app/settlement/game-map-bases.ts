import { base64ToBytes, bytesToBase64, type MapBase, type MapBases,mapHash, mapIdentity } from '../../../../island-of-settlers-shared/src/save-map-delta';
import { openMapStorage, PUBLISHED_MAP_PREFIX } from '../map-editor/map-storage';
import { readWorldMap } from '../map-editor/world-map-storage';
import { TABLES } from './game-database-schema';

interface BaseRow { slotId: string; key: string; hash: string; map: Uint8Array }
const decoded = (row: BaseRow | undefined): MapBase | null =>
  row ? { hash: row.hash, map: bytesToBase64(row.map) } : null;
const read = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});
export const indexedDbMapBases = (database: IDBDatabase, slotId: string): MapBases => {
  const adapter: MapBases = {
    read: async hash => decoded(await read(database.transaction(TABLES.mapBases).objectStore(TABLES.mapBases)
      .index('slotHash').get([slotId, hash]) as IDBRequest<BaseRow | undefined>))?.map ?? null,
    find: async (key, preferredHash) => {
      const existing = await read(database.transaction(TABLES.mapBases).objectStore(TABLES.mapBases)
        .get([slotId, key]) as IDBRequest<BaseRow | undefined>);
      if (existing) return decoded(existing);
      if (!key.startsWith('home:')) return null;
      let worldMap: Uint8Array | null = null;
      if (preferredHash) {
        const catalog = await openMapStorage();
        try { worldMap = await catalog?.read(`${PUBLISHED_MAP_PREFIX}${preferredHash}`) ?? null; }
        finally { catalog?.close(); }
      }
      worldMap ??= await readWorldMap();
      if (!worldMap) return null;
      const map = bytesToBase64(worldMap);
      if (`home:${await mapIdentity(map)}` !== key) return null;
      const base = { hash: await mapHash(map), map };
      await adapter.write(key, base);
      return base;
    },
    write: async (key, base) => {
      const transaction = database.transaction(TABLES.mapBases, 'readwrite');
      const store = transaction.objectStore(TABLES.mapBases);
      const existing = store.get([slotId, key]) as IDBRequest<BaseRow | undefined>;
      existing.onsuccess = () => {
        if (existing.result && existing.result.hash !== base.hash) { transaction.abort(); return; }
        if (!existing.result) store.add({ hash: base.hash, map: base64ToBytes(base.map), slotId, key });
      };
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Map base write failed'));
      });
    }
  };
  return adapter;
};

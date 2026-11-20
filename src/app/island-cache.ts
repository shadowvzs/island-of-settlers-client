import { SOURCE_VERSION } from "virtual:source-version";

import { requestToPromise } from "./helpers";

const DATABASE = "island-cache";
const ENTRIES = "entries";
/** Group name -> last use time: eviction without reading the (large) entries. */
const GROUPS = "groups";
/**
 * Groups kept: an island may now have a world-generation group and a content build group, so
 * five islands (home, three colonies, one adventure; owner 2026-10-13) need up to ten. A 96²
 * island is ~11-12 MB across both; nothing stays in memory.
 */
const KEPT_GROUPS = 10;
/** Content that does not depend on the island (painted atlases, material layers). */
export const SHARED_GROUP = "shared";

export interface IslandCache {
  /** The cached value, or the computed one (stored before anyone can change it). */
  cached: <T>(group: string, key: string, compute: () => Promise<T>) => Promise<T>;
}

const openDatabase = () => {
  const opening = indexedDB.open(DATABASE, 1);
  opening.onupgradeneeded = () => {
    opening.result.createObjectStore(ENTRIES);
    opening.result.createObjectStore(GROUPS);
  };
  return requestToPromise(opening);
};

const toPrefix = (group: string) => `${SOURCE_VERSION}|${group}|`;

/** Drops groups of other code versions and all but the most recently used islands. */
const evictOldGroups = async (database: IDBDatabase) => {
  const groups = database.transaction(GROUPS).objectStore(GROUPS);
  const [names, times] = await Promise.all([
    requestToPromise(groups.getAllKeys() as IDBRequest<string[]>),
    requestToPromise(groups.getAll() as IDBRequest<number[]>)
  ]);
  const current = names
    .map((name, index) => ({ name: String(name), time: times[index]! }))
    .filter(({ name }) => name.startsWith(SOURCE_VERSION) && !name.endsWith(`|${SHARED_GROUP}|`))
    .sort((first, second) => second.time - first.time)
    .slice(0, KEPT_GROUPS)
    .map(({ name }) => name);
  const kept = new Set([...current, toPrefix(SHARED_GROUP)]);
  const stale = names.map(String).filter((name) => !kept.has(name));
  if (stale.length === 0) return;
  const transaction = database.transaction([ENTRIES, GROUPS], "readwrite");
  for (const prefix of stale) {
    transaction.objectStore(ENTRIES).delete(IDBKeyRange.bound(prefix, `${prefix}￿`));
    transaction.objectStore(GROUPS).delete(prefix);
  }
};

const createStoredCache = (database: IDBDatabase): IslandCache => {
  const touched = new Set<string>();
  const touch = (prefix: string) => {
    if (touched.has(prefix)) return;
    touched.add(prefix);
    database.transaction(GROUPS, "readwrite").objectStore(GROUPS).put(Date.now(), prefix);
  };
  const read = async <T>(key: string) => {
    try {
      return await requestToPromise(
        database.transaction(ENTRIES).objectStore(ENTRIES).get(key) as IDBRequest<T | undefined>
      );
    } catch {
      return undefined;
    }
  };
  /** put() clones synchronously: later changes (fog, garden) never reach the cache. */
  const write = (key: string, value: unknown) => {
    try {
      database.transaction(ENTRIES, "readwrite").objectStore(ENTRIES).put(value, key);
    } catch {
      /** Not cloneable or out of quota: this value is just not cached. */
    }
  };

  return {
    cached: async (group, key, compute) => {
      const prefix = toPrefix(group);
      touch(prefix);
      const known = await read<Awaited<ReturnType<typeof compute>>>(`${prefix}${key}`);
      if (known !== undefined) return known;
      const value = await compute();
      write(`${prefix}${key}`, value);
      return value;
    }
  };
};

const passThrough: IslandCache = { cached: (_group, _key, compute) => compute() };

/**
 * IndexedDB cache of the generated island and its heavy builds, keyed by the source version
 * (any code change misses), the island (seed, options, fog) and the build. Off: every value is
 * computed (dev default, so agents never see a stale island). Any storage error turns it off.
 */
export const openIslandCache = async (enabled: boolean): Promise<IslandCache> => {
  if (!enabled || typeof indexedDB === "undefined") return passThrough;
  try {
    const database = await openDatabase();
    await evictOldGroups(database);
    return createStoredCache(database);
  } catch {
    return passThrough;
  }
};

/**
 * Administrator maintenance (M11): every cached island and build, packed worker results included, goes; each is
 * rebuilt on its next load. Clears the stores instead of deleting the database, so an open game tab never blocks it.
 */
export const clearIslandCache = async () => {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction([ENTRIES, GROUPS], "readwrite");
    transaction.objectStore(ENTRIES).clear();
    transaction.objectStore(GROUPS).clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

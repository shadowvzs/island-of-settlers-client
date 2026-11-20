export interface OwnedAssetLease<T> {
  readonly promise: Promise<T>;
  /** Drops one reference; the last release disposes the cached asset. */
  release(): void;
}

interface OwnedAssetEntry<T> {
  key: string;
  promise: Promise<T>;
  refs: number;
  released: boolean;
  settled: boolean;
  value?: T;
}

/**
 * Share one loaded asset between every unit that currently needs it and dispose it with the last
 * lease. A release before the load finishes invalidates that generation: the late result is
 * disposed instead of repopulating the cache. The next acquire starts a fresh load.
 */
export const createOwnedAssetCache = <T>(
  load: (key: string) => Promise<T>,
  dispose: (asset: T) => void
) => {
  const entries = new Map<string, OwnedAssetEntry<T>>();
  let disposed = false;
  const releaseEntry = (entry: OwnedAssetEntry<T>) => {
    if (entry.refs > 0) entry.refs--;
    if (entry.refs > 0 || entry.released) return;
    entry.released = true;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    const value = entry.value;
    entry.value = undefined;
    if (value !== undefined) dispose(value);
  };
  const createEntry = (key: string) => {
    const entry: OwnedAssetEntry<T> = {
      key,
      refs: 0,
      released: false,
      settled: false,
      promise: undefined!
    };
    entries.set(key, entry);
    entry.promise = Promise.resolve().then(() => load(key)).then(
      value => {
        entry.settled = true;
        if (disposed || entry.released) {
          dispose(value);
          throw new Error(`Asset "${key}" was released before it finished loading`);
        }
        entry.value = value;
        return value;
      },
      error => {
        entry.settled = true;
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      }
    );
    void entry.promise.catch(() => { /* The acquirer handles a failed or discarded load. */ });
    return entry;
  };
  const acquire = (key: string): OwnedAssetLease<T> => {
    if (disposed) throw new Error("Asset cache disposed");
    const entry = entries.get(key) ?? createEntry(key);
    entry.refs++;
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        releaseEntry(entry);
      }
    };
  };
  return {
    acquire,
    stats: () => {
      let assets = 0;
      let pending = 0;
      let references = 0;
      for (const entry of entries.values()) {
        references += entry.refs;
        if (entry.value !== undefined) assets++;
        if (!entry.settled) pending++;
      }
      return { assets, pending, references };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        entry.released = true;
        const value = entry.value;
        entry.value = undefined;
        if (value !== undefined) dispose(value);
      }
      entries.clear();
    }
  };
};

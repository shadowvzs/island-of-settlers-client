const DATABASE = "settlers-full-scene-replays";
const STORE = "data";

const transact = (key: string, value?: string) => new Promise<string | undefined>((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const reading = value === undefined;
    const transaction = database.transaction(STORE, reading ? "readonly" : "readwrite");
    const store = transaction.objectStore(STORE);
    const operation = reading ? store.get(key) : store.put(value, key);
    transaction.oncomplete = () => {
      const result: unknown = operation.result;
      database.close();
      resolve(typeof result === "string" ? result : undefined);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  };
});

/** Separate diagnostic database: never replaces a game/account save or pending game slot. */
export const sceneReplayStorage = {
  read: async (key: string): Promise<string | undefined> => transact(key),
  write: async (key: string, value: string): Promise<void> => { await transact(key, value); }
};

const modules = new Map<string, Promise<unknown>>();
let retrySequence = 0;

/** Browsers cache failed ESM fetches. Retry only the failed same-origin module, then validate its API. */
const retryFailedModule = async (error: unknown, expectedExport: string) => {
  if (!(error instanceof Error) || typeof location === "undefined") throw error;
  const address = error.message.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  if (!address) throw error;
  const url = new URL(address);
  if (url.origin !== location.origin || !/\.(?:js|mjs|ts)$/.test(url.pathname)) throw error;
  url.searchParams.set("decorationRetry", String(++retrySequence));
  const module = await import(/* @vite-ignore */ url.href) as Record<string, unknown>;
  // A failed transitive dependency is not necessarily the requested module.
  if (typeof module[expectedExport] !== "function") throw error;
  return module;
};

/** One request per code family, including a successful retry; this cache owns no GPU resources. */
export const loadDecorationModule = <T>(load: () => Promise<T>, expectedExport: string): Promise<T> => {
  const existing = modules.get(expectedExport);
  if (existing) return existing as Promise<T>;
  const promise = load().catch(error => retryFailedModule(error, expectedExport) as Promise<T>);
  modules.set(expectedExport, promise);
  void promise.catch(() => { if (modules.get(expectedExport) === promise) modules.delete(expectedExport); });
  return promise;
};

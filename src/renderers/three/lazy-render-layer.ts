interface DisposableLayer { dispose: () => void }

/** Frame-driven retry: no timers survive renderer disposal and failures cannot start a fetch storm. */
export const createLazyRenderLayer = <T extends DisposableLayer>(
  load: () => Promise<T>,
  onReady: (layer: T) => void,
  onError: (error: unknown) => void,
  now: () => number = () => performance.now()
) => {
  let layer: T | undefined;
  let loading = false;
  let disposed = false;
  let failures = 0;
  let retryAt = 0;
  let current: Promise<void> | undefined;
  const delays = [1000, 3000, 10000, 30000];
  const request = () => {
    if (disposed || loading || layer || now() < retryAt) return;
    loading = true;
    current = Promise.resolve().then(load).then(result => {
      if (disposed) { result.dispose(); return; }
      layer = result;
      onReady(result);
    }).catch(error => {
      if (disposed) return;
      retryAt = now() + delays[Math.min(failures, delays.length - 1)]!;
      if (failures++ === 0) onError(error);
    }).finally(() => { loading = false; });
  };
  return { request, get: () => layer,
    whenReady: async () => { request(); await current; return layer; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      layer?.dispose();
      layer = undefined;
    }
  };
};

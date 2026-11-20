/** Runs the callback on the next idle moment, at the latest after `timeoutMs` (next task without idle callbacks). */
export const runWhenIdle = (callback: () => void, timeoutMs: number) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(callback, { timeout: timeoutMs });
  else setTimeout(callback, 0);
};

/** Mounts React content into a DOM element and returns its unmount. */
export type MountWindowContent = (content: HTMLElement) => () => void;

/** Visible loading/error text of a lazily loaded window body. */
export interface LazyContentTexts {
  error: (name: string) => string;
  loading: (name: string) => string;
}

const DEFAULT_TEXTS: LazyContentTexts = {
  error: name => `${name} could not load. Close and reopen to retry.`,
  loading: name => `Loading ${name.toLowerCase()}…`
};

/**
 * Loads and mounts React content into an existing element on the first `mount`, so React stays out of
 * the startup bundle; a failed load shows a message and retries on the next `mount`.
 */
export const createLazyReactContent = (
  content: HTMLElement,
  heading: string,
  load: () => Promise<MountWindowContent>,
  texts: LazyContentTexts = DEFAULT_TEXTS
) => {
  let loading: Promise<void> | undefined;
  let unmount: (() => void) | undefined;
  let disposed = false;
  const mountOnce = async () => {
    content.textContent = texts.loading(heading);
    try {
      const mountContent = await load();
      if (disposed) {
        mountContent(content)();
        return;
      }
      content.textContent = "";
      unmount = mountContent(content);
    } catch {
      content.textContent = texts.error(heading);
      loading = undefined;
    }
  };
  return {
    dispose: () => {
      disposed = true;
      unmount?.();
      unmount = undefined;
    },
    mount: () => {
      if (disposed) return;
      loading ??= mountOnce();
    },
    unmount: () => {
      unmount?.();
      unmount = undefined;
    }
  };
};

/** Keep the current workers visible while their replacement loads. Dispose late
 * loads after another request or renderer teardown, so they cannot leak or swap back.
 * The chosen tunic colour stays across replacements (a nation switch). */
export const createWorkerDisplay = <
  T extends { dispose(): void; setColor?(color: string): void; setHover?(id: number | null): void },
  Appearance
>(
  initial: T | null,
  load: (appearance: Appearance) => Promise<T>,
  attach: (worker: T) => void = () => undefined
) => {
  let current = initial;
  let color: string | null = null;
  let hovered: number | null = null;
  let request = 0;
  let disposed = false;
  const preparedResources = new Map<T, () => void>();
  if (current) attach(current);
  const prepare = async (appearance: Appearance) => {
    if (disposed) return null;
    const token = ++request;
    const next = await load(appearance);
    if (disposed || token !== request) { next.dispose(); return null; }
    try {
      if (color) next.setColor?.(color);
      next.setHover?.(hovered);
    } catch (error) { next.dispose(); throw error; }
    let used = false;
    const disposePrepared = () => {
      if (used) return;
      used = true;
      preparedResources.delete(next);
      next.dispose();
    };
    preparedResources.set(next, disposePrepared);
    return {
      commit: () => {
        if (used) return false;
        used = true;
        preparedResources.delete(next);
        if (disposed || token !== request) { next.dispose(); return false; }
        try { attach(next); } catch (error) { next.dispose(); throw error; }
        const previous = current;
        current = next;
        previous?.dispose();
        return true;
      },
      dispose: disposePrepared
    };
  };
  return {
    get current() { return current; },
    prepare,
    async replace(appearance: Appearance) {
      const replacement = await prepare(appearance);
      return replacement?.commit() ?? false;
    },
    /** Tunic colour (hex) of the current worker and every later replacement. */
    setColor(value: string) {
      color = value;
      current?.setColor?.(value);
      for (const prepared of preparedResources.keys()) prepared.setColor?.(value);
    },
    /** Hover survives an asynchronous nation/appearance replacement. */
    setHover(id: number | null) {
      hovered = id;
      current?.setHover?.(id);
      for (const prepared of preparedResources.keys()) prepared.setHover?.(id);
    },
    dispose() {
      disposed = true;
      request++;
      for (const cleanup of preparedResources.values()) cleanup();
      current?.dispose();
      current = null;
    }
  };
};

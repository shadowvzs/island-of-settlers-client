import type { StoneGroup } from "./island-rocks";

interface RegistryEntry<T> {
  chunk: number;
  group: StoneGroup | undefined;
  item: T;
}

/**
 * A renderer's rock meshes by terrain chunk and stone group, so the map editor can replace the
 * meshes of some chunks (all of them, or one stone group); `dispose` frees a removed item.
 */
export const createRockMeshRegistry = <T>(dispose: (item: T) => void) => {
  let entries: RegistryEntry<T>[] = [];
  const add = (chunk: number, group: StoneGroup | undefined, item: T) => {
    entries.push({ chunk, group, item });
  };
  /** Removes (and disposes) the chunks' items; with `group` only that stone group's. */
  const remove = (chunks: readonly number[], group?: StoneGroup) => {
    const wanted = new Set(chunks);
    const isRemoved = (entry: RegistryEntry<T>) =>
      wanted.has(entry.chunk) && (group === undefined || entry.group === group);
    for (const entry of entries) if (isRemoved(entry)) dispose(entry.item);
    entries = entries.filter((entry) => !isRemoved(entry));
  };
  return { add, remove };
};

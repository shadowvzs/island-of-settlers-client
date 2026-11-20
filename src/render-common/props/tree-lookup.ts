import { createSourceLookup, type PropInstances } from "./prop-instances";

/** Where a world prop's instance data lives: the world's static set or the editor's placed set. */
export interface TreeSlot {
  index: number;
  instances: PropInstances;
  /** In the placed set (map editor): drawn by the placed layer, not the static layers. */
  placed: boolean;
}

/**
 * Instance lookup by world prop id over the static world instances and the props placed in the
 * map editor (their set is replaced whenever it changes): felling and growth find every tree.
 */
export const createTreeLookup = (worldInstances: PropInstances) => {
  const world = createSourceLookup(worldInstances);
  let placed: PropInstances | null = null;
  let placedLookup = new Map<number, number>();
  const find = (id: number): TreeSlot | undefined => {
    const index = world.get(id);
    if (index !== undefined) return { index, instances: worldInstances, placed: false };
    const placedIndex = placedLookup.get(id);
    if (placedIndex === undefined || !placed) return undefined;
    return { index: placedIndex, instances: placed, placed: true };
  };
  const setPlaced = (instances: PropInstances) => {
    placed = instances;
    placedLookup = createSourceLookup(instances);
  };
  return { find, setPlaced, worldIndexOf: (id: number) => world.get(id) };
};

export type TreeLookup = ReturnType<typeof createTreeLookup>;

interface Workspace {
  previous: Int32Array; cost: Float64Array; seen: Uint32Array; closed: Uint32Array; visited: Int32Array;
  generation: number; busy: boolean;
}
const createWorkspace = (length: number): Workspace => ({ previous: new Int32Array(length),
  cost: new Float64Array(length), seen: new Uint32Array(length), closed: new Uint32Array(length),
  visited: new Int32Array(length), generation: 0, busy: false });

/** Leased scratch only: no geometry, route, callback result or failure certificate is cached. */
export const createSeaSearchWorkspaces = (generationLimit = 0xffffffff) => {
  if (!Number.isInteger(generationLimit) || generationLimit < 1 || generationLimit > 0xffffffff)
    throw new RangeError("Invalid sea-search generation limit");
  const workspaces = new WeakMap<Uint8Array, Workspace>();
  return {
    lease: (mask: Uint8Array) => {
      let workspace = workspaces.get(mask);
      if (!workspace || workspace.previous.length !== mask.length) {
        workspace = createWorkspace(mask.length); workspaces.set(mask, workspace);
      } else if (workspace.busy) workspace = createWorkspace(mask.length);
      workspace.busy = true;
      if (++workspace.generation > generationLimit) {
        workspace.seen.fill(0); workspace.closed.fill(0); workspace.generation = 1;
      }
      const current = workspace;
      let released = false;
      return { previous: current.previous, cost: current.cost, seen: current.seen, closed: current.closed,
        visited: current.visited, generation: current.generation,
        release: () => { if (!released) { released = true; current.busy = false; } } };
    }
  };
};
export type SeaSearchWorkspace = ReturnType<ReturnType<typeof createSeaSearchWorkspaces>["lease"]>;

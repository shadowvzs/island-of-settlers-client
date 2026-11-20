/** Side of one square workspace page in lattice cells. */
export const PATH_PAGE_CELLS = 64;
/** Pages kept allocated between searches; a search needing more falls back to full arrays. */
export const PATH_PAGE_POOL = 64;

interface PathPage {
  cost: Float32Array;
  done: Uint32Array;
  parent: Int32Array;
  seen: Uint32Array;
}

/**
 * Paged A* workspace. Four full-size arrays become a small page pool; untouched pages cost no
 * memory. The generation tags make a page reusable without clearing its 4,096 cells. A search that
 * needs more than the pool is promoted once to full arrays, preserving every value written so far.
 */
export const createPathWorkspace = (width: number, depth: number) => {
  const pagesX = Math.ceil(width / PATH_PAGE_CELLS);
  const pagesZ = Math.ceil(depth / PATH_PAGE_CELLS);
  const pageSlot = new Int32Array(pagesX * pagesZ).fill(-1);
  const pagesBySlot: (PathPage | undefined)[] = new Array(PATH_PAGE_POOL);
  const freeSlots = Array.from({ length: PATH_PAGE_POOL }, (_, index) => PATH_PAGE_POOL - 1 - index);
  const touched: number[] = [];
  let generation = 1;
  let fallback = false;
  let fullCost: Float32Array | undefined;
  let fullDone: Uint32Array | undefined;
  let fullParent: Int32Array | undefined;
  let fullSeen: Uint32Array | undefined;

  const pageOf = (cell: number) => {
    const x = cell % width;
    const z = Math.floor(cell / width);
    return Math.floor(z / PATH_PAGE_CELLS) * pagesX + Math.floor(x / PATH_PAGE_CELLS);
  };
  const localOf = (cell: number) => {
    const x = cell % width;
    const z = Math.floor(cell / width);
    return (z % PATH_PAGE_CELLS) * PATH_PAGE_CELLS + x % PATH_PAGE_CELLS;
  };
  const promote = () => {
    if (fallback) return;
    fallback = true;
    fullCost ??= new Float32Array(width * depth);
    fullDone ??= new Uint32Array(width * depth);
    fullParent ??= new Int32Array(width * depth);
    fullSeen ??= new Uint32Array(width * depth);
    for (const pageIndex of touched) {
      const slot = pageSlot[pageIndex] ?? -1;
      if (slot < 0) continue;
      const page = pagesBySlot[slot]!;
      const baseX = (pageIndex % pagesX) * PATH_PAGE_CELLS;
      const baseZ = Math.floor(pageIndex / pagesX) * PATH_PAGE_CELLS;
      for (let z = 0; z < PATH_PAGE_CELLS; z += 1) {
        const worldZ = baseZ + z;
        if (worldZ >= depth) break;
        for (let x = 0; x < PATH_PAGE_CELLS; x += 1) {
          const worldX = baseX + x;
          if (worldX >= width) break;
          const global = worldZ * width + worldX;
          const local = z * PATH_PAGE_CELLS + x;
          fullCost![global] = page.cost[local]!;
          fullDone![global] = page.done[local]!;
          fullParent![global] = page.parent[local]!;
          fullSeen![global] = page.seen[local]!;
        }
      }
    }
  };
  const slotOf = (cell: number) => {
    if (fallback) return -1;
    const page = pageOf(cell);
    const slot = pageSlot[page] ?? -1;
    if (slot >= 0) return slot;
    const free = freeSlots.pop();
    if (free === undefined) {
      promote();
      return -1;
    }
    let allocated = pagesBySlot[free];
    if (!allocated) {
      allocated = {
        cost: new Float32Array(PATH_PAGE_CELLS * PATH_PAGE_CELLS),
        done: new Uint32Array(PATH_PAGE_CELLS * PATH_PAGE_CELLS),
        parent: new Int32Array(PATH_PAGE_CELLS * PATH_PAGE_CELLS),
        seen: new Uint32Array(PATH_PAGE_CELLS * PATH_PAGE_CELLS)
      };
      pagesBySlot[free] = allocated;
    }
    pageSlot[page] = free;
    touched.push(page);
    return free;
  };
  return {
    /** Starts a search: recycles only the pages touched by the previous search. */
    begin: () => {
      for (const page of touched) {
        const slot = pageSlot[page] ?? -1;
        if (slot < 0) continue;
        pageSlot[page] = -1;
        freeSlots.push(slot);
      }
      touched.length = 0;
      fallback = false;
      generation = (generation + 1) >>> 0;
      if (generation === 0) {
        generation = 1;
        pageSlot.fill(-1);
        for (const page of pagesBySlot) {
          page?.done.fill(0);
          page?.seen.fill(0);
        }
        fullDone?.fill(0);
        fullSeen?.fill(0);
      }
    },
    cost: (cell: number) => {
      if (fallback) return fullCost![cell]!;
      const slot = pageSlot[pageOf(cell)] ?? -1;
      return slot < 0 ? 0 : pagesBySlot[slot]!.cost[localOf(cell)]!;
    },
    isDone: (cell: number) => {
      if (fallback) return fullDone![cell] === generation;
      const slot = pageSlot[pageOf(cell)] ?? -1;
      return slot >= 0 && pagesBySlot[slot]!.done[localOf(cell)] === generation;
    },
    isSeen: (cell: number) => {
      if (fallback) return fullSeen![cell] === generation;
      const slot = pageSlot[pageOf(cell)] ?? -1;
      return slot >= 0 && pagesBySlot[slot]!.seen[localOf(cell)] === generation;
    },
    markDone: (cell: number) => {
      const slot = slotOf(cell);
      if (fallback || slot < 0) fullDone![cell] = generation;
      else pagesBySlot[slot]!.done[localOf(cell)] = generation;
    },
    markSeen: (cell: number) => {
      const slot = slotOf(cell);
      if (fallback || slot < 0) fullSeen![cell] = generation;
      else pagesBySlot[slot]!.seen[localOf(cell)] = generation;
    },
    parent: (cell: number) => {
      if (fallback) return fullParent![cell]!;
      const slot = pageSlot[pageOf(cell)] ?? -1;
      return slot < 0 ? -1 : pagesBySlot[slot]!.parent[localOf(cell)]!;
    },
    setCost: (cell: number, value: number) => {
      const slot = slotOf(cell);
      if (fallback || slot < 0) fullCost![cell] = value;
      else pagesBySlot[slot]!.cost[localOf(cell)] = value;
    },
    setParent: (cell: number, value: number) => {
      const slot = slotOf(cell);
      if (fallback || slot < 0) fullParent![cell] = value;
      else pagesBySlot[slot]!.parent[localOf(cell)] = value;
    }
  };
};

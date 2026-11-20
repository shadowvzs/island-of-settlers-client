import { FOG, type WorldData } from "../../shared/world/world-data";
/** Broad RTS sight: a circular radius of 12 map cells. */
export const WORKER_SIGHT_RADIUS = 12;

/**
 * Sight shared by every worker of a player: how many workers see each cell and the fog that was
 * visible before any worker (the starting settlement), so a cell only fades to discovered once
 * no worker sees it any more.
 */
export const createSharedSight = (world: WorldData) => ({
  permanent: world.permanentFog ?? (world.permanentFog = world.fog.slice()),
  territory: new Uint8Array(world.fog.length),
  viewers: new Uint16Array(world.fog.length)
});

export type SharedSight = ReturnType<typeof createSharedSight>;

export const createWorkerVision = (
  world: WorldData,
  radius = WORKER_SIGHT_RADIUS,
  sight: SharedSight = createSharedSight(world)
) => {
  const { permanent, territory, viewers } = sight;
  let visible: number[] = [],
    lastX = Number.NaN,
    lastZ = Number.NaN;
  const forgetVisible = (cells: readonly number[]) => {
    let changed = false;
    for (const cell of cells) {
      viewers[cell] = Math.max(0, viewers[cell]! - 1);
      if (viewers[cell] === 0 && !territory[cell] && permanent[cell] !== FOG.visible && world.fog[cell] !== FOG.discovered) {
        world.fog[cell] = FOG.discovered; changed = true;
      }
    }
    return changed;
  };
  const see = (x: number, z: number) => {
    let changed = false;
    const minX = Math.max(0, Math.floor(x - radius)),
      maxX = Math.min(world.cellsX - 1, Math.ceil(x + radius));
    const minZ = Math.max(0, Math.floor(z - radius)),
      maxZ = Math.min(world.cellsZ - 1, Math.ceil(z + radius));
    for (let row = minZ; row <= maxZ; row++)
      for (let column = minX; column <= maxX; column++) {
        if ((column + 0.5 - x) ** 2 + (row + 0.5 - z) ** 2 > radius * radius) continue;
        const cell = row * world.cellsX + column;
        if (world.fog[cell] !== FOG.visible) { world.fog[cell] = FOG.visible; changed = true; }
        viewers[cell]!++;
        visible.push(cell);
      }
    return changed;
  };
  return {
    radius,
    suspend: () => {
      if (!visible.length) return;
      const changed = forgetVisible(visible);
      visible = [];
      lastX = Number.NaN;
      lastZ = Number.NaN;
      if (changed) world.fogRevision = (world.fogRevision ?? 0) + 1;
    },
    update: (x: number, z: number) => {
      if (Math.hypot(x - lastX, z - lastZ) < 0.25) return false;
      lastX = x;
      lastZ = z;
      // Add the new footprint first: overlapping cells never temporarily lose their viewer.
      const previous = visible;
      visible = [];
      const revealed = see(x, z), hidden = forgetVisible(previous);
      if (revealed || hidden) world.fogRevision = (world.fogRevision ?? 0) + 1;
      return true;
    }
  };
};

import { markFogChanged } from "../world/fog-revision";
import { FOG, type WorldData } from "../world/world-data";
import { ownerOf } from "./settlement-ownership";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";
import { LOOKOUT_SIGHT_RADIUS } from "./settlement-work-ranges";
import { lookoutSightFactor } from "./workshop-upgrades";

/** The faction whose vision layer is the fog of war on screen. */
export { PLAYER_FACTION } from "./settlement-ownership";
const LOOKOUT_TYPE_ID = 14;

/** Counter crossings of the player's vision layer (faction-vision.ts calls them while it stamps). */
export interface PlayerSightSink {
  /** The cell's player observer count went from 0 to 1. */
  seen(cell: number): void;
  /** The cell's player observer count went back to 0. */
  unseen(cell: number): void;
}

/** What the fog reads from the island each tick; the settlement context satisfies it. */
export interface PlayerFogSources {
  actors: readonly SettlementActor[];
  buildings: readonly SettlementBuilding[];
}

/** The owned land with one exterior ring (vertex fog interpolation never crosses the border). */
const territoryRing = (world: WorldData, owned: Uint8Array) => {
  const ring = new Uint8Array(owned.length);
  for (let cell = 0; cell < owned.length; cell++) {
    if (!owned[cell]) continue;
    const x = cell % world.cellsX, z = (cell - x) / world.cellsX;
    for (let nz = Math.max(0, z - 1); nz <= Math.min(world.cellsZ - 1, z + 1); nz++)
      for (let nx = Math.max(0, x - 1); nx <= Math.min(world.cellsX - 1, x + 1); nx++) ring[nz * world.cellsX + nx] = 1;
  }
  return ring;
};

/** A staffed player lookout: its scout is inside. */
const staffedLookout = (sources: PlayerFogSources, building: SettlementBuilding) => {
  if (building.typeId !== LOOKOUT_TYPE_ID || building.construction < 1 || ownerOf(building) > 0)
    return false;
  if (building.worker === undefined) return false;
  const worker = sources.actors.find(actor => actor.uid === building.worker);
  return worker?.job === "Scout" && worker.phase === "inside";
};

/**
 * A13 phase 2: the player's fog of war is simulation state (owner decision D-AI1). `world.fog` is written
 * inside the tick, only for cells that change:
 * - visible: the player's vision layer sees the cell, it is owned land (plus one ring), or permanent
 *   sight (starting sector, fog of war off, development reveal: `world.permanentFog`);
 * - discovered: explored once (sight, ship coast discovery, lookout charting) and not visible now;
 * - hidden: never explored.
 * Exploration is the saved fog itself (a cell never returns to hidden), so nothing else is saved: a load
 * rebuilds the live part from positions, territory and permanent sight. Expedition islands show no fog
 * and are left untouched.
 */
// oxlint-disable-next-line max-lines-per-function -- one closure keeps the per-tick writers allocation free
export const createPlayerFog = (world: WorldData, playerLayer: () => Readonly<Uint16Array> | undefined) => {
  /** Lookout uid → the radius it has charted (not saved: re-charting after a load changes no cell). */
  const charted = new Map<number, number>();
  let territory = new Uint8Array(world.fog.length);
  let owned: Uint8Array | undefined;
  let changed = false, explored = false;

  // Permanent sight is the fog before any live source (the starting sector), unless a load restored it.
  world.permanentFog ??= world.fog.slice();
  const permanent = () => world.permanentFog ?? (world.permanentFog = world.fog.slice());
  const reveal = (cell: number) => {
    const fog = world.fog, value = fog[cell]!;
    if (value === FOG.visible) return;
    if (value === FOG.hidden) explored = true;
    fog[cell] = FOG.visible;
    changed = true;
  };
  /** A cell no live source keeps visible any more fades to discovered (unless permanently visible). */
  const fade = (cell: number) => {
    const fog = world.fog;
    if (fog[cell] !== FOG.visible || territory[cell] || permanent()[cell] === FOG.visible) return;
    fog[cell] = FOG.discovered;
    changed = true;
  };
  const sink: PlayerSightSink = { seen: reveal, unseen: fade };

  const updateTerritory = (next: Uint8Array) => {
    if (next === owned) return;
    owned = next;
    const previous = territory, layer = playerLayer();
    territory = territoryRing(world, next);
    for (let cell = 0; cell < territory.length; cell++) {
      if (territory[cell] === previous[cell]) continue;
      if (territory[cell]) reveal(cell);
      else if (!layer?.[cell]) fade(cell);
    }
  };
  /** A disk around the lookout's centre (cell centres within the radius) becomes explored. */
  const chart = (building: SettlementBuilding, radius: number) => {
    const fog = world.fog;
    const firstZ = Math.max(0, Math.floor(building.z - radius));
    const lastZ = Math.min(world.cellsZ, Math.ceil(building.z + radius));
    const firstX = Math.max(0, Math.floor(building.x - radius));
    const lastX = Math.min(world.cellsX, Math.ceil(building.x + radius));
    const limit = radius * radius;
    for (let z = firstZ; z < lastZ; z++)
      for (let x = firstX; x < lastX; x++) {
        const dx = x + .5 - building.x, dz = z + .5 - building.z;
        if (dx * dx + dz * dz > limit) continue;
        const cell = z * world.cellsX + x;
        if (fog[cell] !== FOG.hidden) continue;
        fog[cell] = FOG.discovered;
        changed = true; explored = true;
      }
  };
  /** A staffed lookout charts its circle once per radius (an upgrade charts the wider one); no live sight. */
  const chartLookouts = (sources: PlayerFogSources) => {
    for (const building of sources.buildings) {
      if (building.typeId !== LOOKOUT_TYPE_ID) continue;
      const radius = LOOKOUT_SIGHT_RADIUS * lookoutSightFactor(building);
      if (charted.get(building.uid) === radius || !staffedLookout(sources, building)) continue;
      charted.set(building.uid, radius);
      chart(building, radius);
    }
  };
  const flush = () => {
    if (changed) markFogChanged(world, explored);
    changed = false; explored = false;
  };
  /** Every cell from scratch: the live sources decide visible, exploration keeps discovered. */
  const normalize = () => {
    const fog = world.fog, layer = playerLayer(), sight = permanent();
    for (let cell = 0; cell < fog.length; cell++) {
      if (layer?.[cell] || territory[cell] || sight[cell] === FOG.visible) reveal(cell);
      else if (fog[cell] === FOG.visible) { fog[cell] = FOG.discovered; changed = true; }
    }
  };
  return {
    sink,
    /** End of a tick, after the vision layer: owned land and lookout charting, then one revision bump. */
    update: (sources: PlayerFogSources, ownedLand: Uint8Array) => {
      updateTerritory(ownedLand);
      chartLookouts(sources);
      flush();
    },
    /** A load or a fresh island: territory and every cell again (the vision layer was rebuilt first). */
    rebuild: (sources: PlayerFogSources, ownedLand: Uint8Array) => {
      owned = ownedLand;
      territory = territoryRing(world, ownedLand);
      charted.clear();
      normalize();
      chartLookouts(sources);
      flush();
    }
  };
};

export type PlayerFog = ReturnType<typeof createPlayerFog>;

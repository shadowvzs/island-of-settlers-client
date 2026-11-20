import type { CellRegion } from "../../../shared/world/grid-geometry";
import { evaluateDormantPose } from "../sim/dormant-routine";
import type { AnimalManagerState } from "./animal-manager-state";
import { type AnimalModes, ROAM_MARGIN } from "./animal-modes";

/**
 * The wildlife pool as the island's map script reads it (lane TRG3b): slot liveness, species and positions, and
 * the pins that keep the habitat regions around scripted regions awake (design §6.4). Read-only apart from the
 * pins; the pins are derived from the map script, so every host pins the same regions.
 */
export const createAnimalScriptView = (state: AnimalManagerState, modes: AnimalModes) => {
  const { capacity, context, dormant, identity, pool, regions } = state;
  const isSimulated = (slot: number) => pool.active[slot] === 1 && !pool.pending[slot] && !pool.carcass[slot] &&
    !pool.departing[slot];
  /** Habitat regions an animal reaching the cells may call home (the cells grown by the roam margin). */
  const regionsAround = (cells: readonly CellRegion[]) => {
    const found = new Set<number>();
    for (const region of cells) {
      regions.forEachRegionInCells({
        maxX: region.maxX + ROAM_MARGIN, maxZ: region.maxZ + ROAM_MARGIN,
        minX: region.minX - ROAM_MARGIN, minZ: region.minZ - ROAM_MARGIN
      }, index => found.add(index));
    }
    return [...found].sort((a, b) => a - b);
  };
  return {
    capacity,
    isCarcass: (slot: number) => pool.carcass[slot] === 1,
    isLiving: (slot: number) => identity.dormant[slot] === 1 || isSimulated(slot),
    isSimulated,
    pinCells: (cells: readonly CellRegion[]) => modes.setPinned(regionsAround(cells)),
    position: (slot: number) => {
      if (!identity.dormant[slot]) return { x: pool.x[slot]!, z: pool.z[slot]! };
      const pose = evaluateDormantPose(dormant, slot, context.tick);
      return { x: pose.x, z: pose.z };
    },
    species: (slot: number) => pool.species[slot]!,
    x: (slot: number) => pool.x[slot]!,
    z: (slot: number) => pool.z[slot]!
  };
};

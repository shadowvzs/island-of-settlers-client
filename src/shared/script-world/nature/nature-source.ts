import type { CellRegion } from "../../world/grid-geometry";

/**
 * What the island's app-side nature managers (wildlife pool, tree growth) give the map script (trigger design
 * §5.1.5, §6.4, lane TRG3b). The managers step in the settlement's `onTickStart`, so the hooks object that wires
 * them (`island-resource-hooks.ts`, shared by the client island and the server bundle's headless island) also
 * provides this source: both paths see the same slots, stage changes and removals.
 */

/** Read access to the wildlife pool slots (region animals first, then the map editor's placed animals). */
export interface ScriptWildlifeSlots {
  readonly capacity: number;
  /** A killed animal lies there (its slot is not reused until the carcass is gone). */
  isCarcass: (slot: number) => boolean;
  /** A living animal: simulated or dormant; not a pending birth, a carcass or a departing animal. */
  isLiving: (slot: number) => boolean;
  /** A living animal simulated this tick (its pool position moves per tick; dormant ones follow routines). */
  isSimulated: (slot: number) => boolean;
  /** Where a living animal stands now (a dormant one: its closed-form routine pose of the current tick). */
  position: (slot: number) => { x: number; z: number };
  /** The `animal:*` catalog code of the slot's species. */
  species: (slot: number) => number;
  /** Pool position of a simulated animal (the per-tick region watch reads these without allocating). */
  x: (slot: number) => number;
  z: (slot: number) => number;
}

/** Calls from the managers into the island's script adapter (made while they step or are hit). */
export interface ScriptNatureListener {
  /** A living animal left its slot (killed, removed by the editor, sent away by its region). */
  animalRemoved: (slot: number) => void;
  /** A growing tree (prop index) reached growth stage 2..5 (5 = mature). */
  treeStage: (prop: number, stage: number) => void;
}

export interface ScriptNatureSource {
  /** The island script's listener; undefined detaches it (an island without a script). */
  listen: (listener: ScriptNatureListener | undefined) => void;
  /**
   * Keeps the wildlife habitat regions around these cells awake (design §6.4 pins), so their animals are stepped
   * per tick and the region watch sees them move. Set at script start and load (derived from the script only).
   */
  pinWildlife: (cells: readonly CellRegion[]) => void;
  wildlife: ScriptWildlifeSlots;
}

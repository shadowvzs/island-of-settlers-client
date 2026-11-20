import type { AuthoredAnimal } from "../../shared/world/authored-animals";
import type { CellRegion } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { harvestCarcass, isCarcass } from "../helpers";
import { authoredAnimalGround } from "./manager/animal-editor-placement";
import { createAnimalEvents } from "./manager/animal-events";
import { createAnimalHomes } from "./manager/animal-homes";
import { createAnimalHuntTargets } from "./manager/animal-hunt-targets";
import { type AnimalManagerOptions, createAnimalManagerState } from "./manager/animal-manager-state";
import { createAnimalModes } from "./manager/animal-modes";
import { type AnimalSaveState, restoreAnimals, saveAnimals } from "./manager/animal-save";
import { createAnimalScriptView } from "./manager/animal-script-view";
import { createAnimalSpawner } from "./manager/animal-spawner";
import { createAnimalStepper } from "./manager/animal-stepper";
import { createPathFinder } from "./nav/nav-path";
import type { NavWorld } from "./nav/nav-query";
import type { TreeChanges } from "./population/wildlife-regions";
import { setAnimalAge } from "./sim/animal-age";
import { getAnimalInfo, isHuntableAnimal } from "./sim/animal-info";
import { getStageAge, type LifeStage } from "./wildlife-stages";

const sum = (values: Uint8Array) => values.reduce((total, value) => total + value, 0);

/**
 * The island's land animals (Wildlife 2.0, S10): 32 x 32 cell regions support animals by their
 * standing mature trees (at most 300 per island), a respawn ledger brings a missing one back after
 * 5 minutes, and only regions touched by simulation events (hunters, threats, edits, plots) are
 * simulated; the others' animals walk closed-form routines at no per-tick cost. Shared and
 * deterministic (fixed steps, seeded, never the camera); renderers only read the AnimalFrame.
 */
export const createAnimalManager = (
  world: WorldData,
  nav: NavWorld,
  saved?: AnimalSaveState,
  authored: readonly AuthoredAnimal[] = [],
  options: AnimalManagerOptions = {}
) => {
  const state = createAnimalManagerState(world, nav, options);
  const { context, frame, identity, pool } = state;
  const modes = createAnimalModes(state);
  const spawner = createAnimalSpawner(state, modes);
  const homes = createAnimalHomes(state, modes, spawner);
  const events = createAnimalEvents(state, modes, spawner);
  const hunting = createAnimalHuntTargets(state, modes);
  const stepper = createAnimalStepper(state, modes, spawner, homes.start);
  const invalidAuthored: AuthoredAnimal[] = [];
  if (saved) restoreAnimals(state, saved, spawner, modes);
  else {
    for (const animal of authored) {
      if (!spawner.placeAnimal(animal.species, animal.x, animal.z, animal.age)) invalidAuthored.push({ ...animal });
    }
  }
  let excluded: NavWorld["isExcluded"];

  /** Editor navigation rebuilds: routines were validated on the old one, so every region wakes. */
  const setNav = (next: NavWorld) => {
    next.isExcluded = excluded;
    context.nav = next;
    context.finder = createPathFinder(next);
    modes.wakeAll();
  };

  return {
    saveState: () => saveAnimals(state, spawner, modes),
    invalidAuthored: () => invalidAuthored,
    validateAuthored: (animals: readonly AuthoredAnimal[]) => animals.flatMap((animal, index) =>
      authoredAnimalGround(state, animal.species, animal.x, animal.z, animal.age) ? [] :
        [`Animal ${index + 1}: unsuitable habitat or insufficient connected body clearance`]),
    /** The audited simulation stream (the settlement's random audit records its draws). */
    random: context.random,
    /** Navigation, regions, ledger and live state for the debug view and tests (read only). */
    debug: { dormant: state.dormant, identity, ledger: state.ledger, motion: context.motion, nav, pool,
      regions: state.regions },
    /** Living animals: simulated (pending births included) and dormant. */
    countAlive: () => sum(pool.active) + sum(identity.dormant),
    countDrawn: () => frame.count,
    /** Regions that are home to at least one animal. */
    countHomeRegions: homes.countHomeRegions,
    /** Regions simulated now (touched recently or not calm yet). */
    countSimulatedRegions: modes.countActive,
    /** Huntable animals anywhere on the island, dormant ones included (read-only: tutorial checks). */
    countHuntable: hunting.countHuntable,
    /** A hunter's prey or the carcass it collects: its region is simulated (woken, held). */
    ensureSimulated: events.ensureSimulated,
    /** Hunter ready snapshot: age, stage, sex, health, state, huntability, meat yield... */
    getAnimalInfo: (id: number) => getAnimalInfo(pool, id),
    isHuntable: (id: number) => isHuntableAnimal(pool, id),
    /** A living simulated animal (no pending birth, no carcass). */
    isLiving: hunting.isLiving,
    /** Takes a lying carcass away at once (future hunters / butchers); false when none. */
    harvestCarcass: (id: number) => harvestCarcass(pool, id),
    /** True while a killed animal lies dead (after its fall, before it fades). */
    isCarcass: (id: number) => isCarcass(pool, id),
    hitHuntedAnimal: events.hitHuntedAnimal,
    killAnimal: events.killAnimal,
    /** Every huntable animal at its current pose, dormant ones included (read-only inspection). */
    listHuntableSnapshot: hunting.listHuntableSnapshot,
    /** A hunter's prey scan: wakes the regions around `near`, then lists animals within `range`. */
    listHuntTargets: hunting.listHuntTargets,
    /** Every living animal at its current pose, dormant ones included (read-only: debug hooks). */
    listLiving: hunting.listLiving,
    /** An animal broke into flight at (x, z) (birds nearby scatter). */
    onAnimalFled: events.onAnimalFled,
    /** An animal was killed at (x, z) (birds nearby scatter). */
    onAnimalKilled: events.onAnimalKilled,
    onAnimalRemoved: state.removed.listen,
    onThreat: events.onThreat,
    placeAnimal: spawner.placeAnimal,
    restorePlacedAnimal: (species: number, x: number, z: number, age?: number) =>
      spawner.placeAnimal(species, x, z, age, true),
    /**
     * Map editor and building plots: the habitat of the edited cells (with the current
     * navigation) and the regions of the placed and removed trees; animals their region no
     * longer supports fade out and leave, new ones come from the ledger.
     */
    refreshHomes: (cells: CellRegion, trees: TreeChanges) => homes.refresh(cells, trees, context.nav),
    /**
     * A building plot was planned or demolished there (a live simulation event, never a load):
     * the regions around wake, so routines are validated again on the changed ground.
     */
    touchArea: modes.touchCells,
    relocateFrom: events.relocateFrom,
    removePlacedAnimal: events.removePlacedAnimal,
    setNav,
    setExcluded: (predicate: NavWorld["isExcluded"]) => {
      excluded = predicate;
      context.nav.isExcluded = predicate;
      if (predicate) events.relocateFrom(predicate);
    },
    /** A tree was felled: its region counts one standing tree less. */
    onTreeFelled: homes.onTreeFelled,
    /** A planted tree finished growing: its region counts one mature tree more. */
    onTreeGrown: homes.onTreeGrown,
    /** Slots, positions and habitat pins for the island's map script (TRG3b). */
    script: createAnimalScriptView(state, modes),
    /** Normalised age 0 (newborn) .. 1 (fully grown). */
    setAgeNormalized: (id: number, age: number) => setAnimalAge(pool, id, age),
    setLifeStage: (id: number, stage: LifeStage) => setAnimalAge(pool, id, getStageAge(stage)),
    /** One settlement tick of the island's wildlife (the settlement's `onTickStart`). */
    step: stepper.step,
    /** `dt` seconds at once (offline catch-up): the same rules on a coarser movement step. */
    stepCoarse: stepper.stepCoarse,
    update: stepper.update
  };
};

export type AnimalManager = ReturnType<typeof createAnimalManager>;

import { prepareOfflineEconomyWildlife } from "../../src/app/settlement/offline-economy-wildlife";
import { createAnimalManager } from "../../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../../src/render-common/wildlife/nav/island-nav";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { huntingWorld } from "./hunting-world";
import { createHunterSimulation, HERD } from "./wildlife-hunt-run";

const TICK = 0.05;
/** Calibration horizon after the snapshot (seconds) and the extra offline time to deliver its kills. */
const HORIZON = 360;
const DELIVERY = 90;

/** The hunter is idle as the offline planner needs it: no target, ware or running production. */
const isIdleHunter = (save: GameSaveV1["settlement"]) => {
  const building = save.buildings.find((entry) => entry.typeId === 22 && entry.construction === 1);
  const actor = save.actors.find((entry) => entry.uid === building?.worker);
  if (!actor) return false;
  return !actor.target && !actor.preparedTarget && !actor.ware && actor.productionSeconds === undefined;
};

/**
 * Kill counts of the same hunting scenario online (settlement ticks) and offline (the manager's
 * coarse mode with the offline hunter model), from one snapshot of the hunter idle at home.
 */
export const calibrateHunting = () => {
  const world = huntingWorld(), animals = createAnimalManager(world, createIslandNav(world, []));
  for (const [species, x, z] of HERD) animals.placeAnimal(species, x, z, 1);
  const simulation = createHunterSimulation(world, animals);
  let snapshot: GameSaveV1 | undefined;
  for (let tick = 0; tick < 20 * 120 && !snapshot; tick += 1) {
    simulation.update(TICK);
    const settlement = simulation.saveState();
    if (tick > 20 && isIdleHunter(settlement)) {
      snapshot = { settlement, runtime: { animals: animals.saveState() }, savedAt: 1000 } as GameSaveV1;
    }
  }
  if (!snapshot) throw new Error("the hunter never idled at home");
  const kills: number[] = [];
  let elapsed = 0;
  animals.onAnimalKilled(() => kills.push(elapsed));
  for (; elapsed < HORIZON; elapsed += TICK) simulation.update(TICK);
  const plan = prepareOfflineEconomyWildlife(structuredClone(snapshot), world, HORIZON + DELIVERY);
  return { offline: plan.hunts.filter((hunt) => hunt.killedSeconds <= HORIZON).length, online: kills.length };
};

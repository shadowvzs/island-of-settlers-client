import { expect, it } from "vitest";

import { huntingArrows } from "../src/app/settlement/hunting-arrows";
import { createCamera } from "../src/render-common/camera-state";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

it("shoots twice from range, follows the escaped prey and collects meat, including a mid-shot reload", () => {
  const world = huntingWorld(), animals = createAnimalManager(world, createIslandNav(world, []));
  expect(animals.placeAnimal(SPECIES.deer, 30, 30)).toBe(true);
  const pool = animals.debug.pool, id = pool.active.findIndex(Boolean);
  pool.pending[id] = 0; pool.appear[id] = 1; animals.setAgeNormalized(id, 1);
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const shots: number[] = [];
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 8,
    initialStock: { bow: 1, planks: 10 },
    resourceTargets: kind => kind === "wildlife" && pool.active[id]
      ? [{ id, kind, x: pool.x[id]!, z: pool.z[id]! }] : [],
    getHuntTarget: () => pool.active[id] || pool.carcass[id]
      ? { x: pool.x[id]!, z: pool.z[id]!, fleeing: pool.huntState[id] === 1,
        dead: Boolean(pool.carcass[id]), collectible: animals.isCarcass(id) } : null,
    hitHuntTarget: (target, from) => {
      shots.push(Math.hypot(from.x - pool.x[target]!, from.z - pool.z[target]!));
      return animals.hitHuntedAnimal(target, from);
    }, consumeResource: target => animals.harvestCarcass(target.id) });
  const placed = simulation.placeBuilding(22, 22, 22);
  expect(placed.ok, placed.reason).toBe(true);
  placed.building!.construction = 1; placed.building!.foundationProgress = 1;
  expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  const camera = createCamera(30, 30, 1);
  let reloaded = false, arrowSeen = false, chased = false;
  for (let step = 0; step < 12000 && !(simulation.headquarters.inventory.meat); step++) {
    const time = step / 30;
    animals.update(time, camera); simulation.update(1 / 30);
    chased ||= simulation.frames().some(a => a.phase === "huntChase");
    arrowSeen ||= huntingArrows(simulation.frames()).length > 0;
    if (!reloaded && huntingArrows(simulation.frames()).length) {
      expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
      reloaded = true;
    }
  }
  expect(shots, JSON.stringify(simulation.frames().filter(a => a.job === "Hunter"))).toHaveLength(2);
  expect(shots.every(distance => distance >= 2 && distance <= 5)).toBe(true);
  expect(reloaded && arrowSeen && chased).toBe(true);
  expect(simulation.headquarters.inventory.meat).toBe(1);
  expect(pool.active[id]).toBe(0);
});

import { createHash } from "node:crypto";

import type { CameraState } from "../../src/render-common/camera-state";
import { createAnimalManager } from "../../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../../src/render-common/wildlife/nav/island-nav";
import { SPECIES } from "../../src/render-common/wildlife/wildlife-species";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./hunting-world";

const TICK = .05;
export const HERD: readonly [number, number, number][] = [
  [SPECIES.deer, 30, 30], [SPECIES.deer, 34, 28], [SPECIES.rabbit, 28, 36], [SPECIES.elk, 40, 40],
  [SPECIES.deer, 44, 32], [SPECIES.rabbit, 36, 44], [SPECIES.deer, 26, 44], [SPECIES.elk, 48, 46],
  [SPECIES.rabbit, 20, 40], [SPECIES.deer, 40, 22]
];

type AnimalManager = ReturnType<typeof createAnimalManager>;

/** One finished hunter (22, 22) on the hunting world, its worker still to walk there. */
export const createHunterSimulation = (world: ReturnType<typeof huntingWorld>, animals: AnimalManager) => {
  const { pool } = animals.debug;
  const isLive = (id: number) => pool.active[id] === 1 && animals.isHuntable(id);
  const simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 8,
    initialStock: { bow: 1, planks: 10 }, roads: createRoadNetwork(world), world,
    consumeResource: target => animals.harvestCarcass(target.id), onTickStart: animals.step,
    getHuntTarget: id => pool.carcass[id] || isLive(id) ? { collectible: animals.isCarcass(id),
      dead: Boolean(pool.carcass[id]), fleeing: pool.huntState[id] === 1, x: pool.x[id]!, z: pool.z[id]! } : null,
    hitHuntTarget: (id, from) => animals.hitHuntedAnimal(id, from),
    resourceTargets: (kind, near, range) => {
      if (kind !== "wildlife" && kind !== "carcass") return undefined;
      const targets = [];
      for (let id = 0; id < pool.active.length; id++) {
        const wanted = kind === "carcass" ? animals.isCarcass(id) : isLive(id);
        if (!wanted || Math.hypot(pool.x[id]! - near.x, pool.z[id]! - near.z) > range) continue;
        targets.push({ id, kind, x: pool.x[id]!, z: pool.z[id]! });
      }
      return targets;
    } });
  const placed = simulation.placeBuilding(22, 22, 22);
  if (!placed.ok) throw new Error(placed.reason);
  placed.building!.construction = 1; placed.building!.foundationProgress = 1;
  simulation.connectRoads(simulation.headquarters.access, placed.building!.access);
  return simulation;
};

const hashAnimals = (animals: AnimalManager) =>
  createHash("sha256").update(JSON.stringify(animals.saveState())).digest("hex").slice(0, 12);

/**
 * One hunter and a fixed herd for `minutes` of settlement ticks; the wildlife steps inside the
 * ticks and `camera` only draws frames (as the live render loop does). Kill ticks, meat and the
 * wildlife save hash halfway and at the end.
 */
export const runHunt = (camera: CameraState, minutes: number) => {
  const world = huntingWorld(), animals = createAnimalManager(world, createIslandNav(world, []));
  for (const [species, x, z] of HERD) animals.placeAnimal(species, x, z, 1);
  const simulation = createHunterSimulation(world, animals);
  const ticks = minutes * 60 / TICK, kills: number[] = [];
  let meat = 0, halfway = "", simulationMs = 0;
  for (let tick = 1; tick <= ticks; tick++) {
    const started = performance.now();
    simulation.update(TICK);
    simulationMs += performance.now() - started;
    animals.update(tick * TICK, camera, simulation.tickFraction());
    const now = simulation.headquarters.inventory.meat ?? 0;
    if (now > meat) kills.push(tick);
    meat = now;
    if (tick === ticks / 2) halfway = hashAnimals(animals);
  }
  return { alive: animals.countAlive(), end: hashAnimals(animals), halfway, kills, meat,
    simulationMsPerTick: +(simulationMs / ticks).toFixed(4) };
};

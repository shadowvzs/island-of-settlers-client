import { expect } from "vitest";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getBuildingProductionRule } from "../../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { countSaveIntegrity } from "../../src/shared/settlement/settlement-save-integrity";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../../src/shared/settlement/settlement-types";
import { huntingWorld } from "./hunting-world";

/** Even footprints centre on a cell edge, odd footprints on a cell centre. */
const parity = (size: number) => size % 2 ? .5 : 0;

/**
 * One completed production building at the population cap with a single stationary worker. The actor
 * is inside, idle and has no path, target, queue, cargo, handling, work timer or job-specific phase.
 * In paused mode its rule's pre-pause branches (`updateForester`, `updatePigBreeder`,
 * `updateHunter`, `recoverResourceApproach`, the drink-chain tool pickup) all
 * return false, and `beginProduction` reaches the pause check and only re-states `Production stopped`.
 */
export const pausedProductionSettlement = (typeId: number, paused = true) => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 100 });
  expect(simulation.buildings()).toHaveLength(1);
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const placed = simulation.placeBuilding(typeId, 50 + parity(width), 20 + parity(depth));
  expect(placed.ok, `${typeId}: ${placed.reason}`).toBe(true);
  const settlement = simulation.saveState();
  const home = settlement.buildings.find(building => building.typeId === 0)!;
  const building = settlement.buildings.find(building => building.uid === placed.building!.uid)!;
  const rule = getBuildingProductionRule(building)!;
  Object.assign(building, {
    construction: 1, foundationProgress: 1, productionPaused: paused, working: false,
    status: paused ? "Production stopped" : "Working",
    door: 1, input: {}, output: {}, incoming: {}, required: {}, workTime: 0
  });
  const actor: SettlementActor = {
    uid: 1, job: rule.job, home: home.uid, building: building.uid,
    x: building.x, y: 2, z: building.z, yaw: 0, visible: false, action: "idle", ware: null,
    phase: "inside", path: [], pathIndex: 0, timer: -0.2, animationTime: 0,
    // The grower's tool branch runs before the pause check; keeping its real tool makes it a no-op.
    ...(typeId === 5 ? { tool: rule.tool } : {})
  };
  settlement.actors = [actor];
  settlement.nextActor = 2;
  building.worker = actor.uid;
  home.idleSettlers = 99;
  settlement.settlers = 99;
  settlement.integrity = countSaveIntegrity(settlement);
  return { world, settlement };
};

/** Recompute integrity after a fixture changes the settlement record. */
export const sealSettlement = (settlement: SettlementSaveV1) => {
  settlement.integrity = countSaveIntegrity(settlement);
  return settlement;
};

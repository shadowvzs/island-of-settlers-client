import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { countSaveIntegrity } from "../../src/shared/settlement/settlement-save-integrity";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementPoint } from "../../src/shared/settlement/settlement-types";
import { huntingWorld } from "./hunting-world";

export const D6_CORRIDOR_START = 10_000_000;
const MILL = { x: 50.5, z: 20 } as const;

/**
 * The frozen D6 straight-corridor hotspot: one completed, paused Miller walking a long
 * multi-waypoint route to its workplace door, plus the headquarters. Every leg is a straight
 * corridor; the final approach enters the mill's 1.5-tile door clearance, which the guard must
 * leave to the exact tick. The island is roadless, fieldless, population-capped and has no other
 * live actor, so both movement-skip guards can prove it quiet. The save is produced by the real
 * simulation (no hand-edited state).
 */
export const d6CorridorHotspotSave = async () => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({
    world, roads, initialSettlers: 100, clockStart: D6_CORRIDOR_START
  });
  const placed = simulation.placeBuilding(31, MILL.x, MILL.z);
  if (!placed.ok) throw new Error(placed.reason);
  Object.assign(placed.building!, {
    construction: 1, foundationProgress: 1, input: { grain: 10 }, incoming: {}, output: {},
    productionPaused: true, required: {}
  });
  const settlement = simulation.saveState();
  const home = settlement.buildings.find(building => building.typeId === 0)!;
  const mill = settlement.buildings.find(building => building.uid === placed.building!.uid)!;
  if (!mill.access) throw new Error("The paused mill has no door access");
  const route: readonly SettlementPoint[] = [
    { x: 2.5, z: 30.5 }, { x: 22.5, z: 30.5 }, { x: 22.5, z: 2.5 },
    { x: 42.5, z: 2.5 }, { x: 42.5, z: mill.access.z },
    { x: mill.access.x, z: mill.access.z }
  ];
  settlement.actors = [{
    uid: 1, job: "Miller", home: home.uid, building: mill.uid,
    x: 2.5, y: 2, z: 2.5, yaw: 0, visible: true, action: "walk", ware: null,
    phase: "outbound", path: route.map(point => ({ ...point })),
    pathIndex: 0, timer: 0, animationTime: 0
  } satisfies SettlementActor];
  settlement.nextActor = 2;
  mill.worker = 1;
  settlement.integrity = countSaveIntegrity(settlement);
  return createGameSave(world, settlement, {
    animals: [], name: "D6 corridor hotspot", savedAt: D6_CORRIDOR_START, source: "generated"
  });
};

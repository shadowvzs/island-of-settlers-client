import { describe, expect, it } from "vitest";

import type { RoadDecorationItemId } from "../../island-of-settlers-shared/src/road-decoration-items";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { ownedDecorationFrames } from "../src/shared/settlement/map-scenery";
import { countOwnedPlacedRoadDecorations } from "../src/shared/settlement/road-decoration-owned";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { ScenarioDecoration } from "../src/shared/world/scenario-decorations";
import { huntingWorld } from "./helpers/hunting-world";

const ARCH = "roadDecoration:roman-rusticated-arch:marble" as RoadDecorationItemId;
const LANTERN = "roadDecoration:japanese-stone-lantern:granite" as RoadDecorationItemId;
const POT = "roadDecoration:indigenous-flower-pot:native" as RoadDecorationItemId;

const fixture = (decorations: ScenarioDecoration[] = [
  { item: ARCH, x: 24, yaw: 0, z: 18 }, { item: LANTERN, x: 22, yaw: 1, z: 22 }
]) => {
  const world = huntingWorld();
  world.scenario = { ...createMapScenario(), decorations, headquarters: { rotation: 0, x: 10, z: 10 } };
  let consumed = 0, received = 0;
  const simulation = createSettlementSimulation({ initialSettlers: 0, roads: createRoadNetwork(world), world,
    roadDecorationCustody: { consume: () => { consumed++; return true; }, receive: () => { received++; return true; } } });
  return { custody: () => ({ consumed, received }), simulation, world };
};

describe("map decorations as fixed scenery", () => {
  it("spawns the authored rows at the map start with negative (never selectable) uids", () => {
    const { custody, simulation } = fixture();
    const frames = simulation.roadDecorations();
    expect(frames.map(frame => [frame.uid, frame.item])).toEqual([[-1, ARCH], [-2, LANTERN]]);
    expect(custody()).toEqual({ consumed: 0, received: 0 });
    expect(simulation.saveState().roadDecorations).toBeUndefined();
  });

  it("maps a decoration's map-file id to its scenery uid, also after a save restore (ACT1)", () => {
    const { simulation } = fixture([{ id: 9, item: ARCH, x: 24, yaw: 0, z: 18 },
      { id: 4, item: LANTERN, x: 22, yaw: 1, z: 22 }]);
    expect(simulation.authoredObjectHandle(4)).toEqual({ space: "scenery", uid: -2 });
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    const restored = fixture([]).simulation;
    expect(restored.loadState(saved)).toEqual({ ok: true });
    expect(restored.authoredObjectHandle(9)).toEqual({ space: "scenery", uid: -1 });
    expect(restored.authoredObjectHandle(1)).toBeUndefined();
  });

  it("refuses pick-up, move and rotate; nothing reaches the inventory", () => {
    const { custody, simulation } = fixture();
    expect(simulation.pickUpRoadDecoration(-1)).toEqual({ ok: true, returned: 0 });
    expect(simulation.pickUpRoadDecoration(1)).toEqual({ ok: true, returned: 0 });
    expect(simulation.moveRoadDecoration(-1, { x: 40, z: 40 }, 0).ok).toBe(false);
    expect(simulation.rotateRoadDecoration(-2).ok).toBe(false);
    expect(simulation.pendingRoadDecorationReturns()).toEqual([]);
    expect(simulation.roadDecorations()).toHaveLength(2);
    expect(custody()).toEqual({ consumed: 0, received: 0 });
    expect(countOwnedPlacedRoadDecorations(ARCH, ownedDecorationFrames(simulation.roadDecorations()), [])).toBe(0);
  });

  it("occupies space for navigation, buildings and player decorations", () => {
    const { simulation } = fixture();
    const lantern = simulation.roadDecorations()[1]!;
    expect(simulation.isOccupied(lantern.position[0], lantern.position[2])).toBe(true);
    expect(simulation.isOccupied(45, 45)).toBe(false);
    expect(simulation.planRoadDecoration({ item: POT, position: { x: 22, z: 22 }, yaw: 0 }).ok).toBe(false);
    expect(simulation.planRoadDecoration({ item: POT, position: { x: 20, z: 14 }, yaw: 0 })).toMatchObject({ ok: true });
    const [width, depth] = getBuildingDefinition(1).gridFootprint;
    expect(simulation.validatePlacement(1, 22 + width % 2 / 2, 22 + depth % 2 / 2)).not.toBeNull();
    expect(simulation.validatePlacement(1, 16 + width % 2 / 2, 20 + depth % 2 / 2)).toBeNull();
  });

  it("round-trips the scenery snapshot through the island save, independent of the map", () => {
    const { simulation, world } = fixture();
    expect(simulation.placeRoadDecoration({ item: POT, position: { x: 20, z: 14 }, yaw: 0 }).ok).toBe(true);
    const saved = simulation.saveState();
    expect(saved.roadDecorationScenery).toEqual(world.scenario!.decorations);
    expect(saved.roadDecorations!.placed).toHaveLength(1);
    const before = simulation.roadDecorations();
    world.scenario = { ...world.scenario!, decorations: [] };
    expect(simulation.loadState(structuredClone(saved)).ok).toBe(true);
    expect(simulation.roadDecorations().map(frame => frame.uid)).toEqual(before.map(frame => frame.uid));
    expect(simulation.saveState().roadDecorationScenery).toEqual(saved.roadDecorationScenery);
  });

  it("keeps maps without decorations exactly as before", () => {
    const { simulation } = fixture([]);
    expect(simulation.roadDecorations()).toEqual([]);
    expect(simulation.saveState().roadDecorationScenery).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { createIslandStoneDeposits } from "../src/app/settlement/island-stone-deposits";
import { rememberIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { ROCK_ROLE, type RockInstance } from "../src/render-common/rocks/rock-instances";
import { STONE_SOURCE_REST_SECONDS } from "../src/shared/balance/resources";
import { canRespawnStoneAt, type StoneRespawnPlacementContext, validStoneRespawns } from "../src/shared/settlement/boulder-respawn";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { ResourceTarget } from "../src/shared/settlement/settlement-types";
import { BLOCKING } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const island = () => {
  const world = huntingWorld();
  for (let z = 0; z <= world.cellsZ; z++)
    for (let x = 40; x <= 46; x++) world.heights[z * (world.cellsX + 1) + x] = 2 + Math.min(8, (x - 39) ** 1.4);
  const rock: RockInstance = { axes: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], centre: [25, 3, 24],
    exposure: .5, family: 0, high: true, moss: 0, role: ROCK_ROLE.mass, slab: 1, tint: 0, variant: 0 };
  rememberIslandRocks(world, [rock]);
  return { rock, world };
};
const near = { x: 25, z: 24 };
const useUp = (stone: ReturnType<typeof createIslandStoneDeposits>, target: ResourceTarget) => {
  const quantity = stone.remaining(target);
  for (let cut = 0; cut < quantity; cut++) expect(stone.consume(target)).toBe(true);
  expect(stone.consume(target)).toBe(false);
  return quantity;
};

describe("island formations and mountain seams regenerate", () => {
  it("uses the extraction footprint for cached seam discovery and offline eligibility", () => {
    const { world } = island(), stone = createIslandStoneDeposits(world, () => {});
    const seam = stone.targets(near, 30).find(target => target.id <= -1_000_000)!;
    expect(seam).toBeDefined();
    expect(stone.canConsume(seam)).toBe(true);
    const before = stone.saveState();
    world.settlementGroundClearance = new Uint8Array(world.cellsX * world.cellsZ);
    // A .4 footprint misses this adjacent cell; the extraction footprint is .6.
    world.settlementGroundClearance[Math.floor(seam.z) * world.cellsX + Math.floor(seam.x) - 1] = 1;
    expect(stone.targets(near, 30).some(target => target.id === seam.id)).toBe(false);
    expect(stone.targets(near, 30, true).some(target => target.id === seam.id)).toBe(false);
    expect(stone.canConsume(seam, true)).toBe(false);
    expect(stone.consume(seam)).toBe(false);
    expect(stone.saveState()).toEqual(before);
  });

  it("preserves identity, original quantities and elapsed rest across save continuation", () => {
    const { world, rock } = island(), stone = createIslandStoneDeposits(world, () => {});
    const targets = stone.targets(near, 30);
    const formation = targets.find(target => target.id < 0 && target.id > -1_000_000)!;
    const seam = targets.find(target => target.id <= -1_000_000)!;
    const quantities = [useUp(stone, formation), useUp(stone, seam)];
    expect(stone.targets(near, 30, true).filter(target => target.id === formation.id || target.id === seam.id)).toHaveLength(2);
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), stoneSources: stone });
    expect(simulation.saveState().stoneRespawns).toEqual([
      { id: formation.id, kind: "island", restSeconds: 0 }, { id: seam.id, kind: "island", restSeconds: 0 }
    ]);
    simulation.eventStoneTick(123.5);
    const saved = structuredClone(simulation.saveState()), ledger = structuredClone(stone.saveState());
    const heights = world.heights.slice(), appearance = JSON.stringify(rock);
    const resumedStone = createIslandStoneDeposits(world, () => {}, ledger);
    const resumed = createSettlementSimulation({ world, roads: createRoadNetwork(world), stoneSources: resumedStone });
    expect(resumed.loadState(saved)).toEqual({ ok: true });
    expect(resumed.saveState().stoneRespawns).toEqual(saved.stoneRespawns);
    resumed.eventStoneTick(STONE_SOURCE_REST_SECONDS - 124);
    expect(resumedStone.exhausted()).toEqual([formation.id, seam.id]);
    resumed.eventStoneTick(.5);
    expect(resumed.saveState().stoneRespawns).toEqual([]);
    const again = resumedStone.targets(near, 30);
    expect(again.some(target => target.id === formation.id)).toBe(true);
    expect(again.some(target => target.id === seam.id)).toBe(true);
    expect([resumedStone.remaining(formation), resumedStone.remaining(seam)]).toEqual(quantities);
    simulation.eventStoneTick(STONE_SOURCE_REST_SECONDS - 123.5);
    expect(resumedStone.saveState()).toEqual(stone.saveState());
    expect(world.heights).toEqual(heights);
    expect(JSON.stringify(rock)).toBe(appearance);
    expect(useUp(resumedStone, formation)).toBe(quantities[0]);
    expect(useUp(resumedStone, seam)).toBe(quantities[1]);
    expect(resumed.saveState().stoneRespawns?.every(entry => entry.restSeconds === 0)).toBe(true);
  });

  it("exposes the unchanged native placement decision for detached source budgets", () => {
    const { world } = island(), stone = createIslandStoneDeposits(world, () => {});
    const seam = stone.targets(near, 30).find(target => target.id <= -1_000_000)!;
    useUp(stone, seam);
    const context: StoneRespawnPlacementContext = { options: { world, roads: createRoadNetwork(world), stoneSources: stone },
      occupied: Array(world.cellsX * world.cellsZ).fill(0), reservations: new Set(), buildings: [], actors: [],
      fieldCycles: { isOccupied: () => false } };
    const cell = Math.floor(seam.z) * world.cellsX + Math.floor(seam.x);
    const before = structuredClone(stone.saveState());
    expect(canRespawnStoneAt(context, "island", seam.id, seam)).toBe(true);
    expect(stone.saveState()).toEqual(before);
    context.actors = [{ visible: true, x: seam.x + .8, z: seam.z }];
    expect(canRespawnStoneAt(context, "island", seam.id, seam)).toBe(false);
    context.actors = [];
    context.buildings = [{ x: seam.x + 2.8, z: seam.z, width: 4, depth: 4 }];
    expect(canRespawnStoneAt(context, "island", seam.id, seam)).toBe(false);
    context.buildings = [];
    context.reservations = new Set([`field:${cell}`]);
    expect(canRespawnStoneAt(context, "island", seam.id, seam)).toBe(false);
    context.reservations = new Set();
    context.fieldCycles = { isOccupied: () => true };
    expect(canRespawnStoneAt(context, "island", seam.id, seam)).toBe(false);
    context.fieldCycles = undefined;
    world.blocking[cell] = BLOCKING.cliff;
    expect(canRespawnStoneAt(context, "island", seam.id, seam)).toBe(true);
    expect(canRespawnStoneAt(context, "prop", 0, seam)).toBe(false);
    expect(validStoneRespawns([{ id: seam.id, kind: "island", restSeconds: 12 }], world, 0)).toBe(true);
    expect(validStoneRespawns([{ id: 0, kind: "island", restSeconds: 12 }], world, 0)).toBe(false);
    expect(validStoneRespawns([{ id: seam.id, kind: "unknown", restSeconds: 12 }], world, 0)).toBe(false);
  });

  it("starts legacy exhausted sources at zero rest and waits behind clearance or a planted tree", () => {
    const { world } = island(), stone = createIslandStoneDeposits(world, () => {});
    const seam = stone.targets(near, 30).find(target => target.id <= -1_000_000)!;
    useUp(stone, seam);
    const legacy = createIslandStoneDeposits(world, () => {}, stone.saveState());
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), stoneSources: legacy });
    const cell = Math.floor(seam.z) * world.cellsX + Math.floor(seam.x);
    world.settlementGroundClearance = new Uint8Array(world.cellsX * world.cellsZ);
    world.settlementGroundClearance[cell] = 1;
    simulation.eventStoneTick(STONE_SOURCE_REST_SECONDS);
    expect(legacy.remaining(seam)).toBe(0);
    expect(world.settlementGroundClearance[cell]).toBe(1);
    world.settlementGroundClearance[cell] = 0;
    world.blocking[cell] = BLOCKING.prop;
    simulation.eventStoneTick(.5);
    expect(legacy.remaining(seam)).toBe(0);
    world.blocking[cell] = BLOCKING.cliff;
    simulation.eventStoneTick(.5);
    expect(legacy.remaining(seam)).toBe(12);
  });
});

import { describe, expect, it } from "vitest";

import { createIslandStoneDeposits } from "../src/app/settlement/island-stone-deposits";
import type { IslandStoneLedgerState } from "../src/app/settlement/island-stone-ledger";
import { type OfflineEconomyJob,runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { prepareOfflineEconomySources } from "../src/app/settlement/offline-economy-sources";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = (remaining = 2, rest = 0) => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads });
  const save = { settlement: simulation.saveState(), runtime: {
    stone: { formations: [], props: [[0, remaining]], seams: [], nextId: -1 }
  } } as unknown as GameSaveV1;
  const quarry = { ...save.settlement.buildings[0]!, uid: 1, typeId: 19, x: 20, z: 20,
    width: 2, depth: 2, access: { x: 20, z: 22 }, worker: 101, construction: 1 };
  save.settlement.buildings.push(quarry);
  world.props.count = 1; world.props.types[0] = remaining ? PROP.largeRock : PROP_REMOVED;
  world.props.x[0] = 24; world.props.z[0] = 20; world.props.y[0] = 2; world.props.scale[0] = 1;
  if (!remaining) save.settlement.stoneRespawns = [{ kind: "prop", id: 0, restSeconds: rest }];
  const mining: OfflineEconomyJob = { uid: "building:1", islandId: "home", cycleTicks: 1000,
    inputs: { "~source:1": 1 }, outputs: { stone: 1 } };
  const prepare = (horizon: number, worker = mining) => {
    const source = prepareOfflineEconomySources(save, world, [worker], horizon / 1000);
    const result = runOfflineEconomyEvents({ horizonTicks: horizon,
      jobs: [worker, ...source.jobs].map(job => ({ ...job, endTick: horizon })),
      islands: [{ islandId: "home", stock: source.stock, capacities: source.capacities, workCapacity: 1 }],
      onCompleted: source.onCompleted });
    const ledger = result.islands[0]!;
    // Match the driver: cancelled unfinished work returns inputs to their same owner.
    for (const work of result.inProgress) for (const [key, units] of Object.entries(work.inputs)) {
      ledger.stock[key] = (ledger.stock[key] ?? 0) + units;
      ledger.consumed[key] = (ledger.consumed[key] ?? 0) - units;
    }
    return { source, result, ledger, commit: () => source.apply(ledger.consumed, ledger.stock, ledger.produced) };
  };
  return { world, save, quarry, mining, prepare };
};

describe("offline quarry identity and regeneration", () => {
  it("starts rest at completed extraction, including shared transport delay", () => {
    const f = fixture(1);
    const worker = { ...f.mining, workTicks: 10_000 };
    const run = f.prepare(310_999, worker);
    expect(run.ledger.produced.stone).toBe(1);
    expect(run.ledger.produced["~quarry:available:0"] ?? 0).toBe(0);
    run.commit();
    expect(f.save.settlement.stoneRespawns).toEqual([{ kind: "prop", id: 0, restSeconds: 299.999 }]);
  });

  it("resumes a saved rest once and persists the next partial generation", () => {
    const f = fixture(0, 250), run = f.prepare(55_000);
    expect(run.ledger.produced["~quarry:available:0"]).toBe(6);
    expect(run.ledger.produced.stone).toBe(5);
    run.commit();
    expect(f.world.props.types[0]).toBe(PROP.largeRock);
    expect(f.save.runtime).toMatchObject({ stone: { props: [[0, 1]] } });
    expect(f.save.settlement.stoneRespawns).toEqual([]);
  });

  it("keeps the residual timer across a second offline checkpoint", () => {
    const f = fixture(1), first = f.prepare(101_000);
    first.commit();
    expect(f.save.settlement.stoneRespawns?.[0]?.restSeconds).toBe(100);
    const second = f.prepare(200_000, structuredClone(f.mining));
    expect(second.ledger.produced.stone ?? 0).toBe(0);
    second.commit();
    expect(f.world.props.types[0]).toBe(PROP.largeRock);
    const stone = createIslandStoneDeposits(f.world, () => {}, (f.save.runtime as { stone: IslandStoneLedgerState }).stone);
    expect(stone.remaining({ id: 0, kind: "stone", x: 24, z: 20 })).toBe(6);
  });

  it("conserves source ownership across two overlapping quarries", () => {
    const f = fixture(2);
    f.save.settlement.buildings.push({ ...f.quarry, uid: 2, x: 21 });
    const other = { ...f.mining, uid: "building:2", inputs: { "~source:2": 1 } };
    const sources = prepareOfflineEconomySources(f.save, f.world, [f.mining, other], 2);
    const result = runOfflineEconomyEvents({ horizonTicks: 2000, jobs: [f.mining, other],
      islands: [{ islandId: "home", stock: sources.stock, capacities: sources.capacities }],
      onCompleted: sources.onCompleted });
    expect(result.islands[0]!.produced.stone).toBe(2);
    sources.apply(result.islands[0]!.consumed, result.islands[0]!.stock, result.islands[0]!.produced);
    expect(f.save.runtime).toMatchObject({ stone: { props: [[0, 0]] } });
  });

  it("rejects a source debit missing its identity before changing the boulder", () => {
    const f = fixture(2), sources = prepareOfflineEconomySources(f.save, f.world, [f.mining], 2);
    expect(() => sources.apply({ "~source:1": 2 })).toThrow("aggregate balance");
    expect(f.world.props.types[0]).toBe(PROP.largeRock);
    expect(f.save.runtime).toMatchObject({ stone: { props: [[0, 2]] } });
  });

  it("withholds unsupported runtime and blocked respawns", () => {
    const f = fixture(0, 300);
    f.save.settlement.reservations.push(`plant:${20 * f.world.cellsX + 24}`);
    const blocked = f.prepare(400_000);
    expect(blocked.ledger.produced.stone ?? 0).toBe(0);
    blocked.commit();
    expect(f.world.props.types[0]).toBe(PROP_REMOVED);
    f.save.runtime = undefined;
    const unsupported = f.prepare(400_000, { ...f.mining, inputs: { "~source:1": 1 } });
    expect(unsupported.ledger.produced.stone ?? 0).toBe(0);
  });

  it("renews a selected mountain seam using its actual saved rest", () => {
    const f = fixture();
    f.world.props.count = 0;
    for (let z = 0; z <= f.world.cellsZ; z++) for (let x = 40; x <= 46; x++)
      f.world.heights[z * (f.world.cellsX + 1) + x] = 2 + Math.min(8, (x - 39) ** 1.4);
    const stone = createIslandStoneDeposits(f.world, () => {});
    const target = stone.targets(f.quarry.access, 27).filter(target => target.id <= -1_000_000)
      .sort((a, b) => Math.hypot(a.x - f.quarry.access.x, a.z - f.quarry.access.z) -
        Math.hypot(b.x - f.quarry.access.x, b.z - f.quarry.access.z))[0]!;
    expect(target).toBeDefined();
    f.save.runtime = { stone: { formations: [], props: [], seams: [[target.id, 0]], nextId: -1 } };
    f.save.settlement.stoneRespawns = [{ id: target.id, kind: "island", restSeconds: 299 }];
    f.save.settlement.stoneAreas = [[1, { minX: Math.floor(target.x), maxX: Math.floor(target.x),
      minZ: Math.floor(target.z), maxZ: Math.floor(target.z) }]];
    const run = f.prepare(3000);
    expect(run.ledger.produced.stone, JSON.stringify({ target, stock: run.source.stock, jobs: run.source.jobs })).toBe(2);
    run.commit();
    expect(f.save.runtime).toMatchObject({ stone: { seams: [[target.id, 10]] } });
    expect(f.save.settlement.stoneRespawns).toEqual([]);
  });
});

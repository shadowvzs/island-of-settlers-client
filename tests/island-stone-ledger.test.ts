import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { createIslandStoneDeposits } from "../src/app/settlement/island-stone-deposits";
import { validIslandStoneLedger } from "../src/app/settlement/island-stone-ledger";
import { createOfflineIslandRuntime } from "../src/app/settlement/offline-island-runtime";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { rememberIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { ROCK_ROLE, type RockInstance } from "../src/render-common/rocks/rock-instances";
import { STONE_SOURCE_REST_SECONDS } from "../src/shared/balance/resources";
import { createGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { ResourceTarget } from "../src/shared/settlement/settlement-types";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { removePropsAt } from "../src/shared/world/editing/prop-removal";
import { PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const QUARRY = 19;
const NEAR = { x: 17, z: 20 };

const formation = (x: number, z: number): RockInstance => ({
  axes: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], centre: [x, 3, z], exposure: .5, family: 0, high: true,
  moss: 0, role: ROCK_ROLE.mass, slab: 1, tint: 0, variant: 0
});

/** A flat island with a mountain foot, one quarry boulder and two visible formations. */
const ledgerIsland = () => {
  const world = huntingWorld();
  world.heights.fill(2);
  for (let z = 0; z <= world.cellsZ; z++)
    for (let x = 40; x <= 46; x++) world.heights[z * (world.cellsX + 1) + x] = 2 + Math.min(8, (x - 39) ** 1.4);
  const boulder = placeProp(world, { kind: PROP.largeRock, seed: 7, x: 14.5, z: 20.5 });
  if (typeof boulder !== "number") throw new Error(`boulder refused: ${boulder}`);
  const rocks = [formation(22, 20), formation(22, 28)];
  rememberIslandRocks(world, rocks);
  return { boulder, rocks, world };
};

const drain = (consume: () => boolean) => {
  let count = 0;
  while (consume()) count++;
  return count;
};
const findTarget = (targets: ResourceTarget[], test: (target: ResourceTarget) => boolean) => {
  const target = targets.find(test);
  expect(target).toBeDefined();
  return target!;
};

describe("island stone ledger", () => {
  it("keeps partly worked boulders, formations and seams after a save and reload", () => {
    const { boulder, rocks, world } = ledgerIsland();
    const deposits = createIslandStoneDeposits(world, () => {});
    const targets = deposits.targets(NEAR, 40);
    const prop = findTarget(targets, target => target.id === boulder);
    const rock = findTarget(targets, target => target.id < 0 && target.id > -1_000_000 && target.z < 24);
    const seam = findTarget(targets, target => target.id <= -1_000_000);
    for (let cut = 0; cut < 2; cut++) expect(deposits.consume(prop)).toBe(true);
    for (let cut = 0; cut < 3; cut++) expect(deposits.consume(rock)).toBe(true);
    for (let cut = 0; cut < 4; cut++) expect(deposits.consume(seam)).toBe(true);
    const saved = JSON.parse(JSON.stringify(deposits.saveState()));
    expect(validIslandStoneLedger(saved, world.props.count)).toBe(true);
    expect(saved.props).toEqual([[boulder, 4]]);
    expect(saved.seams).toEqual([[seam.id, 8]]);

    // The rocks come back in another order; every formation keeps its id and amount.
    rememberIslandRocks(world, [...rocks].reverse());
    const reloaded = createIslandStoneDeposits(world, () => {}, saved);
    const again = reloaded.targets(NEAR, 40);
    const ids = (list: ResourceTarget[]) => list.map(target => target.id).sort((a, b) => a - b);
    expect(ids(again)).toEqual(ids(targets));
    expect(reloaded.saveState()).toEqual(saved);
    expect(drain(() => reloaded.consume(prop))).toBe(4);
    expect(drain(() => reloaded.consume(seam))).toBe(8);
    expect(drain(() => reloaded.consume(rock))).toBe(drain(() => deposits.consume(rock)));
  });

  it("rejects corrupt saved quarry amounts", () => {
    const valid = { formations: [[-1, 2, 3, 4]], nextId: -2, props: [[0, 3]], seams: [[-1_000_005, 2]] };
    expect(validIslandStoneLedger(valid, 1)).toBe(true);
    expect(validIslandStoneLedger({ ...valid, props: [[1, 3]] }, 1)).toBe(false);
    expect(validIslandStoneLedger({ ...valid, seams: [[-5, 2]] }, 1)).toBe(false);
    expect(validIslandStoneLedger({ ...valid, formations: [[-1, 2, 3, -1]] }, 1)).toBe(false);
    expect(validIslandStoneLedger({ ...valid, nextId: 0 }, 1)).toBe(false);
  });

  it("a worked out boulder keeps its respawn timer through a reload and returns full", () => {
    const { boulder, world } = ledgerIsland();
    const respawned: number[] = [];
    const quarryIsland = (ledger?: ReturnType<ReturnType<typeof createIslandStoneDeposits>["saveState"]>) => {
      const deposits = createIslandStoneDeposits(world, id => removePropsAt(world, [id]), ledger);
      const simulation = createSettlementSimulation({
        canWorkerEnterPlot: () => true, initialSettlers: 12, initialStock: { ...STARTER_STOCK },
        roads: createRoadNetwork(world), world,
        consumeResource: target => target.kind === "stone" ? deposits.consume(target) : undefined,
        onBoulderRespawned: prop => { deposits.refillProp(prop); respawned.push(prop); },
        resourceTargets: (kind, near, range) => kind === "stone" ? deposits.targets(near, range) : undefined
      });
      return { deposits, simulation };
    };
    const first = quarryIsland();
    const [width, depth] = getBuildingDefinition(QUARRY).gridFootprint;
    const placed = first.simulation.placeBuilding(QUARRY, 8 + width % 2 / 2, 22 + depth % 2 / 2);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
    const { access } = placed.building!;
    expect(first.simulation.connectRoads(first.simulation.headquarters.access, access)).toBe(true);
    const isGone = () => world.props.types[boulder] === PROP_REMOVED;
    for (let step = 0; step < 900 * 20 && !isGone(); step++) first.simulation.update(.05);
    expect(isGone()).toBe(true);
    for (let second = 0; second < STONE_SOURCE_REST_SECONDS / 2; second++) first.simulation.update(1);

    const savedSettlement = structuredClone(first.simulation.saveState());
    const savedLedger = JSON.parse(JSON.stringify(first.deposits.saveState()));
    expect(savedLedger.props).toEqual([[boulder, 0]]);
    const second = quarryIsland(savedLedger);
    expect(second.simulation.loadState(savedSettlement)).toEqual({ ok: true });
    expect(second.simulation.saveState().stoneRespawns).toEqual(savedSettlement.stoneRespawns);
    for (let rest = 0; rest < STONE_SOURCE_REST_SECONDS / 2 + 5 && isGone(); rest++) second.simulation.update(1);
    expect(isGone()).toBe(false);
    expect(respawned).toEqual([boulder]);
    // The returned boulder is fresh: six cuts again.
    const target = { id: boulder, kind: "stone" as const, x: world.props.x[boulder]!, z: world.props.z[boulder]! };
    expect(drain(() => second.deposits.consume(target))).toBe(6);
  });

  it("offline catch-up keeps the quarry ledger", async () => {
    const { boulder, world } = ledgerIsland();
    const save = (target: WorldData, runtime?: unknown) => {
      const simulation = createSettlementSimulation({ roads: createRoadNetwork(target), world: target });
      return createGameSave(target, simulation.saveState(), {
        animals: [], name: "Ledger island", savedAt: 10_000_000, source: "generated" }, runtime);
    };
    const first = createOfflineIslandRuntime(await stageGameSession(structuredClone(await save(world))));
    const target = { id: boulder, kind: "stone" as const, x: world.props.x[boulder]!, z: world.props.z[boulder]! };
    for (let cut = 0; cut < 2; cut++) expect(first.hooks.consumeResource!(target)).toBe(true);
    first.jumpTo(1);
    const runtime = first.save();
    expect(runtime.stone.props).toEqual([[boulder, 4]]);

    const loaded = await stageGameSession(structuredClone(await save(world, runtime)));
    const resumed = createOfflineIslandRuntime(loaded);
    resumed.jumpTo(1);
    expect(resumed.save().stone).toEqual(runtime.stone);
    const world2 = loaded.map.world;
    const again = { ...target, x: world2.props.x[boulder]!, z: world2.props.z[boulder]! };
    expect(drain(() => resumed.hooks.consumeResource!(again) === true)).toBe(4);
  });
});

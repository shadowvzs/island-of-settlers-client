import { describe, expect, it } from "vitest";

import type { SaveSnapshot } from "../src/app/save-store/save-api-client";
import { decodePlausibilityResources } from "../src/app/settlement/plausibility-resources";
import { checkPlausibility } from "../src/app/settlement/server-bundle";
import { COLONY_ORE_SHIP_MS } from "../src/shared/balance/colonies";
import { createGameSave } from "../src/shared/settlement/game-save";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { BLOCKING, ORE, PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD);

const settlement = (world: WorldData, buildings: SettlementBuilding[] = []) => ({
  format: "island-settlers-settlement",
  version: 1,
  world: { seed: world.seed, cellsX: world.cellsX, cellsZ: world.cellsZ },
  buildings
}) as unknown as SettlementSaveV1;

const save = (world: WorldData, savedAt: number, buildings: SettlementBuilding[] = [], runtime?: unknown) =>
  createGameSave(world, settlement(world, buildings),
    { animals: [], name: "Plausibility fixture", savedAt, source: "test" }, runtime);

const snapshot = (islands: [key: string, game: Awaited<ReturnType<typeof save>>][],
  colonies: SaveSnapshot["colonies"] = []): SaveSnapshot => ({
  adventures: [],
  colonies,
  evacuations: [],
  islands: islands.map(([key, game]) => ({
    key: key as SaveSnapshot["islands"][number]["key"],
    save: { data: game as unknown as Record<string, unknown>, metadata: { savedAt: game.savedAt }, schemaVersion: 1 }
  })),
  player: {},
  session: { active: null, savedAt: islands[0]![1].savedAt }
});

const building = (typeId: number, inventory: Record<string, number> = {}): SettlementBuilding =>
  ({ construction: 1, inventory, typeId } as SettlementBuilding);

describe("map-derived plausibility resources (D4)", () => {
  it("counts one log per removed tree by species and keeps stable prop ids", async () => {
    const beforeWorld = cachedWorld(SMALL_EDITOR_WORLD);
    const tree = beforeWorld.props.types.findIndex(type => type !== PROP_REMOVED);
    expect(tree).toBeGreaterThanOrEqual(0);
    beforeWorld.props.types[tree] = PROP.broadleafTree;
    const afterWorld = structuredClone(beforeWorld);
    afterWorld.props.types[tree] = PROP_REMOVED;
    const delta = await decodePlausibilityResources(
      snapshot([["home", await save(beforeWorld, 0)]]),
      snapshot([["home", await save(afterWorld, 1000)]]), 1);
    expect(delta?.felledTrees).toMatchObject({ cedarLogs: 0, hardwoodLogs: 0, logs: 1, walnutLogs: 0 });
  });

  it("counts ore only from surveyed mine zones", async () => {
    const beforeWorld = cachedWorld(SMALL_EDITOR_WORLD);
    const zoneId = Math.max(0, ...beforeWorld.mineZones.map(zone => zone.id)) + 1;
    const cell = beforeWorld.mineZone.findIndex((id, index) =>
      id === 0 && beforeWorld.blocking[index] === BLOCKING.free);
    expect(cell).toBeGreaterThanOrEqual(0);
    beforeWorld.mineZone[cell] = zoneId;
    beforeWorld.oreAmount[cell] = 10;
    beforeWorld.mineZones.push({
      cellCount: 1, centreX: cell % beforeWorld.cellsX + .5,
      centreZ: Math.floor(cell / beforeWorld.cellsX) + .5,
      id: zoneId, ore: ORE.coal, richness: 1, surveyed: true
    });
    const afterWorld = structuredClone(beforeWorld);
    afterWorld.oreAmount[cell] = 7;
    const surveyed = await decodePlausibilityResources(
      snapshot([["home", await save(beforeWorld, 0)]]),
      snapshot([["home", await save(afterWorld, 1000)]]), 1);
    expect(surveyed?.minedOre.coal).toBe(3);

    beforeWorld.mineZones.at(-1)!.surveyed = false;
    afterWorld.mineZones.at(-1)!.surveyed = false;
    const unsurveyed = await decodePlausibilityResources(
      snapshot([["home", await save(beforeWorld, 0)]]),
      snapshot([["home", await save(afterWorld, 1000)]]), 1);
    expect(unsurveyed?.minedOre.coal).toBe(0);
  });

  it("allows the hourly ore a colony's completed mines can ship", async () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const home = await save(world, 0);
    const colony = await save(world, 0, [building(11), building(12)]);
    const colonyAt = (nextOreShipAt?: number) => [{
      data: { expeditionId: 1, island: { ore: "coal", resourceTier: 1 }, nextOreShipAt, status: "conquered" },
      expeditionId: 1
    }];
    const immediate = await decodePlausibilityResources(
      snapshot([["home", home], ["colony-1", colony]], colonyAt()),
      snapshot([["home", home], ["colony-1", colony]], colonyAt()), 0);
    // Two mines x 60 ore per mine-hour x the one-hour ship-interval buffer.
    expect(immediate?.colonyShipments?.coal).toBe(120);
    const backlog = await decodePlausibilityResources(
      snapshot([["home", home], ["colony-1", colony]], colonyAt(0)),
      snapshot([["home", home], ["colony-1", colony]], colonyAt(2 * COLONY_ORE_SHIP_MS)), 0);
    // The ship clock advanced two hours while the colony was off screen.
    expect(backlog?.colonyShipments?.coal).toBe(240);
  });

  it("bounds stone by an actually cut quarry boulder", async () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD), id = world.props.types.findIndex(type => type !== PROP_REMOVED);
    expect(id).toBeGreaterThanOrEqual(0);
    world.props.types[id] = PROP.largeRock;
    const runtime = (remaining: number) => ({ stone: { formations: [], nextId: -1,
      props: remaining < 6 ? [[id, remaining]] : [], seams: [] } });
    const before = snapshot([["home", await save(world, 0, [building(0, {})], runtime(6))]]);
    const afterWorld = structuredClone(world);
    const after = snapshot([["home", await save(afterWorld, 60_000, [building(0, { stone: 100 })], runtime(5))]]);
    const delta = await decodePlausibilityResources(before, after, 60);
    expect(delta?.stoneSources?.stone ?? 0).toBeGreaterThanOrEqual(1);
    const checked = await checkPlausibility({ after, before, credits: {}, realSeconds: 60 });
    expect(checked.violations.map(violation => violation.ware)).toContain("stone");
  });

  it("allows one full source cycle after the respawn interval", async () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD), id = world.props.types.findIndex(type => type !== PROP_REMOVED);
    world.props.types[id] = PROP_REMOVED;
    const afterWorld = structuredClone(world);
    afterWorld.props.types[id] = PROP.largeRock;
    const ledger = (props: [number, number][]) => ({ stone: { formations: [], nextId: -1, props, seams: [] } });
    const before = snapshot([["home", await save(world, 0, [], ledger([[id, 0]]))]]);
    const after = snapshot([["home", await save(afterWorld, 300_000, [], ledger([]))]]);
    const delta = await decodePlausibilityResources(before, after, 300);
    expect(delta?.stoneSources?.stone ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("skips only the map checks when a stored map cannot be decoded", async () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const broken = snapshot([["home", await save(world, 0)]]);
    broken.islands[0]!.save.data = { format: "island-settlers-game", version: 1 } as never;
    await expect(decodePlausibilityResources(broken, broken, 1)).resolves.toBeNull();
  });

  it("runs the map bounds inside the async server-bundle check", async () => {
    const beforeWorld = cachedWorld(SMALL_EDITOR_WORLD);
    const trees: number[] = [];
    for (let id = 0; id < beforeWorld.props.count && trees.length < 100; id++)
      if (beforeWorld.props.types[id] !== PROP_REMOVED) trees.push(id);
    for (const id of trees) beforeWorld.props.types[id] = PROP.broadleafTree;
    const buildings = [building(0, { logs: 0 }), building(17)];
    const before = snapshot([["home", await save(beforeWorld, 0, buildings)]]);
    const afterWith = async (removed: number, logs: number) => {
      const afterWorld = structuredClone(beforeWorld);
      for (const id of trees.slice(0, removed)) afterWorld.props.types[id] = PROP_REMOVED;
      return snapshot([["home", await save(afterWorld, 3_600_000, [building(0, { logs }), building(17)])]]);
    };
    const hour = { credits: {}, realSeconds: 3600 };
    expect((await checkPlausibility({ ...hour, after: await afterWith(1, 100), before })).violations
      .map(violation => violation.ware)).toEqual(["logs"]);
    expect((await checkPlausibility({ ...hour, after: await afterWith(100, 100), before })).violations).toEqual([]);
  });
});

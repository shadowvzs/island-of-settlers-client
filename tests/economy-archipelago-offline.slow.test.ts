import { expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import type { OfflineIslandMetrics } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame, chronologyPolicy } from "../src/app/settlement/offline-progress";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { MATERIAL_BUILDING_GROUPS } from "../src/shared/settlement/advanced-material-production";
import { travelTo } from "../src/shared/settlement/archipelago";
import { COLONY_FOODS } from "../src/shared/settlement/colony-economy";
import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { economyColonyFixture } from "./helpers/economy-colony-fixture";
import { exportEconomySaveFixture } from "./helpers/economy-save-fixtures";
import { huntingWorld } from "./helpers/hunting-world";

const START = 1_000_000;
const homeSave = async () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 8,
    initialStock: { logs: 4, saw: 1, planks: 20, stone: 20 } });
  const [width, depth] = getBuildingDefinition(33).gridFootprint;
  const placed = simulation.placeBuilding(33, 20 + width / 2, 18 + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  return createGameSave(world, simulation.saveState(), {
    name: "Finite home", source: "generated", savedAt: START, animals: []
  });
};

const states = (save: GameSaveV1) => [save.settlement,
  ...(save.archipelago?.home ? [save.archipelago.home.settlement] : []),
  ...save.archipelago?.colonies.flatMap(record => record.save ? [record.save.settlement] : []) ?? []];
// Shared storage stock lives in the storage pools since 6443243c5; a saved storage `inventory` keeps
// only local equipment, so the pools are counted once each.
const goods = (state: SettlementSaveV1, ware: string) =>
  state.storagePools.pools.reduce((sum, pool) => sum + (pool.available[ware] ?? 0), 0) +
  state.buildings.reduce((sum, building) => sum + (building.input[ware] ?? 0) +
    (building.output[ware] ?? 0) + (building.inventory[ware] ?? 0), 0) +
  state.actors.reduce((sum, actor) => sum + (actor.ware === ware ? actor.wareUnits ?? 1 : 0) +
    // Paid input receipts remain until rest after the product is carried; count that matter once.
    (!actor.ware && actor.productionOutput ? actor.consumed?.[ware] ?? 0 : 0), 0) +
  state.naval.fleet.ships.reduce((sum, ship) => sum + (ship.cargo?.[ware] ?? 0), 0);
const peopleMinusBirths = (state: SettlementSaveV1) => state.settlers - state.settlerBirths +
  state.actors.filter(actor => actor.phase !== "retired" && actor.job !== "Mount" &&
    !(state.military?.soldiers.find(soldier => soldier.actor === actor.uid)?.combat?.faction ?? 0)).length;
const stateSummary = (save: GameSaveV1) => states(save).map(state => ({
  people: peopleMinusBirths(state),
  logs: goods(state, "logs"), planks: goods(state, "planks"),
  stone: goods(state, "stone"), food: COLONY_FOODS.reduce((sum, ware) => sum + goods(state, ware), 0)
}));

/** A small three-island group: home on file, one colony active and one colony archived. */
const multiIslandSource = async () => {
  const source = await homeSave();
  const colonies = [];
  for (const [index, group] of [MATERIAL_BUILDING_GROUPS[0]!, MATERIAL_BUILDING_GROUPS[1]!].entries()) {
    const { simulation, world } = economyColonyFixture(group);
    const colony = await createGameSave(world, simulation.saveState(), {
      name: `Parity colony ${index + 1}`, source: "generated", savedAt: START, animals: []
    });
    const setup = simulation.colony()!;
    colonies.push({ conqueredAt: START, expeditionId: 7 + index, island: setup.island,
      nextOreShipAt: START + 7_200_000, save: colony, status: "conquered" as const });
  }
  return travelTo({ active: null, colonies, version: 1 }, source, 8) as GameSaveV1;
};

/** A home save with one archived conquered colony filed at START (first material tier). */
const homeWithArchivedColony = async (name: string) => {
  const source = await homeSave();
  const { simulation, world } = economyColonyFixture(MATERIAL_BUILDING_GROUPS[0]!);
  const colony = await createGameSave(world, simulation.saveState(), {
    name, source: "generated", savedAt: START, animals: []
  });
  const setup = simulation.colony()!;
  source.archipelago = { active: null, version: 1, colonies: [{ expeditionId: 7,
    island: setup.island, status: "conquered", conqueredAt: START,
    nextOreShipAt: START + 3_600_000, save: colony }] };
  return source;
};

/** Every saved island of a result, including the one on screen. */
const islandSaves = (save: GameSaveV1): GameSaveV1[] => [
  save,
  ...(save.archipelago?.home ? [save.archipelago.home] : []),
  ...(save.archipelago?.colonies.flatMap(record => record.save ? [record.save] : []) ?? []),
  ...(save.archipelago?.adventures?.flatMap(record => record.save ? [record.save] : []) ?? [])
];

/** E1 value state of every island and of the shared player, order-independent. */
const e1Summary = (save: GameSaveV1) => ({
  islands: islandSaves(save).map(island => valueStateKey({
    runtime: island.runtime, settlement: island.settlement
  })).sort(),
  player: valueStateKey(save.player)
});

/** E2 state hashes of every island after a normal stage, order-independent. */
const e2Summary = async (save: GameSaveV1) => {
  const hashes: string[] = [];
  for (const island of islandSaves(save)) {
    const loaded = await stageGameSession(structuredClone(island));
    hashes.push(hashSettlementState({
      runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world
    }));
  }
  return hashes.sort();
};

it("picks chronology by lane and honours the sequential opt-out", () => {
  const group = { active: null, colonies: [], version: 1 as const };
  const single = {} as GameSaveV1;
  const multiple = { archipelago: group } as unknown as GameSaveV1;
  expect(chronologyPolicy(single, { exact: true })).toBe("sequential");
  expect(chronologyPolicy(multiple, {})).toBe("coordinated");
  expect(chronologyPolicy(multiple, { measured: true })).toBe("sequential");
  expect(chronologyPolicy(multiple, { analytic: true })).toBe("sequential");
  expect(chronologyPolicy(multiple, { exact: true, chronological: false })).toBe("sequential");
  for (const lane of [{ measured: true, chronological: true }, { exact: true }, { eventCore: true },
    { corridorReservations: true }, { eventMovement: true }, { quietSkip: true },
    { movementSkip: true }, { chronological: true }])
    expect(chronologyPolicy(multiple, lane)).toBe("coordinated");
});

it.each(MATERIAL_BUILDING_GROUPS)("continues finite home plus archived $logs colony through offline/reload/travel", async group => {
  const source = await homeSave();
  const { simulation, world } = economyColonyFixture(group);
  const colony = await createGameSave(world, simulation.saveState(), {
    name: `Finite ${group.logs} colony`, source: "generated", savedAt: START, animals: []
  });
  const setup = simulation.colony()!;
  source.archipelago = { active: null, version: 1, colonies: [{ expeditionId: 7,
    island: setup.island, status: "conquered", conqueredAt: START,
    nextOreShipAt: START + 3_600_000, save: colony }] };
  await expect(stageGameSession(source)).resolves.toBeDefined();
  await exportEconomySaveFixture(`tier${group.tier}-initial`, source);
  const first = await advanceOfflineGame(source, START + 300_000);
  const persisted = JSON.parse(JSON.stringify(first)) as GameSaveV1;
  await expect(stageGameSession(persisted)).resolves.toBeDefined();
  // Visit the saved colony before the next interval: the same worlds now reverse active/archive roles.
  const visited = travelTo(persisted.archipelago!, persisted, 7) as GameSaveV1;
  expect(visited.format).toBe("island-settlers-game");
  const second = await advanceOfflineGame(visited, START + 600_000);
  await expect(stageGameSession(second)).resolves.toBeDefined();
  await exportEconomySaveFixture(`tier${group.tier}-active-final`, second);
  expect(second.archipelago!.active).toBe(7);
  expect(second.archipelago!.home!.savedAt).toBe(START + 600_000);
  const all = states(second);
  expect(all).toHaveLength(2);
  // Finite goods are conserved across both islands. The totals come from the source: with shared
  // storage pools counted (6443243c5) the home's 4 logs + 20 planks join the colony's 40 planks.
  const total = (list: SettlementSaveV1[], count: (state: SettlementSaveV1) => number) =>
    list.reduce((sum, state) => sum + count(state), 0);
  const initial = states(source);
  for (const count of [(state: SettlementSaveV1) => goods(state, "logs") + goods(state, "planks"),
    (state: SettlementSaveV1) => goods(state, group.logs) + goods(state, group.planks),
    (state: SettlementSaveV1) => goods(state, group.stone)])
    expect(total(all, count)).toBe(total(initial, count));
  expect(total(initial, state => goods(state, "logs") + goods(state, "planks"))).toBe(4 + 20 + 40);
  expect(total(all, peopleMinusBirths)).toBe(20);
  const returned = travelTo(second.archipelago!, second, null) as GameSaveV1;
  await expect(stageGameSession(returned)).resolves.toBeDefined();
  expect(returned.archipelago!.active).toBeNull();
  expect(returned.archipelago!.home).toBeUndefined();
  expect(returned.archipelago!.colonies[0]!.save!.savedAt).toBe(START + 600_000);
  expect(await advanceOfflineGame(returned, returned.savedAt)).toBe(returned);
}, 30000);

it("coordinates exact-family multi-island replays by default and reports the policy", async () => {
  const source = await homeWithArchivedColony("Chronology colony");
  const metrics: OfflineIslandMetrics[] = [];
  // Owner 2026-11-04 (041bde88c): every positive gap uses the fast offline economy by default, so
  // the native replay's default chronology is reached with `economy: false`.
  const result = await advanceOfflineGame(source, START + 60_000, () => {}, {
    economy: false, onIslandMetrics: value => metrics.push(value)
  });
  expect(result.savedAt).toBe(START + 60_000);
  expect(result.archipelago!.colonies[0]!.save!.savedAt).toBe(START + 60_000);
  expect(metrics.length).toBeGreaterThan(0);
  expect(metrics.every(value => value.chronology === "coordinated" &&
    value.chronologySliceSeconds === 1 && value.mode === "exact" &&
    value.fallbackReason === undefined)).toBe(true);
  const sequentialMetrics: OfflineIslandMetrics[] = [];
  const sequential = await advanceOfflineGame(structuredClone(source), START + 60_000, () => {}, {
    exact: true, chronological: false, onIslandMetrics: value => sequentialMetrics.push(value)
  });
  expect(sequentialMetrics.length).toBeGreaterThan(0);
  expect(sequentialMetrics.every(value => value.chronology === "sequential" &&
    value.chronologySliceSeconds === undefined)).toBe(true);
  expect(stateSummary(result)).toEqual(stateSummary(sequential));
  expect(result.player).toEqual(sequential.player);
  await expect(stageGameSession(result)).resolves.toBeDefined();

  const fallbackMetrics: OfflineIslandMetrics[] = [];
  await advanceOfflineGame(structuredClone(source), START + 60_000, () => {}, {
    measured: true, chronological: true, onIslandMetrics: value => fallbackMetrics.push(value)
  });
  expect(fallbackMetrics.length).toBeGreaterThan(0);
  expect(fallbackMetrics.every(value => value.chronology === "coordinated" &&
    value.requestedMode === "measured" && value.mode === "exact" &&
    value.fallbackReason === "chronology-exact")).toBe(true);
}, 30000);

it("keeps the coordinated event-core lane equal to its sequential order", async () => {
  const source = await homeWithArchivedColony("Event-core chronology colony");
  const coordinated = await advanceOfflineGame(structuredClone(source), START + 60_000, () => {},
    { eventCore: true });
  const sequential = await advanceOfflineGame(structuredClone(source), START + 60_000, () => {},
    { eventCore: true, chronological: false });
  expect(stateSummary(coordinated)).toEqual(stateSummary(sequential));
  expect(e1Summary(coordinated)).toEqual(e1Summary(sequential));
}, 30000);

// The 1 h row runs two exact 1 h replays of a two-island group: the three-island case's 120 s budget.
it.each([
  { seconds: 60_000, sliceSeconds: 1 },
  { seconds: 60_000, sliceSeconds: 5 },
  { seconds: 300_000, sliceSeconds: 60 },
  { seconds: 3_600_000, sliceSeconds: 60 }
])("chronological and exact sequential replays agree at $seconds ms with $sliceSeconds-second slices", async ({ seconds, sliceSeconds }) => {
  const source = await homeWithArchivedColony("Parity colony");
  const sequential = await advanceOfflineGame(structuredClone(source), START + seconds, () => {},
    { exact: true, eventCore: false, chronological: false });
  const chronological = await advanceOfflineGame(structuredClone(source), START + seconds, () => {}, {
    exact: true, eventCore: false, chronological: true, chronologySliceSeconds: sliceSeconds
  });
  expect(stateSummary(chronological)).toEqual(stateSummary(sequential));
  expect(e1Summary(chronological)).toEqual(e1Summary(sequential));
  expect(chronological.player!).toEqual(sequential.player!);
  await expect(stageGameSession(chronological)).resolves.toBeDefined();
}, 120_000);

it("keeps the three-island 1 h exact result, player and resume equal to the sequential order", async () => {
  const source = await multiIslandSource();
  const sequential = await advanceOfflineGame(structuredClone(source), START + 3_600_000, () => {},
    { exact: true, chronological: false });
  const coordinated = await advanceOfflineGame(structuredClone(source), START + 3_600_000, () => {}, {
    exact: true
  });
  expect(stateSummary(coordinated)).toEqual(stateSummary(sequential));
  expect(e1Summary(coordinated)).toEqual(e1Summary(sequential));
  expect(await e2Summary(coordinated)).toEqual(await e2Summary(sequential));
  expect(coordinated.player).toEqual(sequential.player);

  const resumeAt = START + 3_660_000;
  const resumed = (save: GameSaveV1) => advanceOfflineGame(structuredClone(save), resumeAt, () => {},
    { exact: true, chronological: false });
  const resumedSequential = await resumed(sequential), resumedCoordinated = await resumed(coordinated);
  expect(e1Summary(resumedCoordinated)).toEqual(e1Summary(resumedSequential));
  expect(resumedCoordinated.player).toEqual(resumedSequential.player);
  await expect(stageGameSession(resumedCoordinated)).resolves.toBeDefined();
}, 120_000);

it.each(MATERIAL_BUILDING_GROUPS)("sustains $logs nursery/growth/felling/sawmill cycles through real offline resource controllers", async group => {
  const { simulation, world } = economyColonyFixture(group, true);
  const source = await createGameSave(world, simulation.saveState(), {
    name: `Renewable ${group.logs} chain`, source: "generated", savedAt: START, animals: []
  });
  // The real resource controllers run in the native replay; the default became the fast offline
  // economy (owner 2026-11-04, 041bde88c), so the native lane is requested explicitly.
  const first = await advanceOfflineGame(source, START + 450_000, () => {}, { economy: false });
  const result = await advanceOfflineGame(JSON.parse(JSON.stringify(first)), START + 900_000, () => {},
    { economy: false });
  const loaded = await stageGameSession(result);
  await exportEconomySaveFixture(`tier${group.tier}-sustained-final`, result);
  const produced = goods(result.settlement, group.logs) + goods(result.settlement, group.planks);
  expect(produced).toBeGreaterThan(1);
  const cutTrees = result.settlement.resourceAmounts.filter(([key, remaining]) =>
    key.startsWith("tree:") && remaining === 0).length;
  const resources = new Map(result.settlement.resourceAmounts);
  const unfinishedCuts = result.settlement.actors.filter(actor => actor.job === "Woodcutter" &&
    actor.target?.kind === "tree" && !actor.ware && resources.get(`tree:${actor.target.id}`) === 0).length;
  expect(produced + unfinishedCuts).toBe(cutTrees);
  expect(loaded.map.world.props.count).toBeGreaterThan(1);
  for (let id = 1; id < loaded.map.world.props.count; id++)
    expect([PROP[group.tree], PROP_REMOVED]).toContain(loaded.map.world.props.types[id]);
  for (const other of MATERIAL_BUILDING_GROUPS.filter(candidate => candidate.tier !== group.tier))
    expect(goods(result.settlement, other.logs) + goods(result.settlement, other.planks)).toBe(0);
  expect(peopleMinusBirths(result.settlement)).toBe(12);
}, 30000);

// Review R3 (C2a): every filed island replays from its own savedAt. The island just left was filed
// at the switch, so the catch-up on arrival must not replay the time the player spent on it live.
const LIVE_MS = 600_000;
it.each([
  ["fast economy", {}],
  ["exact sequential", { exact: true, eventCore: false, chronological: false }],
  ["exact coordinated", { exact: true, eventCore: false }]
] as const)("replays 0 s for the island just left after a switch (%s)", async (_lane, options) => {
  const source = await homeWithArchivedColony("Switch colony");
  const group = source.archipelago!;
  // The home was played live for LIVE_MS after the colony was filed; the player now sails there.
  const leftHome = { ...source, archipelago: undefined, savedAt: START + LIVE_MS };
  const arrived = travelTo(group, leftHome, 7) as GameSaveV1;
  expect(arrived.savedAt).toBe(START);
  const result = await advanceOfflineGame(arrived, START + LIVE_MS, () => {}, options);
  const home = result.archipelago!.home!;
  expect(home.settlement.gameTick ?? 0).toBe(leftHome.settlement.gameTick ?? 0);
  expect((result.settlement.gameTick ?? 0) - (arrived.settlement.gameTick ?? 0)).toBe(LIVE_MS / 50);
  expect(result.savedAt).toBe(START + LIVE_MS);
  await expect(stageGameSession(result)).resolves.toBeDefined();
}, 60_000);

// The mirror case on a reload: the home on screen was saved after live play, while the colony stayed
// filed since START. The colony replays its whole own window, not only the home's shorter gap.
it.each([
  ["fast economy", {}],
  ["exact sequential", { exact: true, eventCore: false, chronological: false }],
  ["exact coordinated", { exact: true, eventCore: false }]
] as const)("replays an older filed island from its own save time (%s)", async (_lane, options) => {
  const source = await homeWithArchivedColony("Reload colony");
  const reloaded = { ...source, savedAt: START + LIVE_MS };
  const result = await advanceOfflineGame(reloaded, START + 2 * LIVE_MS, () => {}, options);
  const colony = result.archipelago!.colonies[0]!.save!;
  const filed = source.archipelago!.colonies[0]!.save!;
  expect((colony.settlement.gameTick ?? 0) - (filed.settlement.gameTick ?? 0)).toBe(2 * LIVE_MS / 50);
  expect((result.settlement.gameTick ?? 0) - (source.settlement.gameTick ?? 0)).toBe(LIVE_MS / 50);
  expect(colony.savedAt).toBe(START + 2 * LIVE_MS);
}, 60_000);

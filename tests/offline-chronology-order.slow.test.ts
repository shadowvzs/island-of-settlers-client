import { expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { createOfflineIslandSession } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { MATERIAL_BUILDING_GROUPS } from "../src/shared/settlement/advanced-material-production";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { economyColonyFixture } from "./helpers/economy-colony-fixture";
import { huntingWorld } from "./helpers/hunting-world";

const START = 1_000_000;

/**
 * Free wares in the island's storages (headquarters, warehouses, colony harbour). Storage stock
 * lives in the shared storage pools since 6443243c5; storage `inventory` stays empty.
 */
const stored = (state: SettlementSaveV1, ware: string) =>
  state.storagePools.pools.reduce((sum, pool) => sum + (pool.available[ware] ?? 0), 0);

/**
 * A small home with one log and a sawmill. The carpenter's first finished plank reaches the
 * headquarters storage at about 89 s (measured on this fixture with the exact replay), which is
 * after the colony's first supply request at 60 s.
 */
const producingHome = async () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  // The Roman nation profile (6443243c5) adds one plank to every construction cost, so the
  // sawmill now needs 3 planks; the starter planks/stone are zeroed again below.
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 8,
    initialStock: { logs: 1, saw: 1, planks: 3, stone: 2 } });
  const [width, depth] = getBuildingDefinition(33).gridFootprint;
  const placed = simulation.placeBuilding(33, 13 + width / 2, 16 + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  // Construction needed starter planks/stone; the replay itself starts with none in storage.
  for (const building of simulation.buildings())
    for (const ware of ["planks", "stone"]) building.inventory[ware] = 0;
  return createGameSave(world, simulation.saveState(), {
    name: "Late-producing home", source: "generated", savedAt: START, animals: []
  });
};

/** A conquered colony with no planks or stone, so its first supply requests are non-empty. */
const demandingColony = async () => {
  const { simulation, world } = economyColonyFixture(MATERIAL_BUILDING_GROUPS[0]!);
  for (const building of simulation.buildings())
    for (const ware of ["planks", "stone"]) building.inventory[ware] = 0;
  const colony = await createGameSave(world, simulation.saveState(), {
    name: "Demanding colony", source: "generated", savedAt: START, animals: []
  });
  const setup = simulation.colony()!;
  return { colony, island: setup.island };
};

const sourceWithColony = async () => {
  const source = await producingHome();
  const { colony, island } = await demandingColony();
  source.archipelago = { active: null, version: 1, colonies: [{ expeditionId: 7,
    island, status: "conquered", conqueredAt: START, nextOreShipAt: START + 3_600_000, save: colony }] };
  return source;
};

const run = (source: GameSaveV1, seconds: number, sliceSeconds: number) =>
  advanceOfflineGame(structuredClone(source), START + seconds * 1000, () => {},
    { exact: true, chronological: true, chronologySliceSeconds: sliceSeconds });

const inTransit = (state: SettlementSaveV1) =>
  state.naval.fleet.ships.reduce((sum, ship) => sum + (ship.cargo?.planks ?? 0), 0);
const plankCounts = (result: GameSaveV1) => {
  const colony = result.archipelago!.colonies[0]!.save!;
  return { colony: stored(colony.settlement, "planks"), home: stored(result.settlement, "planks"),
    transit: inTransit(colony.settlement) + inTransit(result.settlement) };
};

/**
 * The previous coordinator order: the home advanced through the whole slice, then the colony did.
 * This is a control that reproduces the bug; it is not the reference for the fixed order.
 */
const homeFirstControl = async (source: GameSaveV1, seconds: number) => {
  const group = structuredClone(source.archipelago!);
  const home = await createOfflineIslandSession(source, {
    archipelago: group, chronology: "coordinated", chronologySliceSeconds: seconds,
    enemyCampsBlockJumps: false, exactBudgetSeconds: 1800, islandId: null, mode: "exact",
    now: START + seconds * 1000, report: () => {}, requestedMode: "exact", seconds, start: START
  });
  const colony = await createOfflineIslandSession(group.colonies[0]!.save!, {
    archipelago: group, chronology: "coordinated", chronologySliceSeconds: seconds,
    enemyCampsBlockJumps: false, exactBudgetSeconds: 1800, islandId: 7,
    liveHomeBuildings: () => home.simulation.buildings(),
    liveHomeSettlement: () => home.simulation.saveState(),
    mode: "exact", now: START + seconds * 1000, report: () => {}, requestedMode: "exact",
    seconds, start: START
  });
  await home.advance(seconds);
  await colony.advance(seconds);
  return { colony: (await colony.save(START + seconds * 1000)).settlement,
    home: (await home.save(START + seconds * 1000)).settlement };
};

it("a colony never observes home planks produced later in the same slice", async () => {
  const source = await sourceWithColony();
  // The adversarial slice contains both the 60 s supply request and the ~89 s home delivery.
  const sliceSeconds = 100;
  const at100 = plankCounts(await run(source, 100, sliceSeconds));
  expect(at100).toEqual({ colony: 0, home: 1, transit: 0 });
  // The next supply request sees the plank that was already committed at the end of the slice.
  const at125 = plankCounts(await run(source, 125, sliceSeconds));
  expect(at125.home).toBe(0);
  expect(at100.home + at100.colony + at100.transit).toBe(1);
  expect(at125.home + at125.colony + at125.transit).toBe(1);

  // Independent event-ordered reference: one tick per slice. It also withholds the 89 s plank from
  // the 60 s request, so the 100 s and 125 s outcomes are not an artefact of the 100 s slice.
  const tick100 = plankCounts(await run(source, 100, 0.05));
  const tick125 = plankCounts(await run(source, 125, 0.05));
  expect(tick100).toEqual(at100);
  expect(tick125).toEqual(at125);

  // The result still stages and keeps its save format.
  const result = await run(source, 125, sliceSeconds);
  expect(result.format).toBe("island-settlers-game");
  // Save format v4 since 564004349 (S04 packed fog, sight bitset, sparse occupancy).
  expect(result.version).toBe(4);
  expect(result.savedAt).toBe(START + 125_000);
  await expect(stageGameSession(result)).resolves.toBeDefined();
});

it("demonstrates the old home-first order on the same adversarial fixture", async () => {
  const source = await sourceWithColony();
  const control = await homeFirstControl(source, 100);
  expect(stored(control.colony, "planks")).toBe(1);
  expect(stored(control.home, "planks")).toBe(0);
  expect(inTransit(control.colony)).toBe(0);
  // The fixture is closed: the same single plank exists either way.
  expect(stored(control.home, "planks") + stored(control.colony, "planks") +
    inTransit(control.colony)).toBe(1);
});

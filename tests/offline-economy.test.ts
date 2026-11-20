import { beforeAll, describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import {
  applyOfflineEconomyStock, type OfflineEconomyMetrics, offlineEconomyStorage, pruneStaleStockTraffic
} from "../src/app/settlement/offline-economy";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { OFFLINE_CATCH_UP_CAP_SECONDS } from "../src/shared/balance/offline";
import { POPULATION_GROWTH_SECONDS } from "../src/shared/balance/population";
import { travelTo } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { isActiveResidence, validResidenceTimer } from "../src/shared/settlement/residences";
import type { Goods } from "../src/shared/settlement/settlement-types";
import { colonyDrawSource, lateStockSave, populationBoundarySave } from "./helpers/offline-measured-islands";

const exact = { exact: true, eventCore: false };
const economy = { economy: true, economyCalibrationSeconds: 0 };
let home: GameSaveV1, group: GameSaveV1;
const goods = (save: GameSaveV1) => {
  const total: Goods = {};
  const add = (stock: Readonly<Goods>) => {
    for (const [ware, count] of Object.entries(stock)) total[ware] = (total[ware] ?? 0) + count;
  };
  for (const pool of save.settlement.storagePools.pools) add(pool.available);
  for (const building of save.settlement.buildings) {
    add(building.inventory); add(building.input); add(building.output);
  }
  for (const actor of save.settlement.actors) {
    if (actor.ware) add({ [actor.ware]: actor.wareUnits ?? 1 });
    else if (actor.productionOutput) add(actor.consumed ?? {});
    if (actor.handcart?.trip?.ware && actor.handcart.cargo)
      add({ [actor.handcart.trip.ware]: actor.handcart.cargo });
  }
  for (const ship of save.settlement.naval.fleet.ships) add(ship.cargo ?? {});
  return total;
};
const islands = (save: GameSaveV1) => {
  const rows = new Map<string, GameSaveV1>([[save.archipelago?.active === null || !save.archipelago ? "home"
    : String(save.archipelago.active), save]]);
  if (save.archipelago?.home) rows.set("home", save.archipelago.home);
  for (const colony of save.archipelago?.colonies ?? [])
    if (colony.save && colony.expeditionId !== save.archipelago?.active) rows.set(String(colony.expeditionId), colony.save);
  return rows;
};
const run = async (source: GameSaveV1, seconds = 3600) => {
  let metrics: OfflineEconomyMetrics | undefined;
  const save = await advanceOfflineGame(source, source.savedAt + seconds * 1000, () => {}, {
    ...economy, onEconomyMetrics: report => { metrics = report; }
  });
  return { save, metrics: metrics! };
};
beforeAll(async () => {
  const initialHome = await lateStockSave(), initialGroup = await colonyDrawSource();
  home = await advanceOfflineGame(initialHome, initialHome.savedAt + 120_000, () => {}, exact);
  group = await advanceOfflineGame(initialGroup, initialGroup.savedAt + 120_000, () => {}, exact);
}, 25_000);

describe("offline economy save integration", () => {
  it.each([1, 60, 180, 1800])("uses zero-prefix fast startup automatically at %s seconds", async seconds => {
    const now = home.savedAt + seconds * 1000, collected: OfflineEconomyMetrics[] = [];
    const native: unknown[] = [];
    const automatic = await advanceOfflineGame(home, now, () => {}, {
      onEconomyMetrics: metrics => collected.push(metrics), onIslandMetrics: metrics => native.push(metrics)
    });
    const forced = await advanceOfflineGame(home, now, () => {}, { economy: true });
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ mode: "economy", gameSeconds: seconds, calibrationSeconds: 0 });
    expect(native).toHaveLength(0);
    expect(automatic).toEqual(forced);
    await expect(stageGameSession(automatic)).resolves.toBeDefined();
  }, 25_000);
  it("conserves each island's goods including completed transfers", async () => {
    const before = islands(group), { metrics, save } = await run(group);
    const after = islands(save);
    expect(metrics.islands).toBe(2);
    for (const ledger of metrics.production) {
      const old = goods(before.get(ledger.islandId)!), current = goods(after.get(ledger.islandId)!);
      const wares = new Set([...Object.keys(old), ...Object.keys(current), ...Object.keys(ledger.produced),
        ...Object.keys(ledger.consumed), ...Object.keys(ledger.sent), ...Object.keys(ledger.received)]);
      for (const ware of wares) if (!ware.startsWith("~")) {
        expect((current[ware] ?? 0) - (old[ware] ?? 0), `${ledger.islandId}:${ware}`).toBe(
          (ledger.produced[ware] ?? 0) - (ledger.consumed[ware] ?? 0) +
          (ledger.received[ware] ?? 0) - (ledger.sent[ware] ?? 0));
      }
    }
    const sent: Goods = {}, received: Goods = {};
    for (const ledger of metrics.production) {
      for (const [ware, count] of Object.entries(ledger.sent)) sent[ware] = (sent[ware] ?? 0) + count;
      for (const [ware, count] of Object.entries(ledger.received)) received[ware] = (received[ware] ?? 0) + count;
    }
    for (const ware of new Set([...Object.keys(sent), ...Object.keys(received)]))
      expect(sent[ware] ?? 0, ware).toBe(received[ware] ?? 0);
    expect(Object.values(sent).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    for (const island of after.values()) await expect(stageGameSession(island)).resolves.toBeDefined();
  }, 25_000);

  it("retains original work and releases only completed cartless delivery ownership", async () => {
    const { save } = await run(home);
    const completed = home.settlement.actors.filter(actor => actor.delivery &&
      !save.settlement.actors.find(next => next.uid === actor.uid)!.delivery);
    expect(completed.length).toBeGreaterThan(0);
    for (const actor of home.settlement.actors) {
      const next = save.settlement.actors.find(next => next.uid === actor.uid)!;
      if (!completed.includes(actor)) expect(next).toEqual(actor);
      else {
        expect(actor.job).toBe("Carrier");
        expect(next).toMatchObject({ phase: "inside", visible: false, ware: null, path: [], home: actor.home });
        expect(next.workerMovementPlan).toBeUndefined();
        expect(next.workerHandlingPlan).toBeUndefined();
      }
    }
    expect(save.settlement.naval).toEqual(home.settlement.naval);
    for (const building of home.settlement.buildings) {
      const next = save.settlement.buildings.find(candidate => candidate.uid === building.uid)!;
      for (const [ware, count] of Object.entries(building.input)) expect(next.input[ware] ?? 0).toBeGreaterThanOrEqual(count);
      expect(next.shipReserve).toEqual(building.shipReserve);
      for (const ware of new Set([...Object.keys(building.incoming), ...Object.keys(next.incoming)])) {
        const delivered = completed.filter(actor => actor.delivery!.destination === building.uid && actor.delivery!.ware === ware).length;
        expect(next.incoming[ware] ?? 0).toBe((building.incoming[ware] ?? 0) - delivered);
      }
    }
  });

  it("keeps reserved ship goods out of the freely available ledger", () => {
    const save = structuredClone(home), store = save.settlement.buildings.find(building => building.typeId === 0)!;
    const pool = save.settlement.storagePools.pools.find(entry => entry.id === store.storagePoolId)!;
    pool.available.logs = 15; store.shipReserve = { logs: 10 };
    const before = offlineEconomyStorage(save).stock;
    expect(before.logs).toBe(15);
    applyOfflineEconomyStock(save, before, { ...before, logs: 0 });
    expect(pool.available.logs).toBe(0);
    expect(store.shipReserve.logs).toBe(10);
    expect(() => applyOfflineEconomyStock(save, { logs: 1 }, { logs: 0 })).toThrow("unavailable logs");
  });

  it("caps production at24h while advancing the saved clock to real now", async () => {
    const atCap = await run(home, OFFLINE_CATCH_UP_CAP_SECONDS);
    const beyond = await run(home, OFFLINE_CATCH_UP_CAP_SECONDS + 12 * 3600);
    expect(beyond.metrics.gameSeconds).toBe(OFFLINE_CATCH_UP_CAP_SECONDS);
    expect(beyond.metrics.production).toEqual(atCap.metrics.production);
    expect(goods(beyond.save)).toEqual(goods(atCap.save));
    expect(beyond.save.savedAt).toBe(home.savedAt + 36 * 3600_000);
  }, 25_000);

  it("keeps population timers valid through a long recovery", async () => {
    const initial = await populationBoundarySave();
    const { save } = await run(initial, OFFLINE_CATCH_UP_CAP_SECONDS);
    expect(save.settlement.settlerGrowthTime).toBeGreaterThanOrEqual(0);
    expect(save.settlement.settlerGrowthTime).toBeLessThan(POPULATION_GROWTH_SECONDS);
    for (const building of save.settlement.buildings.filter(isActiveResidence))
      expect(validResidenceTimer(building)).toBe(true);
    await expect(stageGameSession(save)).resolves.toBeDefined();
  }, 25_000);

  it("does not defer the next ore ship twice beyond the production cap", async () => {
    const { save } = await run(group, 36 * 3600);
    expect(save.archipelago!.colonies[0]!.nextOreShipAt).toBe(save.savedAt + 3600_000);
  }, 25_000);

  it("keeps unvisited residence clocks below their interval when the last birth fills capacity", async () => {
    const initial = await populationBoundarySave();
    initial.settlement.settlers = 179;
    initial.settlement.buildings.find(building => building.typeId === 0)!.idleSettlers = 179;
    initial.settlement.settlerGrowthTime = 59;
    initial.settlement.buildings.find(building => building.typeId === 57)!.settlerGrowthTime = 299;
    const { save } = await run(initial, 1);
    expect(save.settlement.settlers).toBe(180);
    expect(save.settlement.buildings.find(building => building.typeId === 57)!.settlerGrowthTime).toBe(299);
    await expect(stageGameSession(save)).resolves.toBeDefined();
  });

  it("recovers while a colony is active and allows a validated return home", async () => {
    const active = travelTo(structuredClone(group.archipelago!), structuredClone(group), 7)!;
    if (active.format !== "island-settlers-game") throw new Error("Fixture colony has no filed save");
    const { save } = await run(active);
    expect(save.archipelago?.active).toBe(7);
    const returned = travelTo(save.archipelago!, save, null)!;
    if (returned.format !== "island-settlers-game") throw new Error("Recovered group lost its home save");
    expect(returned.archipelago?.active).toBeNull();
    expect(returned.archipelago?.home).toBeUndefined();
    for (const island of islands(returned).values()) await expect(stageGameSession(island)).resolves.toBeDefined();
  }, 25_000);

  it("leaves the original input immutable and does not replay a committed interval", async () => {
    const encoded = JSON.stringify(group), { save } = await run(group);
    expect(JSON.stringify(group)).toBe(encoded);
    expect(await advanceOfflineGame(save, save.savedAt, () => {}, economy)).toBe(save);
    expect(await advanceOfflineGame(save, save.savedAt - 1000, () => {}, economy)).toBe(save);
  });

  it("keeps exact replay unchanged when production observers are attached", async () => {
    const produced: Goods = {}, cycles: Goods = {};
    let waited = 0;
    const observed = await advanceOfflineGame(home, home.savedAt + 60_000, () => {}, {
      ...exact, onProduced: (_island, ware) => { produced[ware] = (produced[ware] ?? 0) + 1; },
      onProductionCycle: (_island, _building, _inputs, output) => {
        if (output) cycles[output] = (cycles[output] ?? 0) + 1;
      },
      onProductionWait: (_island, _building, seconds, _tick, reason) => {
        expect(["inputs", "output"]).toContain(reason);
        expect(seconds).toBeGreaterThan(0);
        waited += seconds;
      }
    });
    const reference = await advanceOfflineGame(home, home.savedAt + 60_000, () => {}, exact);
    expect(observed).toEqual(reference);
    expect(Object.keys(produced).length).toBeGreaterThan(0);
    expect(Object.keys(cycles).length).toBeGreaterThan(0);
    expect(Object.values(produced).every(value => value > 0)).toBe(true);
    expect(Object.values(cycles).every(value => value > 0)).toBe(true);
    expect(waited).toBeGreaterThan(0);
  }, 25_000);

  it("drops stock-court receipts when the fast model changes an actor's phase", () => {
    const save = {
      settlement: {
        actors: [{ uid: 1, phase: "inside" }],
        buildings: [{ uid: 2 }],
        stockTraffic: {
          clock: 5,
          owners: [{ building: 2, actor: 1 }],
          actors: [{ actor: 1, phase: "pickup" }]
        }
      }
    } as unknown as GameSaveV1;
    pruneStaleStockTraffic(save, new Map([[1, "pickup"]]));
    expect(save.settlement.stockTraffic).toEqual({ clock: 5, owners: [], actors: [] });
  });
});

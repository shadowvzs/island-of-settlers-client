import type { WorkerNation } from "../../render-common/workers/worker-nation";
import { CARRIER_WALK_SPEED } from "../../shared/balance/economy";
import { DMath } from "../../shared/math/deterministic-math";
import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { effectiveProductionSeconds } from "../../shared/settlement/production-timing";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { savedOccupancy } from "../../shared/settlement/save-cell-codecs";
import type { NavalShip } from "../../shared/settlement/settlement-naval-fleet";
import type { ShipWorkpoint } from "../../shared/settlement/settlement-ship-workpoint";
import { findShipyardWorkSite } from "../../shared/settlement/settlement-shipyard-placement";
import type {
  Goods, SettlementBuilding, SettlementContext, SettlementPoint
} from "../../shared/settlement/settlement-types";
import { seaShipReady,SHIPYARD_RECIPES } from "../../shared/settlement/shipyard-recipes";
import { workshopCycleFactor } from "../../shared/settlement/workshop-upgrades";
import type { WorldData } from "../../shared/world/world-data";
import type {
  OfflineEconomyEventsResult, OfflineEconomyIsland, OfflineEconomyJob
} from "./offline-economy-events";
import {
  OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS, offlineProductionTalentBonus,
  offlineStockTripSeconds
} from "./offline-economy-rates";

type State = GameSaveV1["settlement"];
type Material = "cloth" | "planks";
interface SavedSite {
  cloth: number; id: number; land: SettlementPoint; steps: number; water: SettlementPoint;
  work?: ShipWorkpoint; yard: number; yaw?: number;
}
interface FastNaval {
  active: [number, SavedSite][];
  fleet: { nextShip: number; ships: NavalShip[] };
  modes: [number, string][];
  nextSite: number;
  sites: [number, SavedSite][];
}
interface Hull {
  initialCloth: number; initialSteps: number;
  items: Material[]; launchUid: string; newSite: boolean; site: SavedSite;
  visitTicks: number[]; visitUids: string[];
}
interface Yard {
  accountId: string; building: SettlementBuilding; hulls: Hull[]; preloaded: Goods;
}
export interface OfflineEconomyFastShipPrepare {
  apply: (result: OfflineEconomyEventsResult, horizonTicks: number) => void;
  built: () => number;
  handled: number[];
  internal: { accountId: string; islandId: string }[];
  islands: OfflineEconomyIsland[];
  jobs: OfflineEconomyJob[];
  notes: string[];
  unsupported: { reason: string; uid: number }[];
}
const own = (goods: Readonly<Record<string, number>>, ware: string) =>
  Object.hasOwn(goods, ware) ? goods[ware]! : 0;
const distance = (from: SettlementPoint, to: SettlementPoint) => DMath.hypot(to.x - from.x, to.z - from.z);
const siteAccount = (uid: number) => `~ship-site:${uid}`;
const stageToken = (uid: number, stage: number) => `~ship:${uid}:stage:${stage}`;
const workerToken = (uid: number) => `~ship:${uid}:worker`;
/** The remaining canonical material visits, including saved partial hull/cloth receipts. */
export const remainingShipMaterials = (steps: number, cloth: number): Material[] => {
  const planks = Math.max(0, SHIPYARD_RECIPES.ships.planks - steps);
  const cloths = Math.max(0, SHIPYARD_RECIPES.ships.cloth - cloth);
  const items: Material[] = [];
  if (steps < 8) for (let index = 0; index < Math.min(8 - steps, planks); index++) items.push("planks");
  for (let index = 0; index < cloths; index++) items.push("cloth");
  const late = Math.max(0, planks - Math.min(8, Math.max(0, 8 - steps)));
  for (let index = 0; index < late; index++) items.push("planks");
  return items;
};
const shipVisitTicks = (building: SettlementBuilding, site: SavedSite, material: Material,
  talentBonus: number, nation?: WorkerNation) => {
  const factor = workshopCycleFactor(building, talentBonus);
  const work = effectiveProductionSeconds(3.5, building.typeId, "planks") / factor;
  const stock = offlineStockTripSeconds(building, "input", material, nation);
  const siteTrip = 2 * distance(building.access, site.land) / .9;
  return Math.max(1, Math.ceil((work + stock + siteTrip + 1) * TPS));
};
const navalState = (state: State) => state.naval as unknown as FastNaval;
const findSite = (save: GameSaveV1, world: WorldData, building: SettlementBuilding,
  reserved: ReadonlySet<string>, continueSaved = true): { newSite: boolean; site: SavedSite } | undefined => {
  const state = save.settlement, naval = navalState(state);
  const saved = naval.sites.find(entry => entry[0] === building.uid)?.[1];
  if (saved && continueSaved)
    return { newSite: false, site: { ...saved, cloth: saved.cloth ?? 0, steps: saved.steps ?? 0 } };
  const roads = createRoadNetwork(world);
  if (!roads.replaceSegments(state.roads)) return undefined;
  const context = { options: { roads, world }, buildings: state.buildings,
    occupied: savedOccupancy(state).slice(), playerNation: state.playerNation, reservations: new Set(state.reservations)
  } as unknown as SettlementContext;
  const found = findShipyardWorkSite(context, building, reserved);
  if (!found) return undefined;
  const site: SavedSite = { ...found, cloth: 0, id: naval.nextSite, steps: 0, yard: building.uid };
  return { newSite: true, site };
};
const createShip = (state: State, world: WorldData, site: SavedSite) => {
  const naval = navalState(state);
  const yaw = site.yaw ?? DMath.atan2(site.water.x - site.land.x, site.water.z - site.land.z) + Math.PI / 2;
  const ship: NavalShip = { id: naval.fleet.nextShip++, x: site.water.x, y: world.seaLevel,
    z: site.water.z, yaw, phase: "idle", cargoCount: 0, cargo: {}, route: [], cursor: 0, timer: 0 };
  naval.fleet.ships.push(ship);
  naval.sites = naval.sites.filter(entry => entry[0] !== site.yard);
};
/** Fast carrier delivery from connected storage to the yard's private materials receipt. */
const deliveryTiming = (save: GameSaveV1, world: WorldData, building: SettlementBuilding) => {
  const state = save.settlement, roads = createRoadNetwork(world);
  if (!roads.replaceSegments(state.roads)) return undefined;
  const speed = CARRIER_WALK_SPEED * (1 + talentModifiers(save.player?.talents).carrierSpeed);
  const trip = state.buildings.filter(entry => entry.construction === 1 && !entry.militaryFaction &&
    STORAGE_IDS.has(entry.typeId)).flatMap(storage => {
    const route = roads.routeMetrics(storage.access, building.access).route;
    if (!route) return [];
    const legs = distance(storage.access, storage.workerApproach) +
      distance(storage.workerApproach, storage.doorThreshold);
    return [{ route: route.cost, legs }];
  }).sort((a, b) => a.route - b.route)[0];
  if (!trip) return undefined;
  const oneWay = (trip.route + trip.legs) / speed + 1;
  return { cycleTicks: Math.max(1, Math.ceil((oneWay + 1) * TPS)),
    workTicks: Math.max(1, Math.ceil((2 * oneWay + 2) * TPS)) };
};

/**
 * Fast sea-ship construction for a Ships-mode yard. Building.input is moved into a finite internal
 * site account, missing materials are carried from connected storage, and one job per material visit
 * is serialized by the shipwright token. A short horizon keeps every completed visit on the saved
 * site and returns unused materials to the yard; only a completed launch job creates one fleet ship.
 */
export const prepareOfflineEconomyFastShips = (
  save: GameSaveV1, world: WorldData, seconds: number, islandId: string
): OfflineEconomyFastShipPrepare => {
  const state = save.settlement, naval = navalState(state), modes = new Map(naval.modes);
  const jobs: OfflineEconomyJob[] = [], handled: number[] = [], notes: string[] = [],
    unsupported: { reason: string; uid: number }[] = [], yards: Yard[] = [],
    islands: OfflineEconomyIsland[] = [], internal: { accountId: string; islandId: string }[] = [];
  const talents = talentModifiers(save.player?.talents);
  const colony = state.buildings.some(building => building.typeId === 39 && !building.militaryFaction);
  const activeYards = new Set((naval.active ?? []).map(([, site]) => site.yard));
  const hasCarrier = state.actors.some(actor => actor.job === "Carrier") || state.settlers > 0;
  const reserved = new Set(naval.sites.map(([, site]) => `${site.water.x},${site.water.z}`));
  for (const ship of naval.fleet.ships)
    reserved.add(`${Math.floor(ship.x) + .5},${Math.floor(ship.z) + .5}`);
  const firstSites = new Map<number, NonNullable<ReturnType<typeof findSite>>>();
  // Give every working yard its first legal site before allocating speculative later hulls.
  // A long horizon at the first yard must not reserve another yard's only launch cell.
  for (const building of state.buildings) {
    if (building.typeId !== 36 || modes.get(building.uid) !== "ships" || activeYards.has(building.uid) ||
      building.construction !== 1 || building.militaryFaction || building.productionPaused ||
      building.worker === undefined) continue;
    const site = findSite(save, world, building, reserved);
    if (!site) continue;
    firstSites.set(building.uid, site);
    reserved.add(`${site.site.water.x},${site.site.water.z}`);
  }
  const endTick = Math.floor(seconds * TPS);
  let built = 0;
  for (const building of state.buildings) {
    if (building.typeId !== 36 || modes.get(building.uid) !== "ships") continue;
    if (activeYards.has(building.uid)) {
      unsupported.push({ uid: building.uid,
        reason: "saved shipwright work retains its native site; fast construction not restarted" });
      continue;
    }
    if (building.construction !== 1 || building.militaryFaction || building.productionPaused ||
      building.worker === undefined) {
      unsupported.push({ uid: building.uid, reason: "sea-ship shipyard is paused, unstaffed or unbuilt" });
      continue;
    }
    const found = firstSites.get(building.uid);
    if (!found) {
      unsupported.push({ uid: building.uid,
        reason: "sea-ship yard has no reachable hull work site and navigable launch" });
      continue;
    }
    const talentBonus = offlineProductionTalentBonus(building.typeId, talents, colony);
    const accountId = siteAccount(building.uid), worker = workerToken(building.uid);
    const hulls: Hull[] = [];
    const stock: Record<string, number> = { [worker]: 1, [stageToken(building.uid, 0)]: 1 };
    const required: Goods = {};
    let candidate: typeof found | undefined = found, stage = 0, earliestFinish = 0;
    // Every future hull gets a different legal coast cell. Existing idle ships retain theirs.
    // Stop when even free materials could not start another hull within this horizon.
    while (candidate && earliestFinish < endTick) {
      const { newSite, site } = candidate;
      reserved.add(`${site.water.x},${site.water.z}`);
      const initialSteps = Math.max(0, Math.min(SHIPYARD_RECIPES.ships.planks, site.steps));
      const initialCloth = Math.max(0, Math.min(SHIPYARD_RECIPES.ships.cloth, site.cloth));
      const items = remainingShipMaterials(initialSteps, initialCloth);
      const visitTicks = items.map(material => shipVisitTicks(building, site, material, talentBonus, save.settlement.playerNation));
      const visitUids: string[] = [], hullIndex = hulls.length;
      const prefix = hullIndex === 0 ? `ship:${building.uid}` : `ship:${building.uid}:hull:${hullIndex}`;
      for (let index = 0; index < items.length; index++) {
        const uid = `${prefix}:visit:${index}`, material = items[index]!;
        visitUids.push(uid);
        required[material] = (required[material] ?? 0) + 1;
        jobs.push({ uid, islandId: accountId, cycleTicks: visitTicks[index]!,
          inputs: { [stageToken(building.uid, stage)]: 1, [material]: 1, [worker]: 1 },
          outputs: { [stageToken(building.uid, stage + 1)]: 1, [worker]: 1 } });
        stage++;
      }
      const launchUid = `${prefix}:launch`, launchTicks = Math.max(1, Math.ceil(2 * TPS));
      jobs.push({ uid: launchUid, islandId: accountId, cycleTicks: launchTicks,
        inputs: { [stageToken(building.uid, stage)]: 1, [worker]: 1 },
        outputs: { [stageToken(building.uid, stage + 1)]: 1, [worker]: 1 } });
      stage++;
      hulls.push({ initialCloth, initialSteps, items, launchUid, newSite, site, visitTicks, visitUids });
      earliestFinish += visitTicks.reduce((sum, ticks) => sum + ticks, 0) + launchTicks;
      if (earliestFinish >= endTick) break;
      candidate = findSite(save, world, building, reserved, false);
    }
    const preloaded: Goods = {};
    for (const [ware, count] of Object.entries(required)) {
      preloaded[ware] = Math.min(count, own(building.input, ware));
      stock[ware] = own(preloaded, ware);
    }
    islands.push({ islandId: accountId, ownerIslandId: islandId, stock });
    internal.push({ accountId, islandId });
    const missing: Goods = {};
    for (const [ware, count] of Object.entries(required)) {
      const shortage = count - own(preloaded, ware);
      if (shortage > 0) missing[ware] = shortage;
    }
    const timing = deliveryTiming(save, world, building);
    if (Object.keys(missing).length && !timing) {
      notes.push(`Shipyard ${building.uid}: no connected storage route for missing hull/cloth; site waits.`);
    }
    if (timing && !hasCarrier)
      notes.push(`Shipyard ${building.uid}: missing hull/cloth waits because no carrier or settler is available.`);
    if (timing && hasCarrier) for (const ware of Object.keys(missing))
      jobs.push({ uid: `ship:${building.uid}:deliver:${ware}`, islandId, kind: "transfer",
        destinationIslandId: accountId, cycleTicks: timing.cycleTicks, workTicks: timing.workTicks,
        workOverlapsCycle: true, endTick, inputs: { [ware]: 1 }, outputs: { [ware]: 1 },
        maxTransferUnits: 1,
        destinationTargets: { [ware]: SHIPYARD_RECIPES.ships[ware as Material] } });
    yards.push({ accountId, building, hulls, preloaded });
    handled.push(building.uid);
    notes.push(`Shipyard ${building.uid}: ${hulls.length} legal sequential hull sites, one worker; ` +
      "each launch requires its own planks, cloth and completed visits.");
  }
  return {
    apply: (result, horizonTicks) => {
      for (const yard of yards) {
        const completed = (uid: string) => own(result.completedCycles, `${islandId}:${uid}`) > 0;
        const ledger = result.islands.find(island => island.islandId === yard.accountId);
        if (!ledger) throw new Error("Offline ship site ledger unavailable");
        for (const [ware, count] of Object.entries(yard.preloaded)) {
          if ((yard.building.input[ware] ?? 0) < count)
            throw new Error("Offline ship preloaded receipt is unavailable at commit");
          yard.building.input[ware] = (yard.building.input[ware] ?? 0) - count;
        }
        for (const [ware, count] of Object.entries(ledger.stock))
          if (!ware.startsWith("~") && count > 0)
            yard.building.input[ware] = (yard.building.input[ware] ?? 0) + count;
        for (const hull of yard.hulls) {
          const installed = hull.visitUids.filter(completed).length;
          const launched = completed(hull.launchUid);
          let steps = hull.initialSteps, cloth = hull.initialCloth;
          for (let index = 0; index < installed; index++)
            if (hull.items[index] === "planks") steps++; else cloth++;
          const naval = navalState(state);
          if (launched) {
            if (!seaShipReady(steps, cloth)) throw new Error("Offline ship launched before its recipe completed");
            if (hull.newSite) naval.nextSite++;
            createShip(state, world, { ...hull.site, steps, cloth });
            built++;
            continue;
          }
          // Do not invent a physical hull for an unstarted later job. A paid visit refunded at
          // the cutoff has no installed plank yet and resumes from the yard's retained input.
          if (!installed && hull.newSite) break;
          const existing = naval.sites.find(entry => entry[0] === yard.building.uid);
          const site = existing?.[1] ?? { ...hull.site, id: naval.nextSite++ };
          site.steps = steps; site.cloth = cloth;
          if (!existing) naval.sites.push([yard.building.uid, site]);
          break;
        }
        if (horizonTicks < 0) throw new Error("Invalid offline ship horizon");
      }
    },
    built: () => built, handled, internal, islands, jobs, notes, unsupported
  };
};

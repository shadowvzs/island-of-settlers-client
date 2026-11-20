import type { ShipSiteFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import { countIslandAction } from "../script-world/script-action-counters";
import { isIdleExpeditionShip } from "./expedition-launch-rules";
import { isFeatureOn } from "./feature-rules";
import { harbourHelperSupply } from "./harbour-helper-supply";
import { cancelScoutlessExplorations, dropNavalPerson } from "./naval-person-release";
import { addGood } from "./production-rules";
import { createColonyExpeditions } from "./settlement-colony-expeditions";
import { canEnterDoor, entrancePath, exitPath } from "./settlement-entrance";
import { createHarbourDocks } from "./settlement-harbour-docks";
import { createHarbourPiers } from "./settlement-harbour-piers";
import { isOwnBuilding } from "./settlement-home";
import type { EmigratedTroop } from "./settlement-military";
import { createNavalCharting } from "./settlement-naval-charting";
import { createNavalExpeditions } from "./settlement-naval-expeditions";
import { createNavalExploration } from "./settlement-naval-exploration";
import {
  createNavalFleet, type NavalColonyVoyage, type NavalHomewardLoad, type NavalVisitorRole
} from "./settlement-naval-fleet";
import { createNavalFounding } from "./settlement-naval-founding";
import { createNavalPassengers } from "./settlement-naval-passengers";
import { createExpeditionPreparations } from "./settlement-naval-preparation";
import { createReliefShipPort, reliefAndTradeShipHooks } from "./settlement-naval-relief";
import { createTradeShipPort } from "./settlement-naval-trade";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { type CoastalWorkSite,createSeaMask, findCoastalWorkSite } from "./settlement-sea-navigation";
import { shipHullFitsSea } from "./settlement-ship-clearance";
import { advanceShipPier, findShipWorkpoint, type ShipWorkpoint } from "./settlement-ship-workpoint";
import { createShippingDemand } from "./settlement-shipping-demand";
import { remainingShippingOrderNeed } from "./settlement-shipping-priority";
import { createShipyardBoats } from "./settlement-shipyard-boats";
import { findShipyardWorkSite } from "./settlement-shipyard-placement";
import { advanceWareTransfer, clearWareTransfer,startWareTransfer, stockContact } from "./settlement-stock-transfers";
import type { Goods, SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { creditStorageAt } from "./shared-storage";
import { createColonyTroopPickup, createTroopShipCommands } from "./ship-troop-commands";
import { createTroopShipHorses } from "./ship-troop-horse";
import {
  seaShipReady, SHIPYARD_HULL_PLANKS_BEFORE_RIGGING, SHIPYARD_RECIPES, type ShipyardMode
} from "./shipyard-recipes";

export type { ShipyardMode } from "./shipyard-recipes";
interface Site extends CoastalWorkSite { cloth: number; id: number; yard: number; steps: number; work?: ShipWorkpoint }
const cancelFoundingAtSource = (context: SettlementContext, fleet: ReturnType<typeof createNavalFleet>,
  founding: ReturnType<typeof createNavalFounding>, uid: number) => {
  const fallback = context.buildings.find(building => building.uid !== uid &&
    building.typeId === 39 && building.construction === 1 && isOwnBuilding(building));
  for (const ship of fleet.saveState().ships) {
    if (ship.sourceUid !== uid || ship.foundingSiteUid === undefined || ship.orderId === undefined) continue;
    if (!fallback) continue;
    founding.retargetSource(uid, fallback.uid);
    ship.sourceUid = fallback.uid;
    fleet.cancelTransport(ship.orderId);
  }
  founding.removeSource(uid);
};
const sameSite = (target: { x: number; z: number } | undefined, point: { x: number; z: number }) =>
  Boolean(target && Math.abs(target.x - point.x) < 1e-6 && Math.abs(target.z - point.z) < 1e-6);
const mainHarbour = (context: SettlementContext) => {
  const harbours = context.buildings.filter(building => building.typeId === 39 && building.construction === 1);
  return harbours.find(building => building.colonyHome) ?? harbours[0];
};
const freeOwnShips = (fleet: ReturnType<typeof createNavalFleet>) =>
  fleet.snapshot().filter(isIdleExpeditionShip).length;
/**
 * Development menu: idle ships (drawn in the player's nation style) appear beside the harbour berth
 * until `count` own ships are free; `free` is 0 when the water there has no room for one.
 */
const ensureFreeShips = (fleet: ReturnType<typeof createNavalFleet>, harbourUid: number, count: number) => {
  let added = 0;
  while (freeOwnShips(fleet) < count && fleet.addShipNearDock(harbourUid) !== null) added++;
  return { added, free: freeOwnShips(fleet) };
};
/**
 * Civilian ships are built on reachable coast; their cargo remains owned across every voyage phase.
 */
interface ShipwrightWorkOptions {
  active: Map<number, Site>;
  boats: ReturnType<typeof createShipyardBoats>;
  context: SettlementContext;
  fleet: ReturnType<typeof createNavalFleet>;
  modes: Map<number, ShipyardMode>;
  nextSite: () => number;
  sites: Map<number, Site>;
}
/** One shipwright's sea-ship cycle: hull planks, four cloth rigging visits and one launch guard. */
const createShipwrightWork = (options: ShipwrightWorkOptions) => {
  const { active, boats, context, fleet, modes, nextSite, sites } = options;
  /** Hull planks first; every required cloth roll is fitted before the last hull visits. */
  const nextShipMaterial = (site: Site | undefined): "cloth" | "planks" =>
    site && site.steps >= SHIPYARD_HULL_PLANKS_BEFORE_RIGGING &&
      site.cloth < SHIPYARD_RECIPES.ships.cloth ? "cloth" : "planks";
  /** One launch guard for shore and pier-return branches: complete materials and work, once. */
  const launchSeaShip = (site: Site, building: SettlementBuilding) => {
    if (!seaShipReady(site.steps, site.cloth)) return false;
    fleet.addShip(site.water, site.yaw ?? 0);
    countIslandAction(context, "ship");
    sites.delete(building.uid);
    return true;
  };
  const shipInputContact = (building: SettlementBuilding, ware: string) =>
    stockContact(context, building, "input", ware, Math.max(0, (building.input[ware] ?? 0) - 1));
  return (actor: SettlementActor, dt: number) => {
    const building = context.buildings.find((b) => b.uid === actor.building && b.typeId === 36);
    if (!building || building.construction < 1 || actor.job !== "Shipwright") return false;
    // Dismantling owns the worker until the hull is gone; normal shipbuilding does not start.
    if (["shipDismantleWalk", "shipDismantle", "shipDismantleReturn"].includes(actor.phase)) return true;
    if (!active.has(actor.uid) && boats.update(actor, building, dt, modes.get(building.uid) !== "ships")) return true;
    if (actor.boatWork === undefined && actor.phase === "enterAssigned") {
      if (moveActor(context, actor, dt)) { actor.phase = "inside"; actor.visible = false; actor.action = "idle"; }
      return true;
    }
    let site = active.get(actor.uid);
    if (!site) {
      if (modes.get(building.uid) !== "ships" || !["inside", "rest"].includes(actor.phase)) return false;
      building.working = false;
      if (building.productionPaused) { building.status = "Production stopped"; actor.action = "idle"; return true; }
      actor.timer = Math.max(0, actor.timer - dt);
      if (actor.timer > 0) return true;
      site = sites.get(building.uid);
      if (site && launchSeaShip(site, building)) {
        building.status = "Resting"; actor.timer = 2; return true;
      }
      const material = nextShipMaterial(site);
      if ((building.input[material] ?? 0) < 1) {
        building.status = material === "cloth" ? "Waiting for cloth" : "Waiting for planks";
        return true;
      }
      if (!site) {
        const reserved = new Set([...sites.values()].map((s) => `${s.water.x},${s.water.z}`));
        for (const ship of fleet.frames().filter(frame => frame.sinkProgress === undefined)) reserved.add(`${Math.floor(ship.x) + 0.5},${Math.floor(ship.z) + 0.5}`);
        // Prefer clean water over a harbour berth: a shipyard construction obstacle on the berth
        // blocks every ship from docking there. A cramped coast may have no alternative, so fall
        // back to the old search rather than refusing to build the ship.
        const workingWater = new Set(reserved);
        for (const harbour of context.buildings)
          if (harbour.typeId === 39 && harbour.construction === 1)
            for (const berth of fleet.harbourBerths(harbour.uid))
              workingWater.add(`${berth.x},${berth.z}`);
        const launch = findShipyardWorkSite(context, building, workingWater) ??
          findShipyardWorkSite(context, building, reserved);
        if (!launch) {
          building.status = "No reachable ship work site with a navigable launch within 36 tiles";
          actor.timer = 2;
          return true;
        }
        site = { ...launch, cloth: 0, id: nextSite(), yard: building.uid, steps: 0 };
        sites.set(building.uid, site);
      }
      const path = groundPath(context, building.access, site.land);
      if (!path) { building.status = "Coast workpoint blocked"; actor.timer = 2; return true; }
      actor.stockBuilding = building.uid;
      actor.stockContact = shipInputContact(building, material);
      const inputPath = groundPath(context, building.access, actor.stockContact.approach, building.uid);
      if (!inputPath) { building.status = "Input stock access blocked"; return true; }
      active.set(actor.uid, site);
      setActorPath(actor, [...exitPath(building), ...inputPath], "shipInputWalk"); building.door = 1;
    }
    if (actor.phase === "shipInputWalk") {
      if (moveActor(context, actor, dt)) {
        const material = nextShipMaterial(site);
        if (!(building.input[material] ?? 0)) {
          active.delete(actor.uid); actor.phase = "rest"; actor.timer = 1; return true;
        }
        addGood(building.input, material, -1);
        actor.ware = material;
        startWareTransfer(actor, "pickup", material, actor.stockContact!);
        actor.phase = "shipInputPickup";
      }
    } else if (actor.phase === "shipInputPickup" || actor.phase === "shipInputBlocked") {
      if (actor.phase === "shipInputPickup" && !advanceWareTransfer(actor, dt)) return true;
      clearWareTransfer(actor);
      const path = groundPath(context, actor, site.land, building.uid);
      if (path) setActorPath(actor, path, "outbound");
      else { actor.phase = "shipInputBlocked"; actor.action = "idle"; building.status = "Coastal work route blocked"; }
    } else if (actor.phase === "outbound") {
      building.status = actor.ware === "cloth" ? "Carrying cloth to ship" : "Carrying plank to ship";
      if (moveActor(context, actor, dt)) {
        if (site.work) setActorPath(actor, [site.work.point], "shipPierOut");
        else { actor.phase = "shipWork"; actor.timer = 3.5; }
      }
    } else if (actor.phase === "shipPierOut" && site.work) {
      if (advanceShipPier(context, actor, site.work, false, dt)) {
        actor.pathIndex = actor.path.length; actor.phase = "shipWork"; actor.timer = 3.5;
      }
    } else if (actor.phase === "shipWork") {
      const fitting = actor.ware === "cloth";
      building.working = true; building.status = fitting ? "Fitting sails" : "Building ship";
      actor.action = "work";
      actor.yaw = DMath.atan2((site.work?.contact.x ?? site.water.x) - actor.x,
        (site.work?.contact.z ?? site.water.z) - actor.z);
      actor.timer -= dt;
      if (actor.timer <= 0) {
        building.working = false;
        if (fitting) site.cloth = Math.min(SHIPYARD_RECIPES.ships.cloth, site.cloth + 1);
        else site.steps++;
        actor.ware = null;
        if (site.work) { setActorPath(actor, [site.work.shore], "shipPierReturn"); return true; }
        launchSeaShip(site, building);
        const path = groundPath(context, actor, building.access, building.uid);
        if (path) setActorPath(actor, path, "returnWork");
        else { actor.phase = "shipReturnBlocked"; building.status = "Return path blocked"; }
      }
    } else if (actor.phase === "shipPierReturn" && site.work) {
      if (advanceShipPier(context, actor, site.work, true, dt)) {
        actor.pathIndex = actor.path.length;
        launchSeaShip(site, building);
        const path = groundPath(context, actor, building.access, building.uid);
        if (path) setActorPath(actor, path, "returnWork");
        else { actor.phase = "shipReturnBlocked"; building.status = "Return path blocked"; }
      }
    } else if (actor.phase === "shipReturnBlocked") {
      const path = groundPath(context, actor, building.access, building.uid);
      if (path) setActorPath(actor, path, "returnWork");
    } else if (actor.phase === "returnWork") {
      if (moveActor(context, actor, dt) && canEnterDoor(context, actor, building))
        setActorPath(actor, entrancePath(building), "enterRest");
    } else if (actor.phase === "enterRest" && moveActor(context, actor, dt)) {
      actor.visible = false; actor.phase = "rest"; actor.action = "idle"; actor.timer = 2;
      active.delete(actor.uid); building.status = "Resting";
    }
    return true;
  };
};
/** Civilian ships are built on reachable coast; their cargo remains owned across every voyage phase. */
export const createSettlementNaval = (context: SettlementContext,
  onColonyArrived?: Parameters<typeof createColonyExpeditions>[1]["onArrived"]) => {
  const sea = createSeaMask(context.options.world);
  const docks = createHarbourDocks(context);
  const passengers = createNavalPassengers(context, {
    // An anchored troop ship's gangway is its pier (MIL-SHIPS-SIM).
    dockFor: ship => fleet.troopMissions.gangwayDock(ship) ?? docks.forShip(ship),
    // The commander's horse aboard a troop ship (stateless: the troop missions draw and move the same horse).
    horses: createTroopShipHorses(context),
    isCommander: uid => context.commander?.isCommanderActor(uid) ?? false,
    shipForActor: uid => fleet.shipForPassenger(uid)
  });
  const expeditions = createNavalExpeditions(context, sea);
  const exploration = createNavalExploration(context);
  const release = (ids: readonly number[], uid: number) => {
    const destination = context.buildings.find(building => building.uid === uid)!;
    passengers.release(ids, destination);
  };
  let founding: ReturnType<typeof createNavalFounding> | null = null;
  const fleet = createNavalFleet(context, sea, { ...passengers, release,
    remainingTransportNeed: order => remainingShippingOrderNeed(order,
      context.naval?.shippingDemands?.() ?? [], (destination, ware) => {
        const target = context.naval?.shippingDemands?.().find(entry => entry.destinationUid === destination && entry.ware === ware);
        return target?.collectPoolId !== undefined ? fleet.coverageForPool(target.collectPoolId, ware) :
          fleet.coverageFor(destination, ware);
      }),
    loadPassengers: (ship, dt) =>
    passengers.load(ship) && (context.commander?.advanceBoarding(ship, dt) ?? true),
    loadTroopPassengers: passengers.load,
    unloadPassengers: passengers.unload,
    found: (site, cargo, ids, shipId) => {
      const result = expeditions.found(site, cargo, ids);
      return result?.shore && founding?.begin(shipId, result.uid, result.shore, ids) ? result : null;
    },
    cancelFounding: ship => founding?.cancelShip(ship) ?? false,
    colonyVoyage: (id, event, cargo, ids) => colonies.onVoyage(id, event, cargo, ids),
    visitorLoaded: goods => context.options.onVisitorLoaded?.(goods),
    ...reliefAndTradeShipHooks(context),
    reserveTroops: (ids, harbour) => {
      const living = ids.filter(uid => context.actors.some(actor => actor.uid === uid));
      return passengers.reserveChosen(harbour, 0, living);
    },
    visitorTroopsDepart: ids => {
      const troops = ids.flatMap(uid => context.military?.emigrate?.(uid) ?? []);
      if (troops.length) context.options.onTroopsReturned?.(troops);
    },
    landTroops: (troops, uid) => context.military?.immigrate?.(troops, context.buildings.find(site => site.uid === uid)) },
  () => [...sites.values()].map(site => ({ ...site.water,
      yaw: site.yaw ?? DMath.atan2(site.water.x - site.land.x, site.water.z - site.land.z) + Math.PI / 2 })));
  founding = createNavalFounding(context, { fleet });
  const modes = new Map<number, ShipyardMode>(), active = new Map<number, Site>(), sites = new Map<number, Site>();
  const boats = createShipyardBoats(context);
  const piers = createHarbourPiers(context, fleet.harbourBerths);
  let nextSite = 1;
  const preparations = createExpeditionPreparations(context, { fleet, passengers, site: expeditions.site });
  const colonies = createColonyExpeditions(context, { fleet, onArrived: onColonyArrived, passengers });
  const charting = createNavalCharting(context, sea, {
    active: sourceUid => fleet.pending().some(order => order.sourceUid === sourceUid && order.exploration) ||
      fleet.snapshot().some(ship => ship.sourceUid === sourceUid && ship.exploration),
    claimed: point => fleet.expeditionTargets().some(target => sameSite(target, point)),
    idleShips: () => fleet.snapshot(),
    mode: context.options.explorationMode,
    pendingOrders: () => fleet.pending().filter(order => order.shipId === undefined).length,
    scoutSupply: sourceUid => {
      const source = context.buildings.find(building => building.uid === sourceUid && building.typeId === 39 &&
        building.construction === 1 && isOwnBuilding(building));
      return source ? { settlers: harbourHelperSupply(context, source),
        spyglasses: source.inventory.spyglass ?? 0 } : { settlers: 0, spyglasses: 0 };
    },
    site: expeditions.site
  });
  const expeditionDemand = (uid: number) => {
    const demand = { ...preparations.demand(uid) };
    for (const [ware, count] of Object.entries(colonies.demand(uid))) addGood(demand, ware, count);
    return demand;
  };
  const shipyardDemand = (uid: number) => {
    if (modes.get(uid) !== "ships") return {};
    const building = context.buildings.find(candidate => candidate.uid === uid);
    if (!building || building.construction < 1) return {};
    const site = sites.get(uid);
    const demand: Goods = {};
    const cloth = Math.max(0, SHIPYARD_RECIPES.ships.cloth - (site?.cloth ?? 0) -
      (building.input.cloth ?? 0) - (building.incoming.cloth ?? 0));
    if (cloth > 0) demand.cloth = cloth;
    return demand;
  };
  const shipping = createShippingDemand(context, {
    canReachHarbour: fleet.canReachHarbour,
    expeditionDemand,
    fleetCoverage: fleet.coverageFor, fleetPoolCoverage: fleet.coverageForPool,
    hasIdleShipAt: fleet.canServeTransportAt,
    queueTransport: (source, destination, cargo, demand) =>
      fleet.queueTransport(source, destination, cargo, [], undefined, undefined, undefined, undefined, demand),
    shipyardDemand, transportDistance: fleet.transportDistance
  });
  /** A restored save may hold voyages whose scout the offline raid estimate removed; they end on the next update. */
  let scoutCheckDue = false;
  /**
   * A voyage helper or shipwright lost on land (MIL-CREWS): no list keeps them; ships and hull sites stay.
   * An exploration left without its scout is cancelled at once (MIL-TWEAKS).
   */
  const forgetPerson = (uid: number) => {
    const { orders, ships } = fleet.saveState();
    for (const holder of [...orders, ...ships]) dropNavalPerson(holder, uid);
    preparations.forgetPerson(uid);
    colonies.forgetPerson(uid);
    active.delete(uid);
    cancelScoutlessExplorations(fleet);
  };
  context.naval = { expeditionDemand, explorerShips: fleet.liveShips, forgetPerson,
    localBoatClaims: fleet.localBoatClaims, removeBuilding: (uid: number) => removeBuilding(uid), rowers: fleet.rowers,
    rewardShipBound: fleet.rewardShipBound, shipyardDemand,
    shippingDemandChanged: () => { shipping.notify(); shipping.reconcile(); },
    shippingDemands: shipping.demands,
    tradeShips: createTradeShipPort(fleet), reliefShips: createReliefShipPort(fleet) };
  const setShipyardMode = (uid: number, mode: ShipyardMode) => {
    if (!context.buildings.some((b) => b.uid === uid && b.typeId === 36) || !["boats", "ships"].includes(mode)) return false;
    modes.set(uid, mode); return true;
  };
  const updateShipwright = createShipwrightWork({ active, boats, context, fleet, modes,
    nextSite: () => nextSite++, sites });
  /** The shipyard's own shipwright walks to the hull and removes one refund unit per hammer step. */
  const updateDismantles = (dt: number) => {
    for (const ship of fleet.saveState().ships) {
      const dismantle = ship.dismantle;
      if (!dismantle || ship.phase !== "dismantling") continue;
      const yard = context.buildings.find(building => building.uid === dismantle.yardUid);
      if (!yard || yard.typeId !== 36 || yard.construction < 1) {
        ship.gone = true;
        continue;
      }
      const worker = context.actors.find(actor => actor.uid === yard.worker && actor.job === "Shipwright");
      if (!worker) { yard.status = "Waiting for a shipwright"; continue; }
      const target = dismantle.site.work?.shore ?? dismantle.site.land;
      if (!["shipDismantleWalk", "shipDismantle", "shipDismantleReturn"].includes(worker.phase)) {
        const path = groundPath(context, worker, target, yard.uid);
        if (!path) { yard.status = "No shipwright route to the ship"; continue; }
        worker.visible = true;
        setActorPath(worker, path, "shipDismantleWalk");
        worker.action = "walk";
      } else if (worker.phase === "shipDismantleWalk") {
        if (moveActor(context, worker, dt)) {
          worker.phase = "shipDismantle";
          worker.timer = 2;
          worker.action = "work";
        }
      } else if (worker.phase === "shipDismantle") {
        worker.action = "work";
        worker.timer -= dt;
        if (worker.timer > 0) continue;
        const ware = dismantle.refund[0];
        if (ware && creditStorageAt(context, yard, ware, 1)) {
          dismantle.refund.shift();
          dismantle.progress++;
        } else {
          yard.status = "Waiting for storage room";
          worker.timer = 2;
          continue;
        }
        if (!dismantle.refund.length) {
          ship.gone = true;
          yard.status = "Resting";
          const path = groundPath(context, worker, yard.access, yard.uid);
          if (path) {
            setActorPath(worker, path, "shipDismantleReturn");
            worker.action = "walk";
          } else {
            worker.phase = "inside";
            worker.visible = false;
            worker.action = "idle";
          }
        } else worker.timer = 2;
      } else if (worker.phase === "shipDismantleReturn" && moveActor(context, worker, dt)) {
        worker.phase = "inside";
        worker.visible = false;
        worker.action = "idle";
      }
    }
  };
  const ownShip = (uid: number) => fleet.saveState().ships.find(ship => ship.id === uid && !ship.visitor);
  /** Only an empty, idle owned ship can be sent to a staffed shipyard; visitors and busy hulls stay. */
  const canDemolishShip = (uid: number) => {
    const ship = ownShip(uid);
    return Boolean(ship && ship.phase === "idle" && !ship.dismantle &&
      ship.orderId === undefined && ship.nextOrderId === undefined && ship.reservedFor === undefined &&
      ship.foundingSiteUid === undefined && ship.colony === undefined && ship.expedition === undefined &&
      ship.exploration === undefined && !ship.passengers?.length && !ship.troops?.length &&
      !Object.values(ship.cargo).some(count => count > 0));
  };
  /** Sends the hull to the nearest staffed, completed shipyard that can take it from where it floats. */
  const demolishShip = (uid: number) => {
    const ship = ownShip(uid);
    if (!ship || !canDemolishShip(uid)) return false;
    const reserved = new Set([...sites.values()].map(site => `${site.water.x},${site.water.z}`));
    const yards = context.buildings
      .filter(building => building.typeId === 36 && building.construction === 1 && building.worker !== undefined)
      .sort((a, b) => DMath.hypot(a.x - ship.x, a.z - ship.z) - DMath.hypot(b.x - ship.x, b.z - ship.z));
    for (const yard of yards) {
      const site = findShipyardWorkSite(context, yard, reserved);
      if (!site) continue;
      if (fleet.dismantleShip(uid, yard.uid, site)) {
        yard.status = "Dismantling ship";
        return true;
      }
      reserved.add(`${site.water.x},${site.water.z}`);
    }
    return false;
  };
  const requestTroopPickup = createColonyTroopPickup(context, fleet, () => mainHarbour(context));
  const troopShips = createTroopShipCommands({ context, fleet, pickupHarbour: () => mainHarbour(context),
    requestTroopPickup });
  const queuePassengers = (sourceUid: number, destinationUid: number, helpers: number, soldiers = 0) => {
    const source = context.buildings.find(building => building.uid === sourceUid &&
      building.typeId === 39 && building.construction === 1);
    if (!source || !fleet.canQueue(sourceUid, destinationUid, {}, helpers + soldiers)) return null;
    const ids = passengers.reserve(source, helpers, soldiers);
    if (!ids) return null;
    const id = fleet.queueTransport(sourceUid, destinationUid, {}, ids);
    if (id === null) { passengers.release(ids, source); return null; }
    ids.forEach(uid => { context.actors.find(actor => actor.uid === uid)!.navalOrder = id; });
    return id;
  };
  /** Settlement expeditions switched off by the game rules (GS4a) queue nothing; running ones finish. */
  const queueExpedition: typeof preparations.start = (sourceUid, point) =>
    isFeatureOn(context, "settlementExpeditions") ? preparations.start(sourceUid, point) : null;
  const queueExploration = (sourceUid: number) => {
    const source = context.buildings.find(building => building.uid === sourceUid && building.typeId === 39 && building.construction === 1);
    if (!source || !charting.availability(sourceUid).ready) return null;
    const points = charting.unknownObservationPoints(sourceUid); if (!points.length) return null;
    const receipt = { points, cursor: 0, returning: false };
    if (!fleet.canQueue(sourceUid, sourceUid, {}, 1, undefined, receipt)) return null;
    const ids = passengers.reserveScouts(source); if (!ids) return null;
    const id = fleet.queueTransport(sourceUid, sourceUid, {}, ids, undefined, receipt);
    if (id === null) { passengers.release(ids, source); return null; }
    ids.forEach(uid => { context.actors.find(actor => actor.uid === uid)!.navalOrder = id; }); return id;
  };
  const removeBuilding=(uid:number) => {
    preparations.removeBuilding(uid);
    cancelFoundingAtSource(context, fleet, founding!, uid);
    colonies.removeBuilding(uid);
    fleet.removeHarbourShuttle(uid);
    for(const order of fleet.pending()) if(order.sourceUid===uid || order.destinationUid===uid) fleet.cancelTransport(order.id);
    fleet.releaseHarbourReserves(uid);
    modes.delete(uid);sites.delete(uid);
    for(const [actor,site] of active) if(site.yard===uid) active.delete(actor);
    // A recalled shipyard releases its hull instead of leaving it dismantling forever.
    for (const ship of fleet.saveState().ships)
      if (ship.dismantle?.yardUid === uid) { ship.dismantle = undefined; if (ship.phase === "dismantling") ship.phase = "idle"; }
    shipping.notify();
  };
  const saveState = () => ({ modes: [...modes], sites: [...sites],
    active: [...active], nextSite, charting: charting.saveState(), preparation: preparations.saveState(),
    founding: founding!.saveState(), fleet: fleet.saveState(), colonies: colonies.saveState(),
    shipping: shipping.saveState() });
  const restore = (state: ReturnType<typeof saveState>, inPlace = false) => {
    preparations.restore(state.preparation);
    founding!.restore(state.founding);
    charting.restore(state.charting, inPlace);
    colonies.restore(state.colonies);
    shipping.restore(state.shipping);
    modes.clear(); sites.clear(); active.clear();
    for (const [uid, mode] of state.modes) modes.set(uid, mode);
    const held = new Set(state.fleet.ships.map(ship => `${ship.x},${ship.z}`));
    for (const [uid, saved] of state.sites) {
      const building = context.buildings.find(candidate => candidate.uid === uid);
      const yaw = saved.yaw ?? DMath.atan2(saved.water.x - saved.land.x, saved.water.z - saved.land.z) + Math.PI / 2;
      const legal = shipHullFitsSea(context.options.world, sea, { ...saved.water, yaw });
      const coast = !legal && building ? findCoastalWorkSite(context, building, sea, held) : null;
      const site = { ...saved, cloth: saved.cloth ?? 0, ...coast };
      if (building && !site.work) { const work = findShipWorkpoint(context, building, site); if (work) { site.work = work; site.land = work.shore; } }
      sites.set(uid, site); held.add(`${site.water.x},${site.water.z}`);
    }
    // Older saves could reserve a shipyard landing stage on a harbour's berth. That construction
    // obstacle then blocked every ship from docking there. Drop an idle conflicting reservation so
    // the shipyard chooses clean water on its next job; never interrupt a worker already using it.
    const activeSiteIds = new Set(state.active.map(([, saved]) => saved.id));
    for (const [uid, site] of [...sites]) {
      if (activeSiteIds.has(site.id)) continue;
      const blocksBerth = context.buildings.some(building => building.typeId === 39 &&
        building.construction === 1 && fleet.harbourBerths(building.uid).some(berth =>
          DMath.hypot(berth.x - site.water.x, berth.z - site.water.z) < 1));
      if (blocksBerth) sites.delete(uid);
    }
    for (const [uid, saved] of state.active) {
      const site = [...sites.values()].find(candidate => candidate.id === saved.id) ?? saved;
      const actor = context.actors.find(candidate => candidate.uid === uid);
      if (actor && ["outbound", "shipWork"].includes(actor.phase) &&
        (site.land.x !== saved.land.x || site.land.z !== saved.land.z)) {
        const path = groundPath(context, actor, site.land, site.yard);
        if (path) setActorPath(actor, path, "outbound");
      }
      active.set(uid, site);
    }
    nextSite = state.nextSite;
    for (const receipt of [...state.fleet.orders, ...state.fleet.ships]) {
      if (!receipt.expedition) continue;
      const updated = expeditions.site(receipt.expedition);
      if (updated) receipt.expedition.water = updated.water;
    }
    fleet.restore(state.fleet);
    // The offline raid estimate drops lost scouts from the saved lists; their voyages end on the next update.
    scoutCheckDue = true;
  };
  return { prewarmCoastalGeometry: charting.prewarm,
    afterInPlaceReload: charting.afterInPlaceReload,
    saveState, restore, removeBuilding, canDemolishShip, demolishShip, sinkShip: fleet.sinkShip,
    queuePassengers, queueExpedition, queueExploration,
    explorationAvailability: charting.availability, chartedSites: charting.sites,
    chartedSiteStatuses: charting.statuses, knownSettlementSites: charting.knownTargets,
    potentialSettlements: charting.settlementTargets,
    shippingDemands: shipping.demands,
    notifyShippingDemand: shipping.notify,
    /** Quiet-island skip: no ships, voyages, preparations, shipyard work or colony expeditions. */
    /** Quiet-island skip: the shipping-demand reconcile clock still runs (it finds no demand). */
    advanceQuiet: (dt: number) => shipping.update(dt),
    quietSkip: () => {
      const state = saveState();
      return !context.relief?.pending() && state.fleet.ships.length === 0 && state.fleet.orders.length === 0 &&
        (state.fleet.shuttles?.jobs.length ?? 0) === 0 &&
        state.active.length === 0 && state.sites.length === 0 &&
        state.preparation.preparations.length === 0 && state.colonies.expeditions.length === 0 &&
        state.founding.operations.length === 0;
    },
    canRemoveBuilding: (uid: number) => !context.actors.some(actor =>
      actor.building === uid && ["shipPierOut", "shipPierReturn", "shipWork"].includes(actor.phase)) && !context.actors.some(actor =>
      actor.navalOrder !== undefined && (actor.home === uid || actor.building === uid)),
    expeditionPreparations: preparations.snapshot, expeditionDestinations: expeditions.destinations,
    updatePassenger: (actor: SettlementActor, dt: number) =>
      passengers.updateActor(actor, dt) || fleet.troopMissions.updateLander(actor, dt),
    ...troopShips, troopShipHorseFrames: fleet.troopMissions.horseFrames,
    setShipyardMode, updateShipwright, update: (dt: number) => {
      const pending = fleet.pendingTroopPickups();
      if (pending.length) {
        const retained = context.military?.prioritizeRecallGarrisons?.(pending) ?? [];
        if (retained.length) fleet.releaseTroopPickups(retained);
      }
      if (scoutCheckDue) { scoutCheckDue = false; cancelScoutlessExplorations(fleet); }
      preparations.update(dt); colonies.update(dt); fleet.update(dt);
      updateDismantles(dt);
      shipping.update(dt);
      exploration.discover(fleet.saveState().ships, charting.chartObserved);
      charting.refreshSight();
      founding!.update(dt);
      // Piers (and so both berths) are found in the tick, not on first draw: a headless run finds them alike.
      piers();
    }, queueTransport: (source: number, destination: number, goods: Goods) => {
      const id = fleet.queueTransport(source, destination, goods);
      if (id !== null) shipping.notify();
      return id;
    },
    cancelTransport: (id: number) => {
      const cancelled = id < 0 ? preparations.cancel(id) : fleet.cancelTransport(id);
      if (cancelled) shipping.notify();
      return cancelled;
    }, frames: fleet.frames,
    colonyExpeditions: colonies.snapshot, colonyIslands: colonies.islands, expeditionOngoing: colonies.ongoing,
    colonyLanding: colonies.landing, releaseColony: colonies.release, colonyTroops: colonies.availableTroops, planColonyExpedition: colonies.plan,
    startColonyExpedition: colonies.start, cancelColonyExpedition: colonies.cancel,
    adventureIslands: colonies.adventureIslands, planAdventureExpedition: colonies.planAdventure,
    startAdventureExpedition: colonies.startAdventure,
    campaignRequirements: colonies.campaignRequirements,
    departCampaign: colonies.departCampaign,
    spawnDebugShip: fleet.spawnDebugShip,
    ensureFreeShips: (harbourUid: number, count: number) => ensureFreeShips(fleet, harbourUid, count),
    /** A harbour's berths: one, or two where two ships lie side by side untouched. */
    harbourBerths: fleet.harbourBerths,
    /**
     * A supply, ore, reward or troop ship from another island calls at the best of the player's
     * harbours (fewest ships per berth there; a pickup where its wares are stored; ties: the home harbour).
     */
    requestTroopPickup,
    sendVisitorShip: (
      cargo: Goods, pickup: readonly string[] = [], role?: NavalVisitorRole, troops?: readonly EmigratedTroop[],
      travelSeconds = 0, sourceColony?: number
    ) => {
      // Trade ships are sent by the island's trade office for a delivery (context.naval.tradeShips), never bare.
      if (role === "trade") return null;
      const target = fleet.bestHarbour(pickup, mainHarbour(context)?.uid);
      return target === undefined ? null : fleet.sendVisitor(target, cargo, pickup, role, troops, travelSeconds, sourceColony);
    },
    /** An idle own ship sails from the best harbour to an ended colony and brings `load` back there. */
    fetchFromColony: (voyage: Pick<NavalColonyVoyage, "expeditionId" | "voyageSeconds">, load: NavalHomewardLoad) => {
      const harbour = fleet.bestHarbour([], mainHarbour(context)?.uid);
      return harbour === undefined ? null : fleet.sendHomeward(harbour, voyage, load);
    },
    sites: (): ShipSiteFrame[] => [...founding!.landingFrames(), ...boats.frames(), ...docks(fleet.snapshot(), fleet.frames()),
      ...fleet.shuttleJetties(), ...fleet.troopMissions.sites(),
      ...[...sites.values()].map((site) => ({ id: site.id, ...site.water,
      y: context.options.world.seaLevel, yaw: site.yaw ?? DMath.atan2(site.water.x - site.land.x, site.water.z - site.land.z) + Math.PI / 2,
      progress: site.steps / SHIPYARD_RECIPES.ships.planks, cloth: site.cloth, workPier: site.work })), ...piers()],
    snapshot: fleet.snapshot, pending: fleet.pending, shipRoute: fleet.routeView,
    harbourShuttles: fleet.harbourShuttles,
    harbourShuttleStatus: fleet.harbourShuttleStatus,
    cancelHarbourShuttle: fleet.cancelHarbourShuttle,
    shuttleFrames: fleet.shuttleFrames,
    shipyardMode: (uid: number): ShipyardMode => modes.get(uid) ?? "boats",
    shipyardSite: (uid: number) => {
      const site = sites.get(uid);
      return site ? { cloth: site.cloth, planks: site.steps } : null;
    } };
};

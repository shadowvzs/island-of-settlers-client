import { DMath } from "../math/deterministic-math";
import { HARBOUR_TYPE_ID } from "./building-type-ids";
import { isEmigratedTroop } from "./colony-troop-supply";
import { MAX_HARBOUR_LIGHTERS } from "./harbour-lighters";
import {
  SHUTTLE_MAX_BOXES, SHUTTLE_MAX_UNITS, SHUTTLE_ROWERS, shuttleBoxes, type ShuttleJob, type ShuttleState
} from "./harbour-shuttle-plan";
import {
  isFiniteNumber,
  isSaveGoods,
  isSaveInteger,
  isSaveObject,
  isSavePoint
} from "./save-validation";
import { validChartedSitesSave } from "./settlement-charted-sites";
import { validNavalBackhaul } from "./settlement-naval-backhaul";
import { expeditionSupplies } from "./settlement-naval-preparation";
import { validateNavalPassengers } from "./settlement-naval-validation";
import { reliefDeliveryId } from "./settlement-relief-collections";
import { reliefShipOutsideMap } from "./settlement-relief-departure";
import { validShippingDemandSave } from "./settlement-save-shipping-demand";
import type { SettlementSaveV1 } from "./settlement-save-state";
import type { SettlementBuilding } from "./settlement-types";
import { MAX_DOCK_PORTERS } from "./ship-cargo-handling";
import { shipTroopMissionError } from "./ship-troop-mission";
import { SHIPYARD_RECIPES } from "./shipyard-recipes";
import { SMALL_BOAT_JOB_VERSION } from "./small-boat-crew";

/** Soldiers from another island aboard, and an ended colony's load on its way home. */
const validShipTroops = (ship: SettlementSaveV1["naval"]["fleet"]["ships"][number]) => {
  const troops = (list: unknown) => Array.isArray(list) && list.every(isEmigratedTroop);
  const homeward = ship.colony?.homeward;
  const manifest = ship.colony?.manifest;
  return (
    (ship.troops === undefined || troops(ship.troops)) &&
    (manifest === undefined || (isSaveObject(manifest) && isSaveGoods(manifest.cargo) &&
      isSaveGoods(manifest.jobs) && isSaveGoods(manifest.troops))) &&
    (homeward === undefined ||
      (isSaveObject(homeward) && isSaveGoods(homeward.cargo) && troops(homeward.troops)))
  );
};

type SavedShip = SettlementSaveV1["naval"]["fleet"]["ships"][number];
/** A troop ship holds its mission while boarding, sailing, anchored or landing (never idle; outside a channel). */
const TROOP_MISSION_PHASES = ["positioning", "loading", "sailing", "unloading", "stranded"];
/** The ship's other voyages and orders exclude a troop mission. */
const troopShipBusy = (ship: SavedShip) => !(TROOP_MISSION_PHASES.includes(ship.phase) || ship.outside?.left) ||
  ship.visitor !== undefined ||
  ship.orderId !== undefined || ship.colony !== undefined || ship.expedition !== undefined ||
  ship.exploration !== undefined || ship.foundingSiteUid !== undefined || ship.reservedFor !== undefined;
/** MIL-SHIPS-SIM: every troop ship's soldiers are own soldiers, each held by one ship in one role. */
const validateTroopMissions = (save: SettlementSaveV1) => {
  const own = new Set(save.military?.soldiers.filter(soldier => (soldier.combat?.faction ?? 0) === 0)
    .map(soldier => soldier.actor));
  const harbours = new Set(save.buildings.filter(building => building.typeId === HARBOUR_TYPE_ID)
    .map(building => building.uid));
  const held = new Set<number>();
  for (const ship of save.naval.fleet.ships) {
    const mission = ship.troopMission;
    if (mission === undefined) continue;
    if (troopShipBusy(ship)) return "Invalid troop ship mission";
    const error = shipTroopMissionError(mission, uid => own.has(uid), uid => harbours.has(uid));
    if (error) return error;
    if (mission.landers?.length && !mission.anchor) return "Invalid troop ship landing state";
    for (const uid of [...ship.passengers ?? [], ...mission.boarding, ...mission.landers ?? []]) {
      if (held.has(uid)) return "Invalid troop ship soldiers";
      held.add(uid);
    }
  }
  return shipHorseError(save);
};
/**
 * The commander's horse is shown on a voyage only while led aboard or standing on a troop ship's deck: its rider
 * is then that ship's passenger (2026-11-17).
 */
const shipHorseError = (save: SettlementSaveV1) => {
  const commander = save.military?.soldiers.find(soldier => soldier.commanderId !== undefined);
  const rider = save.actors.find(actor => actor.uid === commander?.actor);
  const horse = save.actors.find(actor => actor.uid === commander?.combat?.mount);
  if (!rider || !horse?.visible || rider.navalOrder === undefined) return null;
  const aboard = save.naval.fleet.ships.some(ship => ship.troopMission && ship.passengers?.includes(rider.uid));
  return aboard ? null : "Invalid commander's horse aboard";
};
type SavedRoutePoint = SavedShip["route"][number];
/** A trade ship names its trade delivery and pier queue number; only role `trade` carries them. */
const validTradeVisitor = (visitor: SavedShip["visitor"]) => {
  if (!visitor) return true;
  const { role, trade } = visitor as { role?: string; trade?: unknown };
  if (trade === undefined) return role !== "trade";
  return role === "trade" && isSaveObject(trade) && typeof trade.delivery === "string" && trade.delivery.length > 0 &&
    isSaveInteger(trade.queue, 1) && (trade.collecting === undefined || trade.collecting === true);
};
const validReliefVisitor = (visitor: SavedShip["visitor"], world: SettlementSaveV1["world"]) => {
  if (!visitor || visitor.relief === undefined) return true;
  const relief = visitor.relief;
  if (!isSaveObject(relief) || relief.version !== 1 || typeof relief.questId !== "string" ||
    !relief.questId.length || relief.questId.length > 200 || visitor.role !== "trade" ||
    visitor.trade?.delivery !== reliefDeliveryId(relief.questId)) return false;
  if (relief.tail === undefined) return true;
  const tail = relief.tail;
  return visitor.leaving === true && isSaveObject(tail) && tail.version === 1 && isSavePoint(tail.target) &&
    isFiniteNumber(tail.target.yaw) && tail.target.x >= -40 && tail.target.x <= world.cellsX + 40 &&
    tail.target.z >= -40 && tail.target.z <= world.cellsZ + 40 && reliefShipOutsideMap(world, tail.target);
};
/** Out of a narrow channel (2026-11-17): the sea exit it left by, its harbour, and whether it is beyond the edge. */
const validShipOutside = (outside: SavedShip["outside"]) => outside === undefined || (isSaveObject(outside) &&
  isSavePoint(outside.exit) && isSaveInteger(outside.harbourUid, 1) && [undefined, true].includes(outside.left));
/** The dock porters' job at a pier (absent in older saves and on ships not at a pier). */
const validHandling = (handling: SavedShip["handling"]) => handling === undefined || (isSaveObject(handling) &&
  isSaveInteger(handling.boxes) && isSaveInteger(handling.porters) && handling.porters <= MAX_DOCK_PORTERS &&
  (handling.perTrip === undefined || [1, 2].includes(handling.perTrip as number)) &&
  (handling.porters > 0) === (handling.boxes > 0) && isFiniteNumber(handling.seconds) && handling.seconds >= 0 &&
  isFiniteNumber(handling.walk) && handling.walk >= 0 &&
  (handling.speed === undefined || (isFiniteNumber(handling.speed) && handling.speed > 0)));
const optionalFinite = (value: unknown) => value === undefined || isFiniteNumber(value);
const nonNegative = (value: unknown) => isFiniteNumber(value) && value >= 0;
/** One lighter of a job: its landing, alongside point, landing place number and the carriers' way. */
const validLighterBoat = (boat: unknown) => isSaveObject(boat) && isSavePoint(boat.landing) &&
  isSavePoint(boat.alongside) && isSaveInteger(boat.place) && Array.isArray(boat.route) && boat.route.length > 0 &&
  boat.route.every(isSavePoint);
/** A lighter job (NAV-03): its harbour, its lighters (one boat each) and plan. */
const validLighters = (job: SavedShip["lighters"]) => job === undefined || (isSaveObject(job) && job.version === SMALL_BOAT_JOB_VERSION &&
  isSaveInteger(job.harbourUid) && Array.isArray(job.boats) && job.boats.every(validLighterBoat) &&
  isSaveObject(job.plan) && job.boats.length === job.plan.lighters &&
  isSaveInteger(job.plan.boxes) && isSaveInteger(job.plan.lighters) && job.plan.lighters >= 1 &&
  job.plan.lighters <= MAX_HARBOUR_LIGHTERS && nonNegative(job.plan.row) && nonNegative(job.plan.walk) &&
  nonNegative(job.plan.seconds) && (job.plan.speed === undefined || (isFiniteNumber(job.plan.speed) &&
  job.plan.speed > 0)));
const SHUTTLE_PHASES = ["blocked", "loading", "outbound", "returning", "unloading"];
const SHUTTLE_INTERRUPTIONS = ["cancelled", "destination-full", "destination-lost", "route-blocked", "source-full",
  "source-lost"];
const validShuttleRoute = (route: unknown) => Array.isArray(route) && route.length > 0 && route.every(isSavePoint);
const validShuttleResume = (resume: unknown) => resume === undefined || (isSaveObject(resume) &&
  ["outbound", "returning"].includes(resume.phase as string) && isFiniteNumber(resume.share) &&
  resume.share >= 0 && resume.share <= 1 && nonNegative(resume.timer));
const validShuttleDemand = (demand: unknown) => demand === undefined || (isSaveObject(demand) &&
  typeof demand.automatic === "boolean" && typeof demand.ware === "string" && demand.ware.length > 0 &&
  isSaveInteger(demand.count, 1) && demand.count <= SHUTTLE_MAX_UNITS && isSaveInteger(demand.destination) &&
  (demand.restored === undefined || typeof demand.restored === "boolean"));
const validShuttleEndpoints = (job: ShuttleJob, ids: Set<number>, save: SettlementSaveV1) => {
  const source = save.buildings.find(building => building.uid === job.sourceUid);
  const destination = save.buildings.find(building => building.uid === job.destinationUid);
  const sourceOk = source ? source.typeId === 39 && source.construction === 1 :
    job.sourceLost === true && !ids.has(job.sourceUid);
  const destinationOk = destination ? destination.typeId === 39 && destination.construction === 1 :
    job.destinationLost === true && !ids.has(job.destinationUid);
  return { destination, ok: sourceOk && destinationOk && (ids.has(job.sourceUid) || job.sourceLost === true) &&
    (ids.has(job.destinationUid) || job.destinationLost === true) };
};
const validShuttleCargo = (job: ShuttleJob, destination?: SettlementBuilding) =>
  isSaveGoods(job.cargo) && Object.values(job.cargo).reduce((sum, count) => sum + count, 0) <= SHUTTLE_MAX_UNITS &&
  shuttleBoxes(job.cargo) <= SHUTTLE_MAX_BOXES && (!destination || Object.entries(job.cargo).every(([ware, count]) =>
    (destination.incoming[ware] ?? 0) >= count));
const validShuttlePlan = (job: ShuttleJob) => {
  const plan = job.plan;
  return isSaveObject(plan) && nonNegative(plan.loading) && nonNegative(plan.outbound) &&
    nonNegative(plan.unloading) && nonNegative(plan.returning) && isSaveInteger(plan.boxes) &&
    plan.boxes >= 1 && plan.boxes <= SHUTTLE_MAX_BOXES && validShuttleRoute(job.route) &&
    validShuttleRoute(job.sourceRoute) && validShuttleRoute(job.destinationRoute) &&
    isSavePoint(job.sourceLanding) && isSavePoint(job.destinationLanding) &&
    (job.hold === undefined || isSavePoint(job.hold)) && validShuttleResume(job.resume);
};
/** A nearby harbour shuttle job: one boat, one paddler, one cargo owner and its real water plan. */
const validShuttle = (job: ShuttleJob, ids: Set<number>, save: SettlementSaveV1) => {
  const endpoints = validShuttleEndpoints(job, ids, save);
  return isSaveObject(job) && job.version === SMALL_BOAT_JOB_VERSION && isSaveInteger(job.id, 1) && endpoints.ok &&
    validShuttleCargo(job, endpoints.destination) && isSaveInteger(job.crew) && job.crew === SHUTTLE_ROWERS &&
    SHUTTLE_PHASES.includes(job.phase) && nonNegative(job.timer) && validShuttlePlan(job) &&
    validShuttleDemand(job.demand) && nonNegative(job.blockedFor ?? 0) &&
    (job.legIndex === undefined || isSaveInteger(job.legIndex)) &&
    (job.homeUid === undefined || isSaveInteger(job.homeUid) &&
      (save.buildings.some(building => building.uid === job.homeUid && building.typeId === 39 &&
        building.construction === 1) || job.homeLost === true && !ids.has(job.homeUid))) &&
    (job.homeLost === undefined || typeof job.homeLost === "boolean") &&
    (job.returningHome === undefined || typeof job.returningHome === "boolean" &&
      (!job.returningHome || ["blocked", "returning"].includes(job.phase))) &&
    (job.sourceLost === undefined || typeof job.sourceLost === "boolean") &&
    (job.destinationLost === undefined || typeof job.destinationLost === "boolean") &&
    (job.interrupted === undefined || SHUTTLE_INTERRUPTIONS.includes(job.interrupted)) && job.done === undefined;
};
/** Saved nearby-harbour shuttle jobs (optional in older saves: absent means no service was running). */
const validShuttles = (shuttles: ShuttleState | undefined, ids: Set<number>, save: SettlementSaveV1) => {
  if (shuttles === undefined) return null;
  if (!isSaveObject(shuttles) || !Array.isArray(shuttles.jobs) || shuttles.jobs.length > 64 ||
    !isSaveInteger(shuttles.nextJob, 1)) return "Invalid harbour shuttle state";
  const sources = new Set<number>(), destinations = new Set<number>(), homes = new Set<number>();
  for (const job of shuttles.jobs) {
    if (!validShuttle(job, ids, save)) return "Invalid harbour shuttle job";
    if (job.id >= shuttles.nextJob || sources.has(job.sourceUid) || destinations.has(job.destinationUid) ||
      homes.has(job.homeUid ?? job.sourceUid))
      return "Duplicate or invalid harbour shuttle identity";
    sources.add(job.sourceUid); destinations.add(job.destinationUid); homes.add(job.homeUid ?? job.sourceUid);
  }
  return null;
};
/** A box by box transfer: the cargo when it began and the boxes already moved. */
const validTransfer = (transfer: SavedShip["transfer"]) => transfer === undefined || (isSaveObject(transfer) &&
  isSaveGoods(transfer.load));
/** A course point: a position, and the optional manoeuvre heading, curvature and swing point. */
const validRoutePoint = (point: SavedRoutePoint) => isSavePoint(point) && optionalFinite(point.yaw) &&
  optionalFinite(point.curvature) && optionalFinite(point.pivot) && optionalFinite(point.fromYaw) &&
  (point.astern === undefined || typeof point.astern === "boolean") &&
  (point.drift === undefined || typeof point.drift === "boolean") &&
  (point.settle === undefined || typeof point.settle === "boolean");

/** A landed founding operation owns its unfinished site, its ship and exactly three crew receipts. */
const validateFoundingState = (save: SettlementSaveV1) => {
  const founding = save.naval.founding;
  if (founding === undefined) return null;
  if (!isSaveObject(founding) || !Array.isArray(founding.operations) ||
    founding.operations.length > 32) return "Invalid founding state";
  const ships = new Set<number>(), sites = new Set<number>(), crew = new Set<number>();
  const receipt = { ...expeditionSupplies(save.playerNation ?? "roman") } as Record<string, number>;
  for (const operation of founding.operations) {
    if (!isSaveObject(operation) || !isSaveInteger(operation.shipId, 1) ||
      !isSaveInteger(operation.sourceUid) || !isSaveInteger(operation.siteUid, 1) ||
      !isSaveInteger(operation.builder) || !isSaveInteger(operation.leveler) ||
      !isSaveInteger(operation.carrier) || !isSavePoint(operation.shore) ||
      !["landing", "foundation", "unloading", "entering"].includes(operation.stage as string) ||
      (operation.blocked !== undefined && typeof operation.blocked !== "string") ||
      ships.has(operation.shipId) || sites.has(operation.siteUid)) return "Invalid founding operation";
    if (operation.landing && (!isSaveObject(operation.landing) ||
      !isSaveObject(operation.landing.pier) ||
      ![operation.landing.pier.shore, operation.landing.pier.point, operation.landing.pier.contact].every(isSavePoint) ||
      !isFiniteNumber(operation.landing.pier.y) || !isFiniteNumber(operation.landing.pier.shoreY) ||
      !Array.isArray(operation.landing.paths) || operation.landing.paths.length !== 3 ||
      !operation.landing.paths.every(path => Array.isArray(path) && path.every(isSavePoint))))
      return "Invalid founding landing pier";
    const ship = save.naval.fleet.ships.find(candidate => candidate.id === operation.shipId);
    const site = save.buildings.find(building => building.uid === operation.siteUid);
    if (!ship || ship.phase !== "founding" || ship.foundingSiteUid !== operation.siteUid ||
      !isSaveInteger(ship.orderId, 1) || ship.sourceUid !== operation.sourceUid ||
      !site || site.typeId !== 39 || site.foundedByExpedition !== true || site.construction > 1 ||
      site.construction < 0 || Boolean(site.foundingAnchor) !== (site.construction >= 1))
      return "Invalid founding ship or site";
    const source = save.buildings.find(building => building.uid === operation.sourceUid);
    if (source && (source.typeId !== 39 || source.construction !== 1)) return "Invalid founding source harbour";
    if ((operation.stage === "entering") !== (site.construction >= 1)) return "Invalid founding stage";
    if (Object.entries(ship.cargo).some(([ware, count]) => !Object.hasOwn(receipt, ware) ||
      !Number.isSafeInteger(count) || count < 0 || count > receipt[ware]!)) return "Invalid founding cargo";
    if (Object.keys(site.input).some(ware => !Object.hasOwn(receipt, ware)) ||
      Object.keys(site.constructionConsumed ?? {}).some(ware => !Object.hasOwn(receipt, ware)) ||
      Object.keys(site.inventory).some(ware => !Object.hasOwn(receipt, ware)))
      return "Invalid founding site receipt";
    const totals = new Map<string, number>();
    const add = (ware: string | undefined, count: number | undefined) => {
      if (!ware || !count) return;
      totals.set(ware, (totals.get(ware) ?? 0) + count);
    };
    for (const [ware, count] of Object.entries(ship.cargo)) add(ware, count);
    for (const [ware, count] of Object.entries(site.input)) add(ware, count);
    for (const [ware, count] of Object.entries(site.constructionConsumed ?? {})) add(ware, count);
    for (const [ware, count] of Object.entries(site.inventory)) add(ware, count);
    const roles = [
      { expected: "Builder", tool: "hammer", uid: operation.builder },
      { expected: "Leveler", tool: "shovel", uid: operation.leveler },
      { expected: "Carrier", tool: undefined, uid: operation.carrier }
    ];
    for (const [index, entry] of roles.entries()) {
      const actor = save.actors.find(candidate => candidate.uid === entry.uid);
      if (!actor || crew.has(entry.uid) || actor.building !== operation.siteUid ||
        actor.home !== operation.siteUid || actor.navalOrder !== undefined ||
        (operation.stage !== "landing" && index < 2 && actor.phase !== "retired" && actor.tool !== entry.tool) ||
        (index === 2 && actor.phase !== "retired" && actor.job !== "Carrier"))
        return "Invalid founding crew";
      if (actor.phase !== "retired") add(actor.ware ?? undefined, actor.wareUnits ?? 1);
      if (actor.tool) add(actor.tool, 1);
      crew.add(entry.uid);
    }
    for (const [ware, count] of totals) if (count > (receipt[ware] ?? 0)) return "Invalid founding receipt";
    ships.add(operation.shipId); sites.add(operation.siteUid);
  }
  return null;
};
export const validateNavalState = (value: Record<string, unknown>, ids: Set<number>) => {
  if (
    !isSaveObject(value.naval) ||
    !Array.isArray(value.naval.modes) ||
    !Array.isArray(value.naval.sites) ||
    !Array.isArray(value.naval.active) ||
    !isSaveInteger(value.naval.nextSite, 1) ||
    !isSaveObject(value.naval.fleet) ||
    !Array.isArray(value.naval.fleet.ships) ||
    !Array.isArray(value.naval.fleet.orders) ||
    !isSaveInteger(value.naval.fleet.nextShip, 1) ||
    !isSaveInteger(value.naval.fleet.nextOrder, 1)
  )
    return "Invalid naval state";
  const save = value as unknown as SettlementSaveV1;
  const passengerError = validateNavalPassengers(save);
  if (passengerError) return passengerError;
  const chartingError = validChartedSitesSave((value.naval as Record<string, unknown>).charting, save.world);
  if (chartingError) return chartingError;
  const shippingError = validShippingDemandSave((value.naval as Record<string, unknown>).shipping, ids, save);
  if (shippingError) return shippingError;
  const foundingError = validateFoundingState(save);
  if (foundingError) return foundingError;
  for (const entry of save.naval.modes)
    if (!Array.isArray(entry) || !ids.has(entry[0]) || !["boats", "ships"].includes(entry[1]))
      return "Invalid shipyard mode";
  for (const entry of [...save.naval.sites, ...save.naval.active])
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !isSaveInteger(entry[0]) ||
      !isSaveObject(entry[1]) ||
      !isSaveInteger(entry[1].id, 1) ||
      !ids.has(entry[1].yard) ||
      !isSavePoint(entry[1].land) ||
      !isSavePoint(entry[1].water) ||
      (entry[1].yaw !== undefined && !isFiniteNumber(entry[1].yaw)) ||
      (entry[1].work !== undefined &&
        (!isSaveObject(entry[1].work) ||
          !isSavePoint(entry[1].work.shore) ||
          !isSavePoint(entry[1].work.point) ||
          !isSavePoint(entry[1].work.contact) ||
          !isFiniteNumber(entry[1].work.y) ||
          !isFiniteNumber(entry[1].work.shoreY) ||
          DMath.hypot(
            entry[1].work.point.x - entry[1].work.contact.x,
            entry[1].work.point.z - entry[1].work.contact.z
          ) > 0.6)) ||
      !isSaveInteger(entry[1].steps) ||
      entry[1].steps > SHIPYARD_RECIPES.ships.planks ||
      (entry[1].cloth !== undefined &&
        (!isSaveInteger(entry[1].cloth, 0) || entry[1].cloth > SHIPYARD_RECIPES.ships.cloth))
    )
      return "Invalid ship construction site";
  for (const ship of save.naval.fleet.ships)
    if (
      !isSaveObject(ship) ||
      !isSaveInteger(ship.id, 1) ||
      !isSavePoint(ship) ||
      !isSaveGoods(ship.cargo) ||
      !Array.isArray(ship.route) ||
      !ship.route.every(validRoutePoint) ||
      (ship.retryPhase !== undefined && !["positioning", "sailing"].includes(ship.retryPhase)) ||
      (ship.terrainBlocked !== undefined && typeof ship.terrainBlocked !== "boolean") ||
      (ship.destinationPoolId !== undefined && !isSaveInteger(ship.destinationPoolId)) ||
      (ship.lastHarbourUid !== undefined && !isSaveInteger(ship.lastHarbourUid)) ||
      (ship.reservedFor !== undefined &&
        (!isSaveInteger(ship.reservedFor, -1000000) || ship.reservedFor >= 0)) ||
      (ship.foundingSiteUid !== undefined &&
        (!isSaveInteger(ship.foundingSiteUid, 1) || !ids.has(ship.foundingSiteUid))) ||
      (ship.phase === "founding" && ship.foundingSiteUid === undefined) ||
      !isSaveInteger(ship.cursor) ||
      !["idle", "positioning", "loading", "sailing", "unloading", "stranded", "away", "founding"].includes(
        ship.phase
      ) ||
      // Away: on a colony voyage, a visitor waiting beyond the map edge to come in, or outside a narrow channel.
      (ship.phase === "away" && !ship.colony && !ship.visitor && !ship.outside?.left) ||
      !validShipOutside(ship.outside) ||
      (ship.speed !== undefined && !isFiniteNumber(ship.speed)) ||
      (ship.queuedAt !== undefined && !isSavePoint(ship.queuedAt)) ||
      (ship.ferryAt !== undefined && !isSavePoint(ship.ferryAt)) ||
      (ship.waitsAtEdge !== undefined && (typeof ship.waitsAtEdge !== "boolean" || !ship.queuedAt)) ||
      (ship.visitor?.sourceColony !== undefined && !isSaveInteger(ship.visitor.sourceColony)) ||
      (ship.visitor?.pickupTroops !== undefined &&
        (!Array.isArray(ship.visitor.pickupTroops) || ship.visitor.pickupTroops.length > 40 ||
          new Set(ship.visitor.pickupTroops).size !== ship.visitor.pickupTroops.length ||
          !ship.visitor.pickupTroops.every(id => isSaveInteger(id) &&
            (!save.actors.some(actor => actor.uid === id) ||
              save.military?.soldiers.some(soldier => soldier.actor === id && (soldier.combat?.faction ?? 0) === 0))))) ||
      !validTradeVisitor(ship.visitor) || !validReliefVisitor(ship.visitor, save.world) ||
      !validHandling(ship.handling) || !validLighters(ship.lighters) || !validTransfer(ship.transfer) ||
      !isSaveInteger(ship.cargoCount) ||
      ship.cargoCount !==
        Object.values(ship.cargo).reduce((sum, count) => sum + count, 0) +
          (ship.passengers?.length ?? 0) +
          (ship.troops?.length ?? 0) ||
      !validShipTroops(ship) ||
      ship.cursor > ship.route.length ||
      !isFiniteNumber(ship.timer) ||
      !isFiniteNumber(ship.yaw) ||
      !isFiniteNumber(ship.y)
    )
      return "Invalid ship or held cargo";
  const troopError = validateTroopMissions(save);
  if (troopError) return troopError;
  const shuttleError = validShuttles(save.naval.fleet.shuttles, ids, save);
  if (shuttleError) return shuttleError;
  for (const order of save.naval.fleet.orders)
    if (
      !isSaveObject(order) ||
      !isSaveInteger(order.id, 1) ||
      !ids.has(order.sourceUid) ||
      !ids.has(order.destinationUid) ||
      (order.shipId !== undefined && !isSaveInteger(order.shipId, 1)) ||
      (order.destinationPoolId !== undefined && !isSaveInteger(order.destinationPoolId)) ||
      (order.demand !== undefined && !isSaveGoods(order.demand)) ||
      !isSaveGoods(order.cargo)
    )
      return "Invalid sea transport order";
  const ships = save.naval.fleet.ships,
    orders = save.naval.fleet.orders;
  if (!validNavalBackhaul(ships, orders)) return "Invalid onward ship reservation";
  const preparation = save.naval.preparation;
  for (const entry of preparation?.preparations ?? []) {
    if (entry.shipId === undefined) continue;
    const ship = ships.find(candidate => candidate.id === entry.shipId);
    if (!ship || ship.reservedFor !== -entry.id) return "Invalid expedition ship reservation";
  }
  for (const ship of ships) {
    if (ship.reservedFor === undefined) continue;
    const ownedByPreparation = preparation?.preparations.some(entry =>
      entry.id === -ship.reservedFor! && entry.shipId === ship.id) ?? false;
    const ownedByOrder = orders.some(order => order.shipId === ship.id);
    if (!ownedByPreparation && !ownedByOrder) return "Unowned idle ship reservation";
  }
  for (const order of orders)
    if (order.shipId !== undefined && !ships.some(ship => ship.id === order.shipId))
      return "Order reserves a missing ship";
  if (
    new Set(ships.map((ship) => ship.id)).size !== ships.length ||
    ships.some((ship) => ship.id >= save.naval.fleet.nextShip) ||
    new Set(orders.map((order) => order.id)).size !== orders.length ||
    orders.some((order) => order.id >= save.naval.fleet.nextOrder)
  )
    return "Duplicate or invalid persistent identities";
  return null;
};

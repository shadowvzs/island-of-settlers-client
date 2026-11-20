import { bumpBuildRevision } from "../world/save/world-change-journal";
import { addGood } from "./production-rules";
import { unindexBuilding } from "./settlement-building-index";
import { entrancePath } from "./settlement-entrance";
import { createFoundingCarrier } from "./settlement-founding-carrier";
import { advanceFoundingLanding, createFoundingLanding, type FoundingLanding,foundingLandingFrame } from "./settlement-founding-landing";
import { isOwnBuilding } from "./settlement-home";
import { isFirstSettlementOnLandmass } from "./settlement-landmass";
import { createNavalFleet,type NavalShip } from "./settlement-naval-fleet";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { addIdleSettlers, retirePerson } from "./settlement-population";
import { bumpNavigationRevision } from "./settlement-reservations";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

export interface FoundingOperation {
  shipId: number;
  sourceUid: number;
  siteUid: number;
  builder: number;
  leveler: number;
  carrier: number;
  /** Ship's shore landing, where the carrier receives boxes and returns to. */
  shore: SettlementPoint;
  landing?: FoundingLanding;
  stage: "landing" | "foundation" | "unloading" | "entering";
  blocked?: string;
}
export interface FoundingState {
  operations: FoundingOperation[];
}
/** Time the landed crew may spend walking into the finished harbour before the inside fallback. */
const FOUNDING_ENTER_SECONDS = 10;
interface FoundingHooks {
  fleet: Pick<ReturnType<typeof createNavalFleet>, "addFoundingCargo" | "expeditionShip" |
    "releaseFoundingShip" | "withdrawFoundingCargo">;
  onCompleted?: (building: SettlementBuilding) => void;
}
const cloneOperation = (operation: FoundingOperation): FoundingOperation => ({
  ...operation, shore: { ...operation.shore }, landing: operation.landing && structuredClone(operation.landing)
});
const actorOf = (context: SettlementContext, uid: number) =>
  context.actors.find(actor => actor.uid === uid);
/** The source harbour, else any surviving friendly harbour that can accept the recovered operation. */
const recoveryStorage = (context: SettlementContext, operation: Pick<FoundingOperation, "sourceUid">) =>
  context.buildings.find(building => building.uid === operation.sourceUid && building.construction === 1 &&
    isOwnBuilding(building)) ??
  context.buildings.filter(building => building.typeId === 39 && building.construction === 1 &&
    isOwnBuilding(building)).sort((first, second) => first.uid - second.uid)[0];
const settleActor = (context: SettlementContext, actor: SettlementActor, site: SettlementBuilding,
  enterDeadlines?: Map<number, number>) => {
  enterDeadlines?.delete(actor.uid);
  if (actor.tool) addGood(site.inventory, actor.tool);
  if (actor.ware) addGood(site.inventory, actor.ware, actor.wareUnits ?? 1);
  actor.tool = undefined; actor.ware = null; actor.wareUnits = undefined; actor.wareScale = undefined;
  actor.home = site.uid; actor.building = site.uid;
  actor.phase = "retired"; actor.action = "idle"; actor.visible = false;
  actor.path = []; actor.pathIndex = 0; actor.navalOrder = undefined;
  retirePerson(context, actor);
  addIdleSettlers(context, site);
};
/** Remove an unfinished landing site without refunding anything: its receipts were already moved out. */
const removeFoundingSite = (context: SettlementContext, site: SettlementBuilding) => {
  const { world } = context.options;
  const left = site.x - site.width / 2, top = site.z - site.depth / 2;
  for (let z = top; z < top + site.depth; z++)
    for (let x = left; x < left + site.width; x++)
      context.occupied[z * world.cellsX + x] = 0;
  context.occupied[Math.floor(site.access.z) * world.cellsX + Math.floor(site.access.x)] = 0;
  context.transfers = context.transfers.filter(order => order.source !== site.uid &&
    order.destination !== site.uid);
  context.buildings.splice(context.buildings.indexOf(site), 1);
  unindexBuilding(context, site);
  bumpNavigationRevision(context);
  bumpBuildRevision(world, null);
};
const deliveryRank = (ware: string) => {
  if (ware === "planks") return -1;
  return ware === "stone" ? 0 : 1;
};
const materialOrder = (site: SettlementBuilding) =>
  Object.entries(site.required)
    .sort(([a], [b]) => deliveryRank(a) - deliveryRank(b))
    .map(([ware]) => ware);
const missingMaterial = (site: SettlementBuilding) => materialOrder(site).find(ware =>
  (site.input[ware] ?? 0) + (site.constructionConsumed?.[ware] ?? 0) < (site.required[ware] ?? 0));
const materialsDelivered = (site: SettlementBuilding) => !missingMaterial(site);

/**
 * Physical founding after the ship reaches its shore claim: the carrier ferries the construction
 * receipt from the ship to the site, the Leveler levels the plot, the Builder waits for both, and the
 * ship remains the operation's store until every person, tool and remaining box is ashore.
 */
export const createNavalFounding = (context: SettlementContext, hooks: FoundingHooks) => {
  const operations = new Map<number, FoundingOperation>();
  const landingAttempts = new Map<number, string>();
  /** Entry fallback deadlines; actor.timer is the mover's own blocked clock and must not hold this. */
  const enterDeadlines = new Map<number, number>();
  const siteOf = (operation: FoundingOperation) =>
    context.buildings.find(building => building.uid === operation.siteUid);
  const shipOf = (operation: FoundingOperation) => hooks.fleet.expeditionShip(operation.shipId);
  const setBlocked = (operation: FoundingOperation, reason: string) => {
    const site = siteOf(operation);
    operation.blocked = reason;
    if (site) site.status = `Founding blocked: ${reason}`;
  };
  const landCrew = (operation: FoundingOperation, site: SettlementBuilding,
    ship: NavalShip) => {
    const crew = [operation.builder, operation.leveler, operation.carrier];
    if (crew.some(uid => !actorOf(context, uid))) return false;
    for (const uid of crew) {
      const actor = actorOf(context, uid)!;
      Object.assign(actor, { visible: true, action: "idle",
        home: site.uid, building: site.uid, path: [], pathIndex: 0, navalOrder: undefined });
      actor.phase = "foundingWait";
    }
    const builder = actorOf(context, operation.builder), leveler = actorOf(context, operation.leveler);
    if (!builder || !leveler) return false;
    if (ship.cargo.hammer) {
      ship.cargo.hammer!--;
      if (!ship.cargo.hammer) delete ship.cargo.hammer;
      ship.cargoCount--;
      builder.tool = "hammer";
    }
    if (ship.cargo.shovel) {
      ship.cargo.shovel!--;
      if (!ship.cargo.shovel) delete ship.cargo.shovel;
      ship.cargoCount--;
      leveler.tool = "shovel";
    }
    builder.job = "Builder"; leveler.job = "Leveler";
    const carrier = actorOf(context, operation.carrier);
    if (carrier) carrier.job = "Carrier";
    site.construction = 0;
    site.status = "Founding harbour: preparing the ground";
    if ((site.foundationProgress ?? 0) >= 1) {
      leveler.job = "Settler"; leveler.phase = "foundingWait";
    } else {
      site.worker = leveler.uid;
      const path = groundPath(context, leveler, site.access, site.uid);
      if (path) setActorPath(leveler, path, "assigned");
      else { leveler.phase = "foundingWait"; setBlocked(operation, "no route to the foundation"); }
    }
    // The landed crew left the deck; cargo and tools are the only ship receipts now.
    ship.passengers = [];
    ship.cargoCount = Object.values(ship.cargo).reduce((sum, count) => sum + count, 0);
    return true;
  };
  const { beginCarry, updateCarrier } = createFoundingCarrier(context, {
    missingMaterial, setBlocked, shipOf, withdrawFoundingCargo: hooks.fleet.withdrawFoundingCargo
  });
  const assignBuilder = (operation: FoundingOperation, site: SettlementBuilding) => {
    if ((site.foundationProgress ?? 0) < 1 || !materialsDelivered(site)) return;
    const leveler = actorOf(context, operation.leveler);
    if (leveler?.job === "Leveler") return;
    const builder = actorOf(context, operation.builder);
    if (!builder || builder.phase !== "foundingWait") return;
    site.worker = builder.uid;
    builder.job = "Builder";
    site.status = "Founding harbour: building";
    const path = groundPath(context, builder, site.access, site.uid);
    if (path) setActorPath(builder, path, "assigned");
    else setBlocked(operation, "no builder route to the site");
  };
  const settleCrew = (operation: FoundingOperation, site: SettlementBuilding, dt: number) => {
    const crew = [operation.builder, operation.leveler, operation.carrier];
    let pending = false;
    for (const uid of crew) {
      const actor = actorOf(context, uid);
      if (!actor || actor.phase === "retired") continue;
      if (actor.phase !== "foundingEnter") {
        const left = enterDeadlines.get(uid) ?? FOUNDING_ENTER_SECONDS;
        if (left <= 0) { settleActor(context, actor, site, enterDeadlines); continue; }
        const path = groundPath(context, actor, site.access, site.uid);
        if (path) setActorPath(actor, entrancePath(site), "foundingEnter");
        else { actor.phase = "foundingWait"; actor.path = []; actor.pathIndex = 0; }
        enterDeadlines.set(uid, left - dt);
        pending = true;
        continue;
      }
      if (actor.pathIndex < actor.path.length) {
        moveActor(context, actor, dt);
        const left = (enterDeadlines.get(uid) ?? FOUNDING_ENTER_SECONDS) - dt;
        enterDeadlines.set(uid, left);
        // A crowded doorway must not strand the expedition forever: the fallback is still inside.
        if (left <= 0) settleActor(context, actor, site, enterDeadlines);
        else pending = true;
      }
      else settleActor(context, actor, site, enterDeadlines);
    }
    return pending;
  };
  const finishSettling = (operation: FoundingOperation, site: SettlementBuilding) => {
    const ship = shipOf(operation);
    // Exact founding cargo has no remainder; a partial receipt is still honestly unloaded here.
    if (ship) {
      for (const [ware, count] of Object.entries(ship.cargo))
        if (count > 0) addGood(site.inventory, ware, count);
      ship.cargo = {}; ship.cargoCount = 0;
      hooks.fleet.releaseFoundingShip(operation.shipId);
    }
    operations.delete(operation.shipId);
    hooks.onCompleted?.(site);
    context.naval?.shippingDemandChanged?.(site.uid);
  };
  const finalize = (operation: FoundingOperation, site: SettlementBuilding, dt: number) => {
    if (operation.stage !== "entering") {
      const carrier = actorOf(context, operation.carrier);
      const ship = shipOf(operation);
      if (carrier && ship && (Object.values(ship.cargo).some(count => count > 0) || carrier.ware ||
        ["foundingCargoOut", "foundingCargoBack"].includes(carrier.phase))) {
        operation.stage = "unloading";
        if (!["foundingCarry", "foundingReturn", "foundingCargoOut", "foundingCargoBack"].includes(carrier.phase) && !carrier.ware) beginCarry(operation, site);
        updateCarrier(operation, site, dt);
        return;
      }
      operation.stage = "entering";
    }
    const pending = settleCrew(operation, site, dt);
    if (!pending) finishSettling(operation, site);
  };
  const recoverOrphanedShip = (operation: FoundingOperation, ship: NavalShip) => {
    const storage = recoveryStorage(context, operation);
    if (!storage) { setBlocked(operation, "no recovery storage"); return false; }
    for (const [ware, count] of Object.entries(ship.cargo))
      if (count > 0) addGood(storage.inventory, ware, count);
    ship.cargo = {}; ship.cargoCount = 0;
    // A site lost before evacuation can still own its landed crew. Recover them to the same storage
    // before the operation is removed; never leave people tied to a missing building.
    for (const uid of [operation.builder, operation.leveler, operation.carrier]) {
      const actor = actorOf(context, uid);
      enterDeadlines.delete(uid);
      if (!actor || actor.phase === "retired" || actor.phase === "navalAboard") continue;
      if (actor.tool) addGood(storage.inventory, actor.tool);
      if (actor.ware) addGood(storage.inventory, actor.ware, actor.wareUnits ?? 1);
      Object.assign(actor, { action: "idle", building: storage.uid, demolitionCargo: undefined,
        demolitionReturning: false, home: storage.uid, navalOrder: undefined, path: [], pathIndex: 0,
        phase: "retired", tool: undefined, visible: false, ware: null, wareUnits: undefined });
      retirePerson(context, actor);
      addIdleSettlers(context, storage);
    }
    hooks.fleet.releaseFoundingShip(operation.shipId);
    operations.delete(operation.shipId);
    return true;
  };
  const updateOperation = (operation: FoundingOperation, dt: number) => {
    const site = siteOf(operation);
    const ship = shipOf(operation);
    if (!site) {
      if (ship) recoverOrphanedShip(operation, ship);
      else operations.delete(operation.shipId);
      return;
    }
    if (!ship) { setBlocked(operation, "ship lost"); return; }
    if (operation.stage === "landing") {
      const crew = [operation.builder, operation.leveler, operation.carrier];
      if (!operation.landing) {
        const world = context.options.world;
        const revision = `${world.buildRevision}:${world.terrainRevision}:${context.navigationRevision}`;
        if (landingAttempts.get(ship.id) === revision) return;
        landingAttempts.set(ship.id, revision);
        operation.landing = createFoundingLanding(context, ship, site, crew) ?? undefined;
        if (!operation.landing) { setBlocked(operation, "no safe physical landing pier"); return; }
        operation.shore = { ...operation.landing.pier.shore };
        operation.blocked = undefined;
        site.status = "Founding harbour: landing crew";
      }
      if (!advanceFoundingLanding(context, operation.landing, crew, dt)) return;
      operation.stage = "foundation";
      landCrew(operation, site, ship);
      return;
    }
    if (site.construction >= 1) {
      // The completion tick is the permanent-protection commitment point.
      if (!site.foundingAnchor && isFirstSettlementOnLandmass(context, site))
        site.foundingAnchor = true;
      finalize(operation, site, dt);
      return;
    }
    if (!operation.blocked) updateCarrier(operation, site, dt);
    const leveler = actorOf(context, operation.leveler);
    if (leveler && (leveler.phase === "builderReturnBlocked" || leveler.phase === "foundingWait")) {
      if (leveler.job !== "Leveler") { leveler.phase = "foundingWait"; leveler.path = []; leveler.pathIndex = 0; }
    }
    assignBuilder(operation, site);
  };
  return {
    begin: (shipId: number, siteUid: number, shore: SettlementPoint, passengers: readonly number[]) => {
      const ship = hooks.fleet.expeditionShip(shipId), site = context.buildings.find(building => building.uid === siteUid);
      if (!ship || !site || passengers.length !== 3) return false;
      const [builder, leveler, carrier] = passengers;
      if (builder === undefined || leveler === undefined || carrier === undefined) return false;
      const operation: FoundingOperation = {
        shipId, sourceUid: ship.sourceUid ?? -1, siteUid, builder, leveler, carrier,
        shore: { ...shore }, stage: "landing"
      };
      operations.set(shipId, operation);
      for (const [index, uid] of passengers.entries()) {
        const actor = actorOf(context, uid);
        if (!actor) { operations.delete(shipId); return false; }
        Object.assign(actor, { home: site.uid, building: site.uid, navalOrder: undefined,
          phase: "foundingWait", visible: false, action: "idle",
          job: ["Builder", "Leveler", "Carrier"][index] });
      }
      return true;
    },
    cancelShip: (ship: NavalShip) => {
      const operation = operations.get(ship.id);
      const site = operation && siteOf(operation);
      if (!operation || !site || site.construction >= 1) return false;
      // A lost source harbour falls back to any surviving friendly harbour; without one the operation
      // stays visible with its people, cargo and site intact.
      const source = recoveryStorage(context, { sourceUid: ship.sourceUid ?? operation.sourceUid });
      if (!source) return false;
      operation.sourceUid = source.uid;
      ship.sourceUid = source.uid;
      ship.orderId ??= -1;
      for (const [ware, count] of Object.entries(site.input))
        if (count > 0) hooks.fleet.addFoundingCargo(ship.id, ware, count);
      site.input = {};
      for (const uid of [operation.builder, operation.leveler, operation.carrier]) {
        const actor = actorOf(context, uid);
        enterDeadlines.delete(uid);
        if (!actor) continue;
        if (actor.tool) hooks.fleet.addFoundingCargo(ship.id, actor.tool, 1);
        if (actor.ware) hooks.fleet.addFoundingCargo(ship.id, actor.ware, actor.wareUnits ?? 1);
        actor.tool = undefined; actor.ware = null; actor.wareUnits = undefined;
        Object.assign(actor, { home: source.uid, building: source.uid, phase: "navalAboard",
          visible: true, action: "idle", path: [], pathIndex: 0, navalOrder: ship.orderId });
      }
      ship.passengers = [operation.builder, operation.leveler, operation.carrier];
      ship.cargoCount = Object.values(ship.cargo).reduce((sum, count) => sum + count, 0) +
        ship.passengers.length;
      removeFoundingSite(context, site);
      ship.foundingSiteUid = undefined;
      operations.delete(operation.shipId);
      return true;
    },
    removeSource: (uid: number) => {
      for (const operation of operations.values())
        if (operation.sourceUid === uid) operation.blocked = "source harbour lost";
    },
    retargetSource: (fromUid: number, toUid: number) => {
      for (const operation of operations.values())
        if (operation.sourceUid === fromUid) operation.sourceUid = toUid;
    },
    update: (dt: number) => {
      if (!Number.isFinite(dt) || dt <= 0) return;
      for (const operation of operations.values()) updateOperation(operation, dt);
    },
    landingFrames: () => [...operations.values()].flatMap(operation => {
      const ship = shipOf(operation);
      return ship && operation.landing ? [foundingLandingFrame(operation.shipId, ship, operation.landing)] : [];
    }),
    saveState: (): FoundingState => ({
      operations: [...operations.values()].map(cloneOperation)
    }),
    restore: (saved?: FoundingState) => {
      operations.clear(); landingAttempts.clear();
      for (const operation of saved?.operations ?? [])
        operations.set(operation.shipId, cloneOperation(operation));
    },
    /** Development/diagnostics: the ship and site currently bound to an unfinished founding. */
    settlementFor: (shipId: number) => {
      const operation = operations.get(shipId);
      return operation && { ...operation, shore: { ...operation.shore } };
    }
  };
};

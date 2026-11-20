import { getAuthoredBuildingPlot } from "../../render-common/buildings/building-plot-profile";
import { CATAPULT_HATCH_WELL } from "../../render-common/buildings/catapult-hatch";
import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import {
  appendQueuedKinds, type CatapultAmmoKind, catapultAmmoUnits, compactKindQueue, DEFAULT_CATAPULT_AMMO,
  isCatapultAmmoKind, kindQueueError
} from "./catapult-ammo-kinds";
import { CATAPULT_RESUPPLY_ROOF_ROUTE } from "./catapult-cycle";
import {
  CATAPULT_AMMO_CAPACITY, CATAPULT_ROOF_CAPACITY, catapultRoofStone, placeCatapultRackStone, takeNewestRackStones
} from "./military-catapult-ammo";
import type { SettlementActor } from "./settlement-types";

/** One shared capacity: deliveries, the ground pile, the porter's hands and the roof rack. */
export const CATAPULT_SUPPLY_CAPACITY = CATAPULT_AMMO_CAPACITY;
export const CATAPULT_PORTER_VERTICAL_SPEED = .4;
const STAIR_RISE = CATAPULT_RESUPPLY_ROOF_ROUTE[0][1] * getAuthoredBuildingPlot(16)!.structureScale;
const STAIR_SECONDS = STAIR_RISE / CATAPULT_PORTER_VERTICAL_SPEED;
export const CATAPULT_SUPPLY_SECONDS = Object.freeze({ pickup: .6, "stairs-up": STAIR_SECONDS,
  place: .6, "stairs-down": STAIR_SECONDS });
export type CatapultPorterPhase = "outbound" | "pickup" | "inbound" | "stairs-up" |
  "roof" | "place" | "roof-return" | "stairs-down";
export interface CatapultPorter {
  actor: number;
  carrying: boolean;
  /** A casualty stone being retrieved instead of the entrance pile; removed only after pickup. */
  drop?: number;
  elapsed: number;
  /** Kind of the carried unit; absent for plain stone. */
  kind?: CatapultAmmoKind;
  phase: CatapultPorterPhase;
}
export interface CatapultStoneDrop { kind?: CatapultAmmoKind; x: number; y: number; z: number }
export interface CatapultSupply {
  drops?: CatapultStoneDrop[];
  ground: number;
  /** Oldest-first kinds of the entrance pile (length `ground`); absent while all are plain stone. */
  groundKinds?: CatapultAmmoKind[];
  porter?: CatapultPorter;
  paused?: "threat" | "blocked";
}
interface SupplySite {
  catapultRackKinds?: CatapultAmmoKind[];
  catapultSupply?: CatapultSupply;
  incoming: Record<string, number>;
  input: Record<string, number>;
  uid: number;
  worker?: number;
}
export type CatapultPorterWalk = "outbound" | "inbound" | "roof" | "roof-return";
export interface CatapultSupplyActions {
  /** Called only when safe; must reserve this building's real, employed Carrier. */
  choosePorter: () => number | undefined;
  /** Prepare the real actor's route/visibility. Called once for each phase transition. */
  enterPhase: (porter: CatapultPorter) => void;
  /** Restore the same actor to its indoor workplace, or transfer its cargo to an explicit recovery owner. */
  finish: (porter: CatapultPorter) => void;
  /** Dead, removed or reassigned actors cannot keep advancing a saved hauling reservation. */
  isAvailable: (actor: number) => boolean;
  /** Stairs hold the porter hidden until the launcher is parked clear of the hatch and route. */
  roofSafe?: () => boolean;
  /** Must move the real actor; a blocked route returns false, regardless of elapsed time. */
  walk: (phase: CatapultPorterWalk, dt: number) => boolean;
}

export const catapultCarriedStone = (site: Pick<SupplySite, "catapultSupply">) =>
  Number(site.catapultSupply?.porter?.carrying === true);
export const catapultGroundStone = (site: Pick<SupplySite, "catapultSupply">) =>
  (site.catapultSupply?.ground ?? 0) + (site.catapultSupply?.drops?.length ?? 0);
export const catapultCarriedKind = (porter: CatapultPorter | undefined) =>
  porter?.carrying ? porter.kind ?? DEFAULT_CATAPULT_AMMO : undefined;
export const catapultLocalStone = (site: SupplySite) =>
  catapultRoofStone(site) + catapultGroundStone(site) + catapultCarriedStone(site);
/** Empties the pile and drops, e.g. when a demolished tower's ammunition is salvaged. */
export const clearCatapultGround = (supply: CatapultSupply) => {
  supply.ground = 0; supply.drops = []; delete supply.groundKinds;
};
const pushGroundKinds = (supply: CatapultSupply, kind: CatapultAmmoKind, units: number) => {
  const queue = appendQueuedKinds(supply.groundKinds, supply.ground, kind, units);
  if (queue) supply.groundKinds = queue;
  supply.ground += units;
};
/** FIFO: the porter always takes the oldest pile unit, so stock from before a switch fires first. */
const takeOldestGroundKind = (supply: CatapultSupply) => {
  const kind = supply.groundKinds?.shift() ?? DEFAULT_CATAPULT_AMMO;
  if (!compactKindQueue(supply.groundKinds)) delete supply.groundKinds;
  supply.ground--;
  return kind;
};
/** Older saves stored all six upstairs. Preserve every unit, reserving room for an existing porter. */
export const normalizeCatapultRoofStock = (site: SupplySite) => {
  const roofSpace = CATAPULT_ROOF_CAPACITY - catapultCarriedStone(site);
  const excess = Math.max(0, catapultRoofStone(site) - roofSpace);
  if (!excess) return;
  const supply = site.catapultSupply ??= { ground: 0 };
  for (const kind of takeNewestRackStones(site, excess)) pushGroundKinds(supply, kind, 1);
};
export const catapultStoneDemand = (site: SupplySite) =>
  Math.max(0, CATAPULT_SUPPLY_CAPACITY - catapultLocalStone(site) - catapultAmmoUnits(site.incoming));
export const isCatapultPorter = (site: Pick<SupplySite, "catapultSupply"> | undefined, actor: number) =>
  site?.catapultSupply?.porter?.actor === actor;
export const isCatapultPorterOutside = (phase: CatapultPorterPhase) =>
  phase === "outbound" || phase === "pickup" || phase === "inbound";
const HATCH_SWING_SECONDS = .35;
// Close only after the full body is below the swinging lid, not merely below the floor.
const HATCH_DESCENT_CLEAR = (WORKER_HEIGHT + (CATAPULT_HATCH_WELL.top + .04) *
  getAuthoredBuildingPlot(16)!.structureScale + .05) / CATAPULT_PORTER_VERTICAL_SPEED;
export const catapultHatchOpening = (porter?: CatapultPorter) => {
  if (!porter) return 0;
  if (porter.phase === "stairs-up") return Math.min(1, porter.elapsed / HATCH_SWING_SECONDS);
  if (porter.phase === "roof") return Math.max(0, 1 - porter.elapsed / HATCH_SWING_SECONDS);
  if (porter.phase === "stairs-down") return Math.max(0, Math.min(1, porter.elapsed / HATCH_SWING_SECONDS,
    (HATCH_DESCENT_CLEAR + HATCH_SWING_SECONDS - porter.elapsed) / HATCH_SWING_SECONDS));
  return 0;
};
export const catapultRoofReserved = (site: Pick<SupplySite, "catapultSupply">) => {
  const porter = site.catapultSupply?.porter, phase = porter?.phase;
  return phase === "stairs-up" || phase === "roof" || phase === "place" || phase === "roof-return" ||
    (phase === "stairs-down" && (catapultPorterStairPose(porter!).visible || catapultHatchOpening(porter) > 0));
};
/** Only the final ascent/initial descent is visible above the real cutout; the deck occludes the rest. */
export const catapultPorterStairPose = (porter: CatapultPorter) => {
  const duration = CATAPULT_SUPPLY_SECONDS["stairs-up"], t = Math.max(0, Math.min(1, porter.elapsed / duration));
  const progress = porter.phase === "stairs-down" ? 1 - t : t;
  const height = STAIR_RISE * progress;
  return { height, visible: height + WORKER_HEIGHT > STAIR_RISE + 1e-9 };
};

/** The caller settles its incoming reservation separately, as for other carrier deliveries. */
export const depositCatapultGroundStone = (
  site: SupplySite, units: number, kind: CatapultAmmoKind = DEFAULT_CATAPULT_AMMO
) => {
  if (!Number.isSafeInteger(units) || units <= 0) return 0;
  const accepted = Math.min(units, Math.max(0, CATAPULT_SUPPLY_CAPACITY - catapultLocalStone(site)));
  if (!accepted) return 0;
  pushGroundKinds(site.catapultSupply ??= { ground: 0 }, kind, accepted);
  return accepted;
};

/** A removed porter's hands release their real stone where the casualty happened. */
export const dropCatapultStone = (
  site: SupplySite, point: { x: number; y: number; z: number }, kind: CatapultAmmoKind = DEFAULT_CATAPULT_AMMO
) => {
  if (![point.x, point.y, point.z].every(Number.isFinite) || catapultLocalStone(site) >= CATAPULT_SUPPLY_CAPACITY)
    return false;
  const supply = site.catapultSupply ??= { ground: 0 };
  const drop: CatapultStoneDrop = { x: point.x, y: point.y, z: point.z };
  if (kind !== DEFAULT_CATAPULT_AMMO) drop.kind = kind;
  (supply.drops ??= []).push(drop);
  return true;
};

/** No stock mutation: the returned cargo must be recovered or destroyed explicitly by its caller. */
export const detachCatapultPorter = (site: Pick<SupplySite, "catapultSupply">) => {
  const porter = site.catapultSupply?.porter;
  if (site.catapultSupply) delete site.catapultSupply.porter;
  return porter;
};

/** A full-time employee is admitted through the ordinary workforce/door pipeline, never synthesized. */
export const chooseCatapultPorter = (
  site: SupplySite, actorById: (id: number) => SettlementActor | undefined
) => {
  const actor = site.worker === undefined ? undefined : actorById(site.worker);
  if (!actor || actor.uid !== site.worker || actor.building !== site.uid || actor.job !== "Carrier" ||
    actor.phase !== "inside" || actor.visible || actor.ware || actor.delivery || actor.handcart ||
    actor.demolitionReturning || actor.navalOrder !== undefined) return undefined;
  return actor.uid;
};

const changePhase = (porter: CatapultPorter, phase: CatapultPorterPhase, actions: CatapultSupplyActions) => {
  porter.phase = phase; porter.elapsed = 0; actions.enterPhase(porter);
};
const finishPorter = (site: SupplySite, actions: CatapultSupplyActions) => {
  const porter = detachCatapultPorter(site);
  if (porter) actions.finish(porter);
};
const finishTimedPhase = (site: SupplySite, porter: CatapultPorter, actions: CatapultSupplyActions) => {
  if (porter.phase === "pickup") {
    const supply = site.catapultSupply!;
    let kind: CatapultAmmoKind;
    if (porter.drop !== undefined) {
      if (!supply.drops?.[porter.drop]) { changePhase(porter, "inbound", actions); return; }
      kind = supply.drops.splice(porter.drop, 1)[0]!.kind ?? DEFAULT_CATAPULT_AMMO; delete porter.drop;
    } else {
      if (supply.ground < 1) { changePhase(porter, "inbound", actions); return; }
      kind = takeOldestGroundKind(supply);
    }
    porter.carrying = true;
    if (kind !== DEFAULT_CATAPULT_AMMO) porter.kind = kind;
    changePhase(porter, "inbound", actions); return;
  }
  if (porter.phase === "stairs-up") { changePhase(porter, "roof", actions); return; }
  if (porter.phase === "place") {
    // Ownership crosses exactly once, after the real carrier has reached the rack and put it down.
    placeCatapultRackStone(site, porter.kind); porter.carrying = false; delete porter.kind;
    changePhase(porter, "roof-return", actions); return;
  }
  finishPorter(site, actions);
};

/**
 * Advances one real hauling actor. Timers never complete a walk or create ammunition. Outdoor
 * actors use normal civilian traffic; movement/visibility and casualty salvage belong to the adapter.
 */
export const advanceCatapultResupply = (
  site: SupplySite, dt: number, threatened: boolean, actions: CatapultSupplyActions
) => {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const supply = site.catapultSupply;
  if (!supply) return;
  const porter = supply.porter;
  if (!porter) {
    delete supply.paused;
    if (catapultGroundStone(site) < 1 || catapultRoofStone(site) >= CATAPULT_ROOF_CAPACITY) return;
    if (threatened) { supply.paused = "threat"; return; }
    const actor = actions.choosePorter();
    if (actor === undefined) return;
    supply.porter = { actor, carrying: false, elapsed: 0, phase: "outbound" };
    if (supply.drops?.length) supply.porter.drop = 0;
    actions.enterPhase(supply.porter); return;
  }
  if (!actions.isAvailable(porter.actor)) { finishPorter(site, actions); return; }
  if (supply.paused === "threat" && !threatened) delete supply.paused;
  if (threatened && (porter.phase === "outbound" || porter.phase === "pickup")) {
    supply.paused = "threat";
    changePhase(porter, "inbound", actions); return;
  }
  if (porter.phase === "outbound" || porter.phase === "inbound" ||
    porter.phase === "roof" || porter.phase === "roof-return") {
    if (porter.phase === "roof") porter.elapsed = Math.min(60, porter.elapsed + dt);
    if (!actions.walk(porter.phase, dt)) return;
    if (porter.phase === "outbound") { changePhase(porter, "pickup", actions); return; }
    if (porter.phase === "roof") { changePhase(porter, "place", actions); return; }
    if (porter.phase === "roof-return") { changePhase(porter, "stairs-down", actions); return; }
    if (porter.carrying) { changePhase(porter, "stairs-up", actions); return; }
    finishPorter(site, actions); return;
  }
  if ((porter.phase === "stairs-up" || porter.phase === "place") &&
    catapultRoofStone(site) >= CATAPULT_ROOF_CAPACITY) return;
  if (porter.phase === "stairs-up" && actions.roofSafe && !actions.roofSafe()) return;
  porter.elapsed = Math.min(CATAPULT_SUPPLY_SECONDS[porter.phase], porter.elapsed + dt);
  if (porter.elapsed >= CATAPULT_SUPPLY_SECONDS[porter.phase]) finishTimedPhase(site, porter, actions);
};

const PORTER_PHASES: readonly string[] = ["outbound", "pickup", "inbound", "stairs-up", "roof", "place",
  "roof-return", "stairs-down"];
const integerStock = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const savedPorterError = (supply: CatapultSupply) => {
  const porter = supply.porter;
  if (porter === undefined) return undefined;
  if (!porter || typeof porter !== "object" || !integerStock(porter.actor) ||
    !PORTER_PHASES.includes(porter.phase) || typeof porter.carrying !== "boolean" ||
    !Number.isFinite(porter.elapsed) || porter.elapsed < 0) return "Invalid catapult porter";
  if (porter.kind !== undefined && (!isCatapultAmmoKind(porter.kind) || porter.kind === DEFAULT_CATAPULT_AMMO ||
    !porter.carrying)) return "Invalid catapult porter ammo kind";
  if (porter.drop !== undefined && (!integerStock(porter.drop) || !supply.drops?.[porter.drop] ||
    porter.carrying || !isCatapultPorterOutside(porter.phase))) return "Invalid catapult pickup drop";
  const carryingRequired = porter.phase === "stairs-up" || porter.phase === "roof" || porter.phase === "place";
  const emptyRequired = porter.phase === "outbound" || porter.phase === "pickup" ||
    porter.phase === "roof-return" || porter.phase === "stairs-down";
  if ((carryingRequired && !porter.carrying) || (emptyRequired && porter.carrying))
    return "Invalid catapult porter cargo";
  const duration = CATAPULT_SUPPLY_SECONDS[porter.phase as keyof typeof CATAPULT_SUPPLY_SECONDS];
  if ((duration !== undefined && porter.elapsed > duration) || (duration === undefined && (porter.phase === "roof" ? porter.elapsed > 60 : porter.elapsed !== 0)))
    return "Invalid catapult porter timer";
  return undefined;
};

/** Validate before restoring; legacy towers without this field retain their existing roof stock. */
export const catapultSupplyError = (saved: unknown, roof: number, incoming: number): string | undefined => {
  if (saved === undefined) return undefined;
  if (!saved || typeof saved !== "object") return "Invalid catapult supply";
  const supply = saved as CatapultSupply, porter = supply.porter;
  if (supply.paused !== undefined && !["threat", "blocked"].includes(supply.paused))
    return "Invalid catapult resupply pause";
  if (!integerStock(supply.ground) || !integerStock(roof) || !integerStock(incoming))
    return "Invalid catapult stone stock";
  if (supply.drops !== undefined && (!Array.isArray(supply.drops) || supply.drops.some(drop =>
    !drop || typeof drop !== "object" || ![drop.x, drop.y, drop.z].every(Number.isFinite) ||
    (drop.kind !== undefined && (!isCatapultAmmoKind(drop.kind) || drop.kind === DEFAULT_CATAPULT_AMMO)))))
    return "Invalid catapult stone drops";
  const orderError = kindQueueError(supply.groundKinds, supply.ground);
  if (orderError) return orderError;
  const porterError = savedPorterError(supply);
  if (porterError) return porterError;
  if (supply.ground + (supply.drops?.length ?? 0) + Number(porter?.carrying === true) + roof + incoming >
    CATAPULT_SUPPLY_CAPACITY)
    return "Catapult stone stock exceeds capacity";
  return undefined;
};

/** The saved reservation and visible cargo belong to the normal building worker, never a soldier. */
export const catapultPorterReferencesError = (
  site: SupplySite, actor: SettlementActor | undefined
): string | undefined => {
  const porter = site.catapultSupply?.porter;
  if (!porter) return undefined;
  if (!actor || actor.uid !== porter.actor || site.worker !== actor.uid ||
    actor.building !== site.uid || actor.job !== "Carrier" || actor.delivery || actor.handcart ||
    actor.demolitionReturning || actor.navalOrder !== undefined)
    return "Invalid catapult porter identity";
  const outside = isCatapultPorterOutside(porter.phase);
  const onRoof = porter.phase === "roof" || porter.phase === "place" || porter.phase === "roof-return";
  const onStairs = porter.phase === "stairs-up" || porter.phase === "stairs-down";
  const visible = outside || onRoof || (onStairs && catapultPorterStairPose(porter).visible);
  let phase = "catapultResupply";
  if (porter.phase === "outbound") phase = "inputApproach";
  if (porter.phase === "pickup") phase = "inputPickup";
  if (porter.phase === "inbound") phase = "inputReturn";
  if (actor.phase !== phase || actor.visible !== visible) return "Invalid catapult porter location";
  if (actor.ware !== (catapultCarriedKind(porter) ?? null) ||
    (porter.carrying && actor.wareUnits !== undefined && actor.wareUnits !== 1))
    return "Invalid catapult porter carried stone";
  return undefined;
};

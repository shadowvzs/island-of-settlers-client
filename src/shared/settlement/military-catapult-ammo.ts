import {
  appendQueuedKinds, CATAPULT_AMMO_KINDS, type CatapultAmmoKind, catapultAmmoUnits, compactKindQueue,
  DEFAULT_CATAPULT_AMMO, isCatapultAmmoKind
} from "./catapult-ammo-kinds";

/** Pure ownership only: positioning, gravity and completed hand contacts belong to the crew adapter. */
export const CATAPULT_AMMO_CAPACITY = 6;
/** Includes the engine cup and the operator's hands; the remaining site stock stays downstairs. */
export const CATAPULT_ROOF_CAPACITY = 2;
export type CatapultAmmoLocation = "hand" | "cup" | "loose";
/** Building-local model coordinates, before the building's rotation and authored uniform scale. */
export type CatapultAmmoPoint = readonly [number, number, number];
export interface CatapultAmmoReservation {
  ammo?: CatapultAmmoLocation;
  ammoElapsed?: number;
  ammoFloor?: number;
  /** Kind of the reserved unit; absent for plain stone. */
  ammoKind?: CatapultAmmoKind;
  ammoPoint?: CatapultAmmoPoint;
  armHold?: number;
  loadPath?: readonly CatapultAmmoPoint[];
  loadSeconds?: number;
  phase?: string;
  recoveryPath?: readonly CatapultAmmoPoint[];
  recoverySeconds?: number;
  /** Historical pickup source. A later roof delivery may occupy that physical rack slot again. */
  stoneSlot?: number;
}
export interface CatapultAmmoSite {
  catapultCycle?: CatapultAmmoReservation;
  /** Oldest-first kinds of the rack units (reserved unit excluded); absent while all are plain stone. */
  catapultRackKinds?: CatapultAmmoKind[];
  /** Per ammunition kind; includes the reserved unit in hands, in the cup, or loose on/falling from this roof. */
  input: Record<string, number>;
}
export type CatapultAmmoInterruption = "target-lost" | "operator-lost" | "defence";
export type CatapultAmmoRecovery = "cancel" | "finish-load" | "hold-cup" | "drop" | "await-retrieval";

const RACK_SLOTS = Object.freeze(Array.from({ length: CATAPULT_AMMO_CAPACITY + 1 }, (_, count) =>
  Object.freeze(Array.from({ length: count }, (_, slot) => slot))));
const AMMO_PHASES = new Set(["pick", "load", "wind", "clear", "traverse", "fire", "return", "park",
  "ready", "rewind", "loose", "retrieve", "recover-cup", "empty-return"]);
const finitePoint = (point: unknown): point is CatapultAmmoPoint =>
  Array.isArray(point) && point.length === 3 && point.every(value => typeof value === "number" && Number.isFinite(value));
const validDuration = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const clearDrop = (cycle: CatapultAmmoReservation) => {
  delete cycle.ammoPoint; delete cycle.ammoFloor; delete cycle.ammoElapsed;
};

export const catapultReservedAmmo = (site: CatapultAmmoSite) => Number(site.catapultCycle?.ammo !== undefined);
/** Every ammunition unit owned upstairs, whatever its kind. */
export const catapultRoofStone = (site: Pick<CatapultAmmoSite, "input">) => catapultAmmoUnits(site.input);
export const catapultReservedKind = (cycle: CatapultAmmoReservation | undefined): CatapultAmmoKind | undefined =>
  cycle?.ammo === undefined ? undefined : cycle.ammoKind ?? DEFAULT_CATAPULT_AMMO;
export const catapultRackCount = (site: CatapultAmmoSite) =>
  Math.max(0, catapultRoofStone(site) - catapultReservedAmmo(site));
/** Stable contiguous pile: taking the top item never shifts any lower stone to another position. */
export const catapultRackSlots = (site: CatapultAmmoSite): readonly number[] =>
  RACK_SLOTS[Math.min(CATAPULT_ROOF_CAPACITY - catapultReservedAmmo(site), catapultRackCount(site))] ?? RACK_SLOTS[0]!;
export const catapultNextRackSlot = (site: CatapultAmmoSite) => {
  const slot = catapultRackCount(site);
  return catapultRoofStone(site) < CATAPULT_ROOF_CAPACITY ? slot : undefined;
};
export const catapultPickupSlot = (site: CatapultAmmoSite) => {
  const count = catapultRackCount(site);
  return count > 0 ? count - 1 : undefined;
};

const rackUnitsOf = (site: CatapultAmmoSite, kind: CatapultAmmoKind) =>
  Math.max(0, (site.input[kind] ?? 0) - Number(catapultReservedKind(site.catapultCycle) === kind));
/**
 * Rack kinds, oldest first. The saved order is reconciled against the real per-kind roof counts, so a
 * unit removed by generic stock code can never leave a stale entry behind.
 */
export const catapultRackKinds = (site: CatapultAmmoSite): CatapultAmmoKind[] => {
  const left: Partial<Record<CatapultAmmoKind, number>> = {};
  for (const kind of CATAPULT_AMMO_KINDS) left[kind] = rackUnitsOf(site, kind);
  const order: CatapultAmmoKind[] = [];
  for (const kind of site.catapultRackKinds ?? []) {
    if (!left[kind]) continue;
    order.push(kind); left[kind]!--;
  }
  for (const kind of CATAPULT_AMMO_KINDS) for (let unit = 0; unit < left[kind]!; unit++) order.push(kind);
  return order;
};
const storeRackKinds = (site: CatapultAmmoSite, order: CatapultAmmoKind[]) => {
  const compacted = compactKindQueue(order);
  if (compacted) site.catapultRackKinds = compacted;
  else delete site.catapultRackKinds;
};
/** The next rack unit the crew will pick up (old stock first). */
export const catapultNextRackKind = (site: CatapultAmmoSite) => catapultRackKinds(site)[0];
/** Ownership crosses once the porter has put the unit down on the rack, as the newest unit. */
export const placeCatapultRackStone = (site: CatapultAmmoSite, kind: CatapultAmmoKind = DEFAULT_CATAPULT_AMMO) => {
  const order = catapultRackKinds(site);
  site.input[kind] = (site.input[kind] ?? 0) + 1;
  storeRackKinds(site, appendQueuedKinds(order, order.length, kind, 1) ?? order);
};
/** Takes the newest rack units first: used only when legacy roof stock must move back downstairs. */
export const takeNewestRackStones = (site: CatapultAmmoSite, requested: number) => {
  const order = catapultRackKinds(site), taken = order.splice(Math.max(0, order.length - requested));
  for (const kind of taken) site.input[kind] = (site.input[kind] ?? 0) - 1;
  storeRackKinds(site, order);
  return taken;
};
/** Outgoing couriers can withdraw rack stones; the engine/crew reservation never leaves with them. */
export const catapultOutgoingStone = (site: CatapultAmmoSite, ware: string = DEFAULT_CATAPULT_AMMO) =>
  isCatapultAmmoKind(ware) ? rackUnitsOf(site, ware) : 0;
export const withdrawCatapultRoofStone = (
  site: CatapultAmmoSite, requested: number, ware: CatapultAmmoKind = DEFAULT_CATAPULT_AMMO
) => {
  if (!Number.isSafeInteger(requested) || requested <= 0) return 0;
  const accepted = Math.min(requested, catapultOutgoingStone(site, ware));
  if (!accepted) return 0;
  const order = catapultRackKinds(site);
  for (let unit = 0; unit < accepted; unit++) order.splice(order.lastIndexOf(ware), 1);
  site.input[ware] = (site.input[ware] ?? 0) - accepted;
  storeRackKinds(site, order);
  return accepted;
};

/** Actual rack pickup completion reserves the oldest unit; its total roof ownership is not debited here. */
export const reserveRackStone = (site: CatapultAmmoSite) => {
  const cycle = site.catapultCycle, slot = catapultPickupSlot(site);
  if (!cycle || cycle.ammo !== undefined || slot === undefined) return false;
  const order = catapultRackKinds(site), kind = order.shift() ?? DEFAULT_CATAPULT_AMMO;
  cycle.ammo = "hand"; cycle.stoneSlot = slot; clearDrop(cycle);
  if (kind === DEFAULT_CATAPULT_AMMO) delete cycle.ammoKind;
  else cycle.ammoKind = kind;
  storeRackKinds(site, order);
  return true;
};
/** An early-cancelled pickup puts the reserved unit back as the oldest rack unit. */
export const unreserveRackStone = (site: CatapultAmmoSite) => {
  const cycle = site.catapultCycle, kind = catapultReservedKind(cycle);
  if (!cycle || !kind) return false;
  const order = catapultRackKinds(site);
  delete cycle.ammo; delete cycle.ammoKind;
  storeRackKinds(site, [kind, ...order]);
  return true;
};
/** Actual cup putdown completion. A dead/departed target does not undo a physical load. */
export const loadReservedStone = (site: CatapultAmmoSite) => {
  const cycle = site.catapultCycle;
  if (cycle?.ammo !== "hand") return false;
  cycle.ammo = "cup"; clearDrop(cycle);
  return true;
};
/** A lost operator drops its hand-held item at the supplied actual local point, never at the rack. */
export const dropReservedStone = (
  site: CatapultAmmoSite, point: CatapultAmmoPoint, floor: number, elapsed = 0
) => {
  const cycle = site.catapultCycle;
  if (cycle?.ammo !== "hand" || !finitePoint(point) || !Number.isFinite(floor) || floor > point[1] ||
    !validDuration(elapsed)) return false;
  cycle.ammo = "loose"; cycle.ammoPoint = [...point]; cycle.ammoFloor = floor; cycle.ammoElapsed = elapsed;
  return true;
};
/** Called only after a replacement has physically reached and picked up the resting dropped unit. */
export const retrieveReservedStone = (site: CatapultAmmoSite) => {
  const cycle = site.catapultCycle;
  if (cycle?.ammo !== "loose") return false;
  cycle.ammo = "hand"; clearDrop(cycle);
  return true;
};
/** Actual projectile release is the only firing debit; a repeated callback cannot spend another item. */
export const releaseReservedStone = (site: CatapultAmmoSite) => {
  const cycle = site.catapultCycle, kind = catapultReservedKind(cycle);
  if (cycle?.ammo !== "cup" || !kind || (site.input[kind] ?? 0) < 1) return false;
  site.input[kind] = (site.input[kind] ?? 0) - 1;
  delete cycle.ammo; delete cycle.ammoKind; clearDrop(cycle);
  return true;
};
/** A fall off the roof changes ownership only at the actual ground landing supplied by the adapter. */
export const landReservedStone = (
  site: CatapultAmmoSite, landingPoint: CatapultAmmoPoint,
  receiveAtGround: (point: CatapultAmmoPoint, kind: CatapultAmmoKind) => boolean
) => {
  const cycle = site.catapultCycle, kind = catapultReservedKind(cycle);
  if (cycle?.ammo !== "loose" || !kind || !cycle.ammoPoint || !finitePoint(landingPoint) ||
    (site.input[kind] ?? 0) < 1) return false;
  const point = [...landingPoint] as [number, number, number];
  // Remove roof custody before reception so a single shared capacity does not count it twice.
  const original = { ammoElapsed: cycle.ammoElapsed, ammoFloor: cycle.ammoFloor, ammoPoint: cycle.ammoPoint };
  site.input[kind] = (site.input[kind] ?? 0) - 1; delete cycle.ammo; delete cycle.ammoKind; clearDrop(cycle);
  if (receiveAtGround(point, kind)) return true;
  site.input[kind] = (site.input[kind] ?? 0) + 1; cycle.ammo = "loose";
  if (kind !== DEFAULT_CATAPULT_AMMO) cycle.ammoKind = kind;
  if (original.ammoElapsed !== undefined) cycle.ammoElapsed = original.ammoElapsed;
  if (original.ammoFloor !== undefined) cycle.ammoFloor = original.ammoFloor;
  cycle.ammoPoint = original.ammoPoint;
  return false;
};

/** A recovery decision never moves a stone or advances a walk/timer by itself. */
export const catapultAmmoRecovery = (site: CatapultAmmoSite, reason: CatapultAmmoInterruption): CatapultAmmoRecovery => {
  const ammo = site.catapultCycle?.ammo;
  if (ammo === "cup") return "hold-cup";
  if (ammo === "loose") return "await-retrieval";
  if (ammo === "hand") return reason === "target-lost" ? "finish-load" : "drop";
  return "cancel";
};

/** A safely latched cup at home is stationary roof stock, not an endless block on peaceful hauling. */
export const catapultAmmoAllowsRestock = (site: CatapultAmmoSite, atHome: boolean) => {
  if (!atHome) return false;
  const cycle = site.catapultCycle;
  if (!cycle) return true;
  return cycle.phase === "ready" && cycle.ammo === "cup" && Math.abs((cycle.armHold ?? 1.25) - 1.25) <= 1e-6;
};

export const catapultAmmoPhaseError = (cycle: CatapultAmmoReservation): string | undefined => {
  const phase = cycle.phase;
  if (phase !== undefined && !AMMO_PHASES.has(phase)) return "Invalid catapult ammo phase";
  if (phase === "ready" || phase === "rewind" || phase === "recover-cup")
    return cycle.ammo === "cup" ? undefined : "Catapult cup recovery has no reserved stone";
  if (phase === "loose" || phase === "retrieve")
    return cycle.ammo === "loose" ? undefined : "Catapult drop recovery has no loose stone";
  if (cycle.ammo === "loose") return "Catapult loose stone has no recovery phase";
  // Legacy preparation snapshots have no reservation field. New recovery phases require it above.
  return undefined;
};
const recoveryPathError = (cycle: CatapultAmmoReservation) => {
  for (const key of ["loadPath", "recoveryPath"] as const) {
    const path = cycle[key];
    if (path !== undefined && (!Array.isArray(path) || !path.length || !path.every(finitePoint)))
      return "Invalid catapult recovery path";
  }
  for (const key of ["loadSeconds", "recoverySeconds"] as const)
    if (cycle[key] !== undefined && !validDuration(cycle[key])) return "Invalid catapult recovery duration";
  return undefined;
};
const reservedKindError = (cycle: CatapultAmmoReservation, roofStock: Readonly<Record<string, number>>) => {
  if (cycle.ammoKind !== undefined && (!isCatapultAmmoKind(cycle.ammoKind) ||
    cycle.ammoKind === DEFAULT_CATAPULT_AMMO || cycle.ammo === undefined)) return "Invalid catapult ammo kind";
  const kind = catapultReservedKind(cycle);
  return kind && (roofStock[kind] ?? 0) < 1 ? "Catapult reserved stone is missing" : undefined;
};
/** `roof` is the tower's per-kind roof input, or a plain stone count. */
export const catapultAmmoError = (
  cycle: CatapultAmmoReservation | undefined, roof: number | Readonly<Record<string, number>>
): string | undefined => {
  const roofStock = typeof roof === "number" ? { stone: roof } : roof, units = catapultAmmoUnits(roofStock);
  if (!Number.isSafeInteger(units) || units < 0 || units > CATAPULT_AMMO_CAPACITY) return "Invalid catapult roof stock";
  if (!cycle) return undefined;
  if (cycle.ammo !== undefined && !["hand", "cup", "loose"].includes(cycle.ammo)) return "Invalid catapult ammo owner";
  const kindError = reservedKindError(cycle, roofStock);
  if (kindError) return kindError;
  if (cycle.stoneSlot !== undefined && (!Number.isSafeInteger(cycle.stoneSlot) || cycle.stoneSlot < 0 ||
    cycle.stoneSlot >= CATAPULT_AMMO_CAPACITY)) return "Invalid catapult pickup slot";
  if (cycle.ammoPoint !== undefined && (!finitePoint(cycle.ammoPoint) || cycle.ammo === undefined))
    return "Invalid catapult ammo point";
  if (cycle.ammoElapsed !== undefined && !validDuration(cycle.ammoElapsed)) return "Invalid catapult drop timer";
  if (cycle.ammoFloor !== undefined && !Number.isFinite(cycle.ammoFloor)) return "Invalid catapult drop floor";
  if (cycle.armHold !== undefined && (!Number.isFinite(cycle.armHold) || cycle.armHold < 0 || cycle.armHold > 1.25))
    return "Invalid catapult held arm";
  if (cycle.ammo === "loose" && (!cycle.ammoPoint || cycle.ammoFloor === undefined || cycle.ammoElapsed === undefined ||
    cycle.ammoFloor > cycle.ammoPoint[1])) return "Invalid catapult loose stone";
  return catapultAmmoPhaseError(cycle) ?? recoveryPathError(cycle);
};

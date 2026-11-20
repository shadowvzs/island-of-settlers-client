import { detachCatapultPorter, isCatapultPorter } from "./military-catapult-resupply";
import { addGood, STORAGE_IDS } from "./production-rules";
import { abandonHandcart, loseKilledPullerLoad } from "./settlement-handcart-abandon";
import { findHomeBuilding } from "./settlement-home";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/**
 * The civilian crews MIL-ASSAULT left out (MIL-CREWS, owner 2026-11-09) are raid targets like any
 * other civilian outside: cart crews, boat crews (a Shipwright with a workshop boat),
 * ship crews on land (voyage helpers walking to their harbour) and Catapult roof porters. A Catapult
 * operator is the tower's stationed heavy soldier, so the soldier and siege rules already cover it.
 */
export type CivilianCrew = "boat" | "cart" | "naval" | "roof";

/** Voyage helpers between their storage and the harbour door; later phases are pier, deck or sea. */
const NAVAL_LAND_PHASES: ReadonlySet<string> = new Set(["navalToHarbour", "navalEnterHarbour"]);
/** A Catapult porter on the stairs, the roof or at the rack (out of a field soldier's melee reach). */
export const ROOF_PORTER_PHASE = "catapultResupply";

/** A player person: no soldier, horse, commander, enemy staff or retired record. */
export const isPlayerPerson = (actor: SettlementActor) => actor.phase !== "retired" &&
  actor.job !== "Soldier" && actor.job !== "Mount" && actor.job !== "Commander" &&
  actor.hostileCivilianFaction === undefined;

/** The person works in a crew whose vehicle, voyage or tower owns it. */
export const isCrewMember = (actor: SettlementActor) => actor.handcart !== undefined ||
  actor.navalOrder !== undefined || actor.boatWork !== undefined ||
  actor.phase === ROOF_PORTER_PHASE;

/** The crew a person belongs to while it can be reached on land; undefined otherwise (aboard, at sea). */
export const exposedCrew = (actor: SettlementActor): CivilianCrew | undefined => {
  if (actor.navalOrder !== undefined) return NAVAL_LAND_PHASES.has(actor.phase) ? "naval" : undefined;
  if (actor.handcart) return "cart";
  if (actor.boatWork !== undefined) return "boat";
  return actor.phase === ROOF_PORTER_PHASE ? "roof" : undefined;
};

/** A visible player person raiders may strike: a free civilian on land, or a crew member exposed on land. */
export const isExposedPerson = (actor: SettlementActor) => {
  if (!actor.visible || !isPlayerPerson(actor)) return false;
  if (isCrewMember(actor)) return exposedCrew(actor) !== undefined;
  return !actor.phase.startsWith("naval");
};

/** Crews that run from raiders; roof porters keep the Catapult Tower's own threat rule. */
export const fleesRaiders = (actor: SettlementActor) =>
  isExposedPerson(actor) && !actor.phase.startsWith("founding") && exposedCrew(actor) !== "roof";

/** A crew member leaving a building waits inside while raiders hold the door (not roof porters). */
export const isHeldCrew = (actor: SettlementActor) =>
  isPlayerPerson(actor) && isCrewMember(actor) && actor.phase !== ROOF_PORTER_PHASE;

/** A finished workshop boat in a lost Shipwright's hands is not destroyed: it reaches its storage. */
const keepCarriedBoat = (context: Pick<SettlementContext, "buildings">, actor: SettlementActor) => {
  if (actor.ware !== "boat") return;
  const home = context.buildings.find(building => building.uid === actor.home && STORAGE_IDS.has(building.typeId) &&
    building.construction === 1) ?? findHomeBuilding(context);
  if (home) addGood(home.inventory, "boat");
  actor.ware = null;
};

/**
 * A lost exploration scout's voyage is cancelled (naval-person-release.ts) and the one spyglass the
 * voyage cost goes back to the harbour that paid it (its walk target), whether the scout is killed or
 * runs (a runner parks before any blow, so it must not carry the refund off and die with it).
 */
const refundScoutSpyglass = (context: Pick<SettlementContext, "buildings">, actor: SettlementActor) => {
  if (actor.navalOrder === undefined || actor.job !== "Scout" || actor.tool !== "spyglass") return;
  const harbour = context.buildings.find(building => building.uid === actor.building) ??
    findHomeBuilding(context);
  if (harbour) addGood(harbour.inventory, "spyglass");
  actor.tool = undefined;
};

type CrewContext = Pick<SettlementContext, "abandonedHandcarts" | "actors" | "buildings" | "naval">;

/**
 * Releases what the person's crew owned before it dies (`fled` false) or runs (`fled` true): the cart
 * stops where it stands (a dead puller's bed load is lost with it, also on a cart it parked before it
 * ran; a runner's stays on the bed), a led horse is let go, every voyage list drops the person
 * (the ship stays; an exploration without its scout is cancelled, its spyglass refunded), a dead
 * Shipwright's finished boat is kept, and a Catapult porter's run ends.
 */
export const releaseCrew = (context: CrewContext, actor: SettlementActor, fled: boolean) => {
  if (actor.handcart) abandonHandcart(context, actor);
  if (!fled) loseKilledPullerLoad(context, actor.uid);
  refundScoutSpyglass(context, actor);
  if (actor.navalOrder !== undefined || actor.job === "Shipwright") context.naval?.forgetPerson?.(actor.uid);
  actor.navalOrder = undefined;
  if (actor.boatWork !== undefined && !fled) keepCarriedBoat(context, actor);
  actor.boatWork = undefined;
  for (const site of context.buildings) if (isCatapultPorter(site, actor.uid)) detachCatapultPorter(site);
};

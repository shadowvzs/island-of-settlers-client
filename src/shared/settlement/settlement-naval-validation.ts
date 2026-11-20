import { TROOP_MISSION_NAVAL_ORDER } from "./constants";
import { validateColonyExpeditions } from "./settlement-colony-validation";
import { EXPEDITION_CREW, EXPEDITION_ROLES, expeditionSupplies } from "./settlement-naval-preparation";
import { validateExpeditionPreparations } from "./settlement-naval-preparation-validation";
import type { SettlementSaveV1 } from "./settlement-save-state";

/** Passengers a ship holds: walking to it, aboard, or going ashore from it. */
const SHIP_HELD_PHASES = ["navalFerry",
  "navalToShip", "navalBoarding", "navalDeckWalk", "navalAboard", "navalDisembark",
  "navalLanding", "navalLandingEnter"];

type NavalReceipt = SettlementSaveV1["naval"]["fleet"]["orders" | "ships"][number];
const isTroopShip = (receipt: NavalReceipt) => "troopMission" in receipt && receipt.troopMission !== undefined;
/** The reservation a receipt's passengers carry: a troop ship's mission (MIL-SHIPS-SIM), a ship's order, an order. */
const passengerOrderOf = (receipt: NavalReceipt) => {
  if (isTroopShip(receipt)) return TROOP_MISSION_NAVAL_ORDER;
  return "orderId" in receipt ? receipt.orderId : receipt.id;
};

/** Extra fields are optional for old saves; new passenger receipts must own each actor exactly once. */
export const validateNavalPassengers = (value: SettlementSaveV1): string | null => {
  const held = new Set<number>();
  const preparationError = validateExpeditionPreparations(value, held);
  if (preparationError) return preparationError;
  const colonyError = validateColonyExpeditions(value, held);
  if (colonyError) return colonyError;
  const actorById = new Map(value.actors.map((actor) => [actor.uid, actor]));
  const supplies = expeditionSupplies(value.playerNation ?? "roman");
  for (const receipt of [...value.naval.fleet.orders, ...value.naval.fleet.ships]) {
    if (!receipt || typeof receipt !== "object") return "Invalid naval receipt";
    if (
      receipt.passengers !== undefined &&
      (!Array.isArray(receipt.passengers) || receipt.passengers.length > 40)
    )
      return "Invalid naval passengers";
    for (const uid of receipt.passengers ?? []) {
      const actor = actorById.get(uid);
      const troopShip = isTroopShip(receipt);
      const expectedOrder = passengerOrderOf(receipt);
      if (
        !Number.isSafeInteger(uid) ||
        held.has(uid) ||
        !actor ||
        actor.navalOrder !== expectedOrder ||
        (!["Settler", "Soldier", "Scout", ...EXPEDITION_ROLES].includes(actor.job) &&
          !(actor.job === "Builder" && (receipt.expedition !== undefined ||
            ("cancelled" in receipt && receipt.cancelled && (receipt.cargo.hammer ?? 0) >= 1)))) ||
        actor.ware ||
        (actor.tool && actor.job !== "Soldier" && !(actor.job === "Scout" && actor.tool === "spyglass")) ||
        (!["navalToHarbour", "navalEnterHarbour", "navalWaiting", ...SHIP_HELD_PHASES].includes(actor.phase)) ||
        (SHIP_HELD_PHASES.includes(actor.phase) && !("orderId" in receipt) && !troopShip)
      )
        return "Invalid passenger identity or reservation";
      held.add(uid);
    }
    if (receipt.exploration !== undefined) {
      const exploration = receipt.exploration;
      if (!exploration || !Array.isArray(exploration.points) || exploration.points.length < 1 || exploration.points.length > 4 ||
        !exploration.points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.z) && point.x >= 0 && point.z >= 0 && point.x < value.world.cellsX && point.z < value.world.cellsZ) ||
        !Number.isSafeInteger(exploration.cursor) || exploration.cursor < 0 || exploration.cursor > exploration.points.length ||
        typeof exploration.returning !== "boolean" || (!exploration.returning && exploration.cursor >= exploration.points.length) ||
        receipt.expedition !== undefined || Object.values(receipt.cargo).some(count => count !== 0) ||
        // One scout; none once its voyage lost it (MIL-TWEAKS: cancelled, or ended on the next update).
        (receipt.passengers?.length ?? 0) > 1 || receipt.passengers?.some(uid => actorById.get(uid)?.job !== "Scout" || actorById.get(uid)?.tool !== "spyglass"))
        return "Invalid exploration receipt or scout crew";
    } else if (receipt.passengers?.some(uid => actorById.get(uid)?.job === "Scout")) return "Scout without exploration receipt";
    const expedition = receipt.expedition;
    if (expedition === undefined) continue;
    if (
      !expedition ||
      typeof expedition !== "object" ||
      !receipt.cargo ||
      typeof receipt.cargo !== "object"
    )
      return "Invalid expedition receipts";
    if (
      ![expedition.x, expedition.z, expedition.water?.x, expedition.water?.z].every(
        Number.isFinite
      ) ||
      !Number.isInteger(expedition.rotation) ||
      expedition.rotation < 0 ||
      expedition.rotation > 3 ||
      (receipt.passengers?.length ?? 0) !== EXPEDITION_CREW ||
      Object.entries(supplies).some(
        ([ware, count]) => (receipt.cargo[ware] ?? 0) < count
      )
    )
      return "Invalid expedition receipts";
  }
  for (const actor of value.actors) {
    if (SHIP_HELD_PHASES.includes(actor.phase) &&
      !held.has(actor.uid)) return "Unowned passenger reservation";
    if (actor.navalOrder === undefined) continue;
    if (actor.navalOrder === -1 && ["navalToHarbour", "navalEnterHarbour"].includes(actor.phase))
      continue;
    if (!held.has(actor.uid)) return "Unowned passenger reservation";
  }
  return null;
};

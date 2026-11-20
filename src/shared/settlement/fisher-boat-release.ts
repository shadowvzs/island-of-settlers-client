import { BOAT_WARE } from "./constants";
import { isFisherBoatAfloat } from "./fisher-boat-trip";
import { addGood } from "./production-rules";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";

/**
 * A fisher who leaves a boat trip early (flight, death, demolition): a boat on the head is set down at
 * the feet (the next fisher fetches it); afloat, the fisher rows back to the slot at once and the boat
 * stays parked there; the catch of an unfinished haul is lost (owner answer 5).
 */
export const releaseFisherBoatTrip = (actor: SettlementActor, fishery: SettlementBuilding | undefined) => {
  const trip = actor.boatTrip;
  const boat = fishery?.fisherBoat;
  if (actor.ware === BOAT_WARE && boat?.place === "carried") {
    fishery!.fisherBoat = { ...boat, place: "dropped", x: actor.x, yaw: actor.yaw, z: actor.z };
    actor.ware = null;
  }
  if (trip && isFisherBoatAfloat(actor)) {
    const site = fishery?.boatSite, slot = site?.ok ? site.slots[trip.slot] : undefined;
    if (slot) { actor.x = slot.x; actor.z = slot.z; }
    if (slot && boat?.place === "afloat")
      fishery!.fisherBoat = { place: "slot", slot: trip.slot, x: slot.x, yaw: slot.yaw, z: slot.z };
    actor.visible = true;
  }
  if (!trip) return;
  actor.boatTrip = undefined; actor.stockBuilding = undefined;
  if (actor.target?.kind === "fish" && actor.target.id === -1) actor.target = undefined;
};

/** A removed Fishery's boat outside its yard goes to storage like its yard boat (a carried one travels on). */
export const recoverFisherBoat = (removed: SettlementBuilding) => {
  const boat = removed.fisherBoat;
  if (!boat) return;
  if (boat.place !== "carried") addGood(removed.inventory, BOAT_WARE);
  removed.fisherBoat = undefined;
};

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * Troop ship refusals (MIL-SHIPS-SIM `embarkMilitary`, `sailShip`, `landShipTroops` and their checks). The
 * simulation keeps the English sentence as its answer; the UI translates it where it is shown
 * (`translateShipRefusal`). The ids are domain ids so the translation pass can move them into the canonical domain
 * map together with their Hungarian draft entries.
 */
export const TROOP_SHIP_REFUSALS: Readonly<Record<string, MessageDescriptor>> = {
  "Choose a coast on land": msg({ id: "domain.refusal.troopShip.coastOnLand", message: "Choose a coast on land" }),
  "Choose a point on the map": msg({ id: "domain.refusal.troopShip.pointOnMap", message: "Choose a point on the map" }),
  "Choose one of your finished harbours": msg({
    id: "domain.refusal.troopShip.ownHarbour", message: "Choose one of your finished harbours"
  }),
  "No chosen soldier can board": msg({
    id: "domain.refusal.troopShip.noneCanBoard", message: "No chosen soldier can board"
  }),
  "No chosen soldier can reach the ship": msg({
    id: "domain.refusal.troopShip.noneReachShip", message: "No chosen soldier can reach the ship"
  }),
  "No harbour for a troop ship to call at": msg({
    id: "domain.refusal.troopShip.noPickupHarbour", message: "No harbour for a troop ship to call at"
  }),
  "No deck room for the commander's horse": msg({
    id: "domain.refusal.troopShip.noHorseRoom", message: "No deck room for the commander's horse"
  }),
  "No landing beach here": msg({ id: "domain.refusal.troopShip.noBeach", message: "No landing beach here" }),
  "No landing beach near the soldiers": msg({
    id: "domain.refusal.troopShip.noPickupBeach", message: "No landing beach near the soldiers"
  }),
  "No soldiers chosen": msg({ id: "domain.refusal.troopShip.noSoldiers", message: "No soldiers chosen" }),
  "No such ship": msg({ id: "domain.refusal.troopShip.noShip", message: "No such ship" }),
  "No troop ship can call at the harbour": msg({
    id: "domain.refusal.troopShip.noPickupShip", message: "No troop ship can call at the harbour"
  }),
  "Only a ship carrying or boarding soldiers can sail": msg({
    id: "domain.refusal.troopShip.emptyShip", message: "Only a ship carrying or boarding soldiers can sail"
  }),
  "Ship cannot reach that harbour": msg({
    id: "domain.refusal.troopShip.harbourUnreachable", message: "Ship cannot reach that harbour"
  }),
  "Ship cannot reach that water": msg({
    id: "domain.refusal.troopShip.waterUnreachable", message: "Ship cannot reach that water"
  }),
  "Ship cannot reach the soldiers' coast": msg({
    id: "domain.refusal.troopShip.pickupUnreachable", message: "Ship cannot reach the soldiers' coast"
  }),
  "Soldiers are going ashore": msg({
    id: "domain.refusal.troopShip.goingAshore", message: "Soldiers are going ashore"
  }),
  "That harbour has no berth": msg({ id: "domain.refusal.troopShip.noBerth", message: "That harbour has no berth" }),
  "The harbour berth is busy": msg({ id: "domain.refusal.troopShip.berthBusy", message: "The harbour berth is busy" }),
  "The ship is busy": msg({ id: "domain.refusal.troopShip.shipBusy", message: "The ship is busy" }),
  "The ship is full": msg({ id: "domain.refusal.troopShip.shipFull", message: "The ship is full" }),
  "The ship is not at a harbour": msg({
    id: "domain.refusal.troopShip.notAtHarbour", message: "The ship is not at a harbour"
  }),
  "The ship is under way": msg({ id: "domain.refusal.troopShip.underWay", message: "The ship is under way" })
};

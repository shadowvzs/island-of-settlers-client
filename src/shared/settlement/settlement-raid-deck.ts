import { layoutShipDeck, SHIP_DECK_PERSON_WORLD } from "../../render-common/ships/ship-deck-layout";
import { SAILING_SHIP_SCALE } from "../../render-common/ships/ship-dimensions";
import { DMath } from "../math/deterministic-math";
import type { SettlementPoint } from "./settlement-types";

/** Where a raid ship lies: its keel centre and heading. */
export interface RaidShipPose { x: number; yaw: number; z: number }

/** Deck slots by crew size: the layout is pure, so each size is laid out once. */
const deckSlots = new Map<number, readonly { x: number; y: number; z: number }[]>();
const slotsFor = (count: number) => {
  let slots = deckSlots.get(count);
  if (!slots) { slots = layoutShipDeck(SHIP_DECK_PERSON_WORLD, count, 0).slots; deckSlots.set(count, slots); }
  return slots;
};

/**
 * World places of a raid crew standing on the deck of a ship at `pose` (raider galley deck slots,
 * shared by colony raid ships and coastal raiders). A crew larger than the deck's standing places
 * gets fewer points: the others wait below deck.
 */
export const raidDeckPoints = (pose: RaidShipPose, count: number, seaLevel: number):
  (SettlementPoint & { y: number })[] => {
  const cos = DMath.cos(pose.yaw), sin = DMath.sin(pose.yaw);
  return slotsFor(count).map(slot => ({ x: pose.x + SAILING_SHIP_SCALE * (slot.x * cos + slot.z * sin),
    y: seaLevel + SAILING_SHIP_SCALE * slot.y, z: pose.z + SAILING_SHIP_SCALE * (slot.z * cos - slot.x * sin) }));
};

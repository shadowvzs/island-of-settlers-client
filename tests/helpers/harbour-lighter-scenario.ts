import { dockPorters, lighterCarriers } from "../../src/app/settlement/dock-porters";
import { createHarbourDocks } from "../../src/shared/settlement/settlement-harbour-docks";
import { createNavalFleet, type NavalShip } from "../../src/shared/settlement/settlement-naval-fleet";
import type { Goods } from "../../src/shared/settlement/settlement-types";
import { createShipSea, SHIP_TICK } from "./ship-motion-scenarios";

/**
 * NAV-03 lighter scenario: `ships` loaded ships arrive at once at a harbour with two berths (level 3) that stores
 * `boats` boats and has idle settlers to row them: own ships (40 stone each) lying near the harbour, or
 * visitors (`load` each) sailing in from beyond the map edge.
 */
export interface LighterScenarioOptions {
  boats: number;
  /** Idle settlers of the harbour (rowers); 0 = no lighters, the piers alone. */
  idle?: number;
  load?: Goods;
  ships: number;
  visitors?: boolean;
}
export interface LighterScenarioResult {
  /** Seconds until every load is in the harbour's storage (Infinity when it never is). */
  seconds: number;
  /** Longest a ship waited off the harbour (queued) before its cargo was being worked. */
  longestWait: number;
  /** Mean of that wait over the ships; most ships waiting in sight near the harbour at once, and the seconds
   * per ship spent waiting there (queued off the harbour, not at the map edge or beyond it). */
  averageWait: number;
  mostVisibleWaiting: number;
  visibleWait: number;
  /** Most ships worked by lighters at once, and most lighters out at once. */
  mostLightered: number;
  mostBoats: number;
  /** Ticks with a lighter carrier closer than PERSON_GAP to a pier porter, or to another carrier. */
  porterContacts: number;
  carrierContacts: number;
  /** Harbour stock of the load's wares at the end, and the wares still aboard any ship. */
  delivered: Goods;
  aboard: Goods;
}

/** Two people closer than this (tiles) would walk into each other (the passengers' own blocking distance). */
const PERSON_GAP = .28;
const IDLE_SETTLERS = 12;
const OWN_LOAD: Goods = { stone: 40 };
const VISITOR_LOAD: Goods = { stone: 132 };

const ownShip = (id: number, harbourUid: number, z: number, load: Goods): NavalShip => ({
  cargo: { ...load }, cargoCount: Object.values(load).reduce((sum, count) => sum + count, 0), cursor: 0, destinationUid: harbourUid, id, phase: "sailing", route: [],
  sourceUid: harbourUid, speed: 0, timer: 0, x: 42.5, y: -1, yaw: 0, z });

export const createLighterScenario = (
  { boats, idle = IDLE_SETTLERS, load, ships, visitors }: LighterScenarioOptions
) => {
  // Visitors bring 132 stone each, own ships 40 unless the scenario says otherwise.
  const cargo = load ?? (visitors ? VISITOR_LOAD : OWN_LOAD);
  const sea = createShipSea(), harbour = sea.harbour(60, 15, 0, 2);
  harbour.inventory = { boat: boats };
  harbour.idleSettlers = idle;
  sea.context.settlers = idle;
  const fleet = createNavalFleet(sea.context, sea.sea);
  if (visitors) for (let ship = 0; ship < ships; ship++) fleet.sendVisitor(harbour.uid, { ...cargo }, [], "reward");
  else fleet.restore({ nextOrder: 1, nextShip: ships + 1, orders: [],
    ships: Array.from({ length: ships }, (_, ship) => ownShip(ship + 1, harbour.uid, 14.5 + ship * 12, cargo)) });
  const target = Object.entries(cargo).map(([ware, count]) => [ware, count * ships] as const);
  return { fleet, harbour, sea, target };
};

const contacts = (people: readonly { uid: number; x: number; z: number }[], carriers: ReadonlySet<number>) => {
  let porter = false, carrier = false;
  for (const person of people) {
    if (!carriers.has(person.uid)) continue;
    for (const other of people) {
      if (other === person || Math.hypot(other.x - person.x, other.z - person.z) >= PERSON_GAP) continue;
      if (carriers.has(other.uid)) carrier = true; else porter = true;
    }
  }
  return { carrier, porter };
};

/** Runs the scenario until every load is stored (or `limit` seconds), measuring waits and crowding. */
export const runLighterScenario = (options: LighterScenarioOptions, limit = 3600): LighterScenarioResult => {
  const { fleet, harbour, sea, target } = createLighterScenario(options), docks = createHarbourDocks(sea.context);
  const waits = new Map<number, number>();
  let time = 0, mostLightered = 0, mostBoats = 0, porterContacts = 0, carrierContacts = 0, mostVisibleWaiting = 0,
    visibleWait = 0;
  const done = () => target.every(([ware, count]) => (harbour.inventory[ware] ?? 0) >= count);
  for (; time < limit && !done(); time += SHIP_TICK) {
    fleet.update(SHIP_TICK);
    for (const ship of fleet.saveState().ships) if (ship.queuedAt || ship.phase === "away")
      waits.set(ship.id, (waits.get(ship.id) ?? 0) + SHIP_TICK);
    const inSight = fleet.saveState().ships.filter(ship =>
      ship.queuedAt !== undefined && !ship.waitsAtEdge && ship.phase !== "away").length;
    mostVisibleWaiting = Math.max(mostVisibleWaiting, inSight);
    visibleWait += inSight * SHIP_TICK;
    const frames = fleet.frames(), lightered = frames.filter(frame => frame.lighterWork);
    mostLightered = Math.max(mostLightered, lightered.length);
    mostBoats = Math.max(mostBoats, lightered.reduce((sum, frame) => sum + frame.lighterWork!.plan.lighters, 0));
    const carriers = lighterCarriers(sea.world, frames);
    if (!carriers.length) continue;
    const met = contacts([...dockPorters(sea.world, docks(fleet.snapshot(), frames)), ...carriers],
      new Set(carriers.map(carrier => carrier.uid)));
    if (met.porter) porterContacts++;
    if (met.carrier) carrierContacts++;
  }
  const aboard: Goods = {};
  for (const ship of fleet.saveState().ships) for (const [ware, count] of Object.entries(ship.cargo))
    aboard[ware] = (aboard[ware] ?? 0) + count;
  const delivered = Object.fromEntries(target.map(([ware]) => [ware, harbour.inventory[ware] ?? 0]));
  const waited = [...waits.values()];
  return { aboard, averageWait: waited.reduce((sum, wait) => sum + wait, 0) / Math.max(1, options.ships), carrierContacts,
    delivered, longestWait: Math.max(0, ...waited), mostBoats, mostLightered, mostVisibleWaiting, porterContacts,
    seconds: done() ? time : Infinity, visibleWait: visibleWait / Math.max(1, options.ships) };
};

import { shipDeckCapacity } from "@shared/catalog";

import {
  BOARDING_SECONDS_PER_PASSENGER, COLONY_DIFFICULTIES, COLONY_ISLAND_OFFERS, COLONY_VOYAGE_SECONDS, COLONY_VOYAGE_SPREAD_SECONDS, MINIMUM_LOADING_SECONDS
} from "../balance/colonies";
import { type ColonyResourceTier,selectColonyResourceTier } from "../world/colony-resource-tiers";
import type { DebugTimedIsland } from "./expedition-debug-rules";
import { discoverIslandClimate, type DiscoveryCalendar, type ExpeditionTheme, type IslandDiscovery } from "./island-discovery-policy";
import {
  isOrdinaryTroopType, type MilitaryTroopType, ORDINARY_TROOP_TYPES
} from "./military-combat-rules";
import type { Goods } from "./settlement-types";
import { wareBoxUnits } from "./ship-cargo-boxes";
import { planCargoHandling, TYPICAL_PORTER_ROUTE } from "./ship-cargo-handling";
import { shipTravelSeconds } from "./ship-travel-time";

/** One full sailing-ship deck (catalog `ship:sailingShip` capacity). */
const { boxes: SHIP_DECK_BOXES, passengers: SHIP_DECK_SOLDIERS } = shipDeckCapacity();

export type ColonyDifficulty = "easy" | "medium" | "hard";
export type ColonyTroops = Readonly<Record<MilitaryTroopType, number>>;
export interface ColonyDifficultyRule {
  enemyBuildings: number;
  enemyTroops: number;
  troopCap: number;
}

/** Troops a new colony or adventure expedition may select; ordinary cavalry is retired. */
export const COLONY_TROOP_TYPES: readonly MilitaryTroopType[] = ORDINARY_TROOP_TYPES;
export type ColonyOre = "coal" | "goldOre" | "ironOre" | "stone";
export interface ColonyIsland extends DebugTimedIsland {
  id: number;
  name: string;
  difficulty: ColonyDifficulty;
  /** The only ore its mountain holds; shown as the colony's ware icon. */
  ore: ColonyOre;
  seed: number;
  voyageSeconds: number;
  theme?: ExpeditionTheme;
  discovery?: IslandDiscovery;
  resourceTier?: ColonyResourceTier;
}
// Common deck unit: one soldier slot equals 33 units and one box 16, so a full deck is 528.
const SLOT_UNITS = SHIP_DECK_BOXES;
const BOX_UNITS = SHIP_DECK_SOLDIERS;
const DECK_UNITS = SHIP_DECK_SOLDIERS * SHIP_DECK_BOXES;

/** One passenger or one box of a single ware type, in deck units. */
export interface ColonyDeckItem {
  kind: "passenger" | "box";
  units: number;
  /** Passenger actor id, or the ware name of a box. */
  key: number | string;
  /** Wares inside a box. */
  count?: number;
}
export interface ColonyShipLoad {
  passengers: number[];
  cargo: Goods;
  boxes: number;
}

export const isColonyDifficulty = (value: unknown): value is ColonyDifficulty =>
  typeof value === "string" && value in COLONY_DIFFICULTIES;

export const colonyTroopCount = (troops: Partial<ColonyTroops>) =>
  COLONY_TROOP_TYPES.reduce((sum, type) => sum + (troops[type] ?? 0), 0);

export const colonyTroopReason = (
  troops: Partial<ColonyTroops>, difficulty: ColonyDifficulty, available: Partial<ColonyTroops>,
  troopCap = COLONY_DIFFICULTIES[difficulty].troopCap
) => {
  const counts = COLONY_TROOP_TYPES.map(type => troops[type] ?? 0);
  if (!counts.every(count => Number.isSafeInteger(count) && count >= 0)) return "Invalid troop count";
  const retired = Object.entries(troops).find(([type, count]) =>
    !isOrdinaryTroopType(type) && Number(count) > 0);
  if (retired) return "Ordinary cavalry is retired";
  const total = colonyTroopCount(troops);
  if (total < 1) return "Choose at least one soldier";
  if (total > troopCap) return "Troop limit exceeded for this difficulty";
  const missing = COLONY_TROOP_TYPES.find(type => (troops[type] ?? 0) > (available[type] ?? 0));
  return missing ? `Not enough stored ${missing} troops` : null;
};

export const colonyDeckItems = (
  passengers: ReadonlyArray<{ uid: number; slots: number }>, goods: Readonly<Goods>
) => {
  const items: ColonyDeckItem[] = passengers.map(({ slots, uid }) =>
    ({ key: uid, kind: "passenger", units: slots * SLOT_UNITS }));
  for (const [ware, total] of Object.entries(goods)) {
    const perBox = wareBoxUnits(ware);
    for (let packed = 0; packed < total; packed += perBox)
      items.push({ count: Math.min(perBox, total - packed), key: ware, kind: "box", units: BOX_UNITS });
  }
  return items;
};

/** Fills decks in order, so troops sail before supplies when a second trip is needed. */
export const packColonyLoads = (items: readonly ColonyDeckItem[]) => {
  const loads: ColonyShipLoad[] = [];
  let current: ColonyShipLoad | undefined, used = 0;
  for (const item of items) {
    if (!current || used + item.units > DECK_UNITS) {
      current = { boxes: 0, cargo: {}, passengers: [] };
      loads.push(current);
      used = 0;
    }
    used += item.units;
    if (item.kind === "passenger") { current.passengers.push(item.key as number); continue; }
    current.boxes++;
    current.cargo[item.key as string] = (current.cargo[item.key as string] ?? 0) + item.count!;
  }
  return loads;
};

/**
 * Seconds a colony ship lies loading: the passengers walk aboard two at a time, then the dock porters
 * carry the boxes over a usual pier (owner, 2026-10-15: 14 soldiers in about a minute and a half).
 */
export const colonyLoadingSeconds = (boxes: number, passengers: number) => Math.max(MINIMUM_LOADING_SECONDS,
  passengers * BOARDING_SECONDS_PER_PASSENGER + planCargoHandling(boxes, TYPICAL_PORTER_ROUTE, 0).seconds);

export const colonyTrips = (loads: number, ships: number) =>
  loads > 0 && ships > 0 ? Math.ceil(loads / ships) : 0;

/** Every extra trip adds a return and an outbound voyage; loading repeats on each trip. */
export const colonyArrivalSeconds = (
  loads: readonly ColonyShipLoad[], ships: number, voyageSeconds = COLONY_VOYAGE_SECONDS
) => {
  const trips = colonyTrips(loads.length, ships);
  if (!trips) return Infinity;
  const loading = Math.max(...loads.map(load => colonyLoadingSeconds(load.boxes, load.passengers.length)));
  return trips * loading + shipTravelSeconds(voyageSeconds) * (2 * trips - 1);
};

const ISLAND_NAMES = [
  "Gull Rock", "Amber Reef", "Thornwake", "Lantern Isle", "Saltmere", "Heron Key",
  "Driftholm", "Cinder Atoll", "Mistral Cay", "Oakshore", "Whalebone Isle", "Copper Strand"
] as const;
const ORES: readonly ColonyOre[] = ["coal", "ironOre", "goldOre", "stone"];
const DIFFICULTY_ORDER: readonly ColonyDifficulty[] = ["easy", "medium", "hard"];
const VOYAGE_STEP_SECONDS = 10;
const VOYAGE_STEPS = 2 * COLONY_VOYAGE_SPREAD_SECONDS / VOYAGE_STEP_SECONDS + 1;
/** Seeded step of the island offer generators (colony and adventure offers). */
export const nextOfferRandom = (state: number) =>
  (Math.imul(state ^ (state >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
/** Offer voyage time: the base time within the spread, in 10 s steps; draws one roll. */
export const rollVoyageSeconds = (roll: (range: number) => number) =>
  COLONY_VOYAGE_SECONDS - COLONY_VOYAGE_SPREAD_SECONDS + roll(VOYAGE_STEPS) * VOYAGE_STEP_SECONDS;

/** Deterministic island offers; ores and difficulties are spread evenly before any repeats. */
export const colonyIslandOffers = (worldSeed: number, count = COLONY_ISLAND_OFFERS,
  calendar?: DiscoveryCalendar, playerLevel = 0): ColonyIsland[] => {
  let state = nextOfferRandom(worldSeed >>> 0);
  const roll = (range: number) => { state = nextOfferRandom(state); return state % range; };
  const names = ISLAND_NAMES.slice();
  const difficulties = Array.from({ length: count }, (_, index) => DIFFICULTY_ORDER[index % DIFFICULTY_ORDER.length]!);
  const ores = ORES.slice();
  return Array.from({ length: count }, (_, id) => {
    const name = names.splice(roll(names.length), 1)[0]!;
    if (id % ORES.length === 0) ores.splice(0, ores.length, ...ORES);
    const ore = ores.splice(roll(ores.length), 1)[0]!;
    const voyageSeconds = rollVoyageSeconds(roll);
    const difficulty = difficulties.splice(roll(difficulties.length), 1)[0]!;
    const seed = nextOfferRandom(state ^ id);
    return { difficulty, id, name, ore, seed, voyageSeconds, resourceTier: selectColonyResourceTier(seed, playerLevel),
      ...(calendar ? discoverIslandClimate(seed, voyageSeconds, calendar) : {}) };
  });
};

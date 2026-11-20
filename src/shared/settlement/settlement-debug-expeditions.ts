import { COLONY_CREW, COLONY_LIMIT, COLONY_SUPPLIES } from "../balance/colonies";
import { isAdventureIsland } from "./adventure-rules";
import { COLONY_TROOP_TYPES, type ColonyTroops } from "./colony-expedition-rules";
import { expeditionRequiredSoldiers } from "./expedition-launch-rules";
import { harbourHelperSupply } from "./harbour-helper-supply";
import { type DiscoveryOverride,discoveryOverrideError } from "./island-discovery-policy";
import { militaryHealth } from "./military-combat-rules";
import { addGood } from "./production-rules";
import type { ExpeditionIsland } from "./settlement-colony-expeditions";
import { ensureDebugHarbour } from "./settlement-debug-harbour";
import type { createSettlementMilitary, EmigratedTroop } from "./settlement-military";
import { MAX_SOLDIER_RANK } from "./settlement-military-ranks";
import type { createSettlementNaval } from "./settlement-naval";
import { addIdleSettlers } from "./settlement-population";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

export type DebugExpeditionKind = "adventure" | "colony";
/** What a test expedition had to be given before it could start. */
export interface DebugExpeditionGrant {
  harbourPlaced: boolean;
  ships: number;
  troops: number;
  crew: number;
  supplies: Goods;
}
export type DebugExpeditionResult =
  | { ok: true; id: number; island: ExpeditionIsland; granted: DebugExpeditionGrant }
  | { ok: false; reason: string };

/** Ordinary foot troops within the test troop cap; ordinary cavalry is retired. */
export const DEBUG_EXPEDITION_TROOPS: ColonyTroops = Object.freeze({ archer: 4, cavalry: 0, heavy: 7, shield: 9 });
/** At least this many free ships; more when the loads need them, so every load sails at once. */
const DEBUG_EXPEDITION_SHIPS = 2;

type Naval = Pick<ReturnType<typeof createSettlementNaval>, "adventureIslands" | "colonyExpeditions" |
  "colonyIslands" | "colonyTroops" | "ensureFreeShips" | "expeditionOngoing" | "planAdventureExpedition" |
  "planColonyExpedition" | "startAdventureExpedition" | "startColonyExpedition">;
interface DebugExpeditionHooks {
  connectRoads(start: SettlementPoint, end: SettlementPoint): unknown;
  military: Pick<ReturnType<typeof createSettlementMilitary>, "immigrate">;
  naval: Naval;
}

/** Top-rank stored soldiers for whatever part of `wanted` is not already stored. */
export const missingDebugTroops = (wanted: ColonyTroops, available: Partial<ColonyTroops>): EmigratedTroop[] =>
  COLONY_TROOP_TYPES.flatMap(type => Array.from({ length: Math.max(0, wanted[type] - (available[type] ?? 0)) },
    () => ({ hp: militaryHealth(type, MAX_SOLDIER_RANK), rank: MAX_SOLDIER_RANK, type })));

/** Wares the stock lacks to cover `wanted`. */
export const missingGoods = (wanted: Readonly<Goods>, stock: Readonly<Goods>): Goods => {
  const missing: Goods = {};
  for (const [ware, count] of Object.entries(wanted)) {
    const lacking = count - (stock[ware] ?? 0);
    if (lacking > 0) missing[ware] = lacking;
  }
  return missing;
};

/** Why no test expedition of this kind can start now; checked before anything is granted. */
const blockReason = (naval: Naval, kind: DebugExpeditionKind) => {
  if (naval.expeditionOngoing()) return "Another expedition is still under way: wait for it to land";
  const expeditions = naval.colonyExpeditions();
  if (kind === "adventure")
    return expeditions.some(expedition => isAdventureIsland(expedition.island))
      ? "Finish the current adventure first (sail home from it)" : null;
  const colonies = expeditions.filter(expedition => !isAdventureIsland(expedition.island)).length;
  return colonies >= COLONY_LIMIT ? `At most ${COLONY_LIMIT} colonies: disband one first` : null;
};

/** The easiest free island of the kind: an easy one when offered. */
const chooseIsland = (naval: Naval, kind: DebugExpeditionKind) => {
  const islands: readonly ExpeditionIsland[] = kind === "adventure"
    ? naval.adventureIslands() : naval.colonyIslands().filter(island => !island.taken);
  return islands.find(island => island.difficulty === "easy") ?? islands[0];
};

/** A colony crew sails from the harbour's own idle settlers, with its supplies from the harbour stock. */
const grantColonyCargo = (context: SettlementContext, harbour: SettlementBuilding) => {
  const crew = Math.max(0, COLONY_CREW - harbourHelperSupply(context, harbour));
  if (crew) addIdleSettlers(context, harbour, crew);
  const supplies = missingGoods(COLONY_SUPPLIES, harbour.inventory);
  for (const [ware, count] of Object.entries(supplies)) addGood(harbour.inventory, ware, count);
  return { crew, supplies };
};

/**
 * Development menu: grants everything a colony or adventure expedition needs (a finished harbour,
 * free ships, top-rank troops of every type, crew and supplies) and starts it with test timers.
 */
export const createDebugExpeditions = (context: SettlementContext, hooks: DebugExpeditionHooks) => {
  const { naval } = hooks;
  const launch = (kind: DebugExpeditionKind, harbourUid: number, islandId: number, troops: ColonyTroops, override?: DiscoveryOverride) => {
    const debug = override && (override.month !== undefined || override.theme !== undefined) ? override : true;
    return kind === "adventure"
      ? naval.startAdventureExpedition(harbourUid, islandId, troops, debug)
      : naval.startColonyExpedition(harbourUid, islandId, troops, debug);
  };
  /** One free ship per planned load: the whole expedition sails on the first trip. */
  const shipsFor = (kind: DebugExpeditionKind, harbourUid: number, islandId: number, troops: ColonyTroops) => {
    const plan = kind === "adventure" ? naval.planAdventureExpedition : naval.planColonyExpedition;
    return Math.max(DEBUG_EXPEDITION_SHIPS, plan(harbourUid, islandId, troops).loads);
  };
  const start = (kind: DebugExpeditionKind, override?: DiscoveryOverride): DebugExpeditionResult => {
    const invalid = discoveryOverrideError(override);
    if (invalid) return { ok: false, reason: invalid };
    const blocked = blockReason(naval, kind);
    if (blocked) return { ok: false, reason: blocked };
    const island = chooseIsland(naval, kind);
    if (!island) return { ok: false, reason: "No island is offered for this expedition" };
    const wanted = { ...DEBUG_EXPEDITION_TROOPS };
    wanted.shield += Math.max(0, expeditionRequiredSoldiers(island) - 20);
    const site = ensureDebugHarbour(context, hooks.connectRoads);
    if (!site.ok) return site;
    const fleet = naval.ensureFreeShips(site.harbour.uid, shipsFor(kind, site.harbour.uid, island.id, wanted));
    if (!fleet.free) return { ok: false, reason: "No ship is free and the water at the harbour has no room for one" };
    const troops = missingDebugTroops(wanted, naval.colonyTroops());
    // Granted troops wait inside the harbour, so they board without the march from the headquarters.
    hooks.military.immigrate(troops, site.harbour);
    const cargo = kind === "colony" ? grantColonyCargo(context, site.harbour) : { crew: 0, supplies: {} };
    const started = launch(kind, site.harbour.uid, island.id, wanted, override);
    if (!started.ok) return started;
    return { granted: { ...cargo, harbourPlaced: site.placed, ships: fleet.added, troops: troops.length }, id: started.id,
      island: naval.colonyExpeditions().find(expedition => expedition.id === started.id)!.island, ok: true };
  };
  return { start };
};

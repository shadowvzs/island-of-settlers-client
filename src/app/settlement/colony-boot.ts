import { TALENT_COLONY_SETTLER_CAP } from "@shared/catalog/balance";

import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import { isAdventureIsland } from "../../shared/settlement/adventure-rules";
import {
type Archipelago, type ColonyVisitRequest,
  findIsland, isColonyVisitRequest} from "../../shared/settlement/archipelago";
import { EXPEDITION_ISLAND_SIZE } from "../../shared/settlement/colony-island-rules";
import { expeditionWorldError } from "../../shared/settlement/colony-world-choice";
import type { DifficultyLevel } from "../../shared/settlement/difficulty";
import type { LoadedGameSave } from "../../shared/settlement/game-save";
import { monumentStartGarrison } from "../../shared/settlement/monument-start-garrison";
import type { ExpeditionIsland } from "../../shared/settlement/settlement-colony-expeditions";
import { isHomeBuilding } from "../../shared/settlement/settlement-home";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { WorldData } from "../../shared/world/world-data";

/** Only a visit request carries this marker; saved games and their filed islands never do. */
const VISIT_MARKER = `"format":"${FORMATS.colonyVisit.id}"`;

/** A first colony visit carries no map; everything else is an ordinary staged game save. */
export const readColonyVisit = (pending: string | null): ColonyVisitRequest | null => {
  if (!pending?.includes(VISIT_MARKER)) return null;
  const parsed: unknown = JSON.parse(pending);
  return isColonyVisitRequest(parsed) ? parsed : null;
};

/** An expedition island's map key (island cache group); it never collides with home. */
export const expeditionMapKey = (island: ExpeditionIsland, expeditionId: number) =>
  `${isAdventureIsland(island) ? "adventure" : "colony"}:${island.seed}:${expeditionId}` +
    (island.theme ? `:${isAdventureIsland(island) ? "ecology-v4" : "ecology-v3"}:${island.theme}:${isAdventureIsland(island) ? island.size : EXPEDITION_ISLAND_SIZE}:${island.difficulty}` +
      (isAdventureIsland(island) ? "" : `:${island.ore}`) : "") +
    (isAdventureIsland(island) ? "" : `:mine-sites-v1:resource-tier-${island.resourceTier ?? "legacy"}`);

/**
 * Charts an expedition's island: a world worker through the island cache (the island may have
 * been charted during the voyage), or findExpeditionWorld in place. Null: no candidate fits.
 */
export type ChartIsland = (island: ExpeditionIsland, mapKey: string) => Promise<WorldData | null>;

/** The colony's or adventure's island is generated on arrival (or read from the island cache). */
export const planColonyArrival = async (visit: ColonyVisitRequest, chart: ChartIsland) => {
  const record = findIsland(visit.archipelago, visit.archipelago.active);
  if (!record?.landing) throw new Error("This colony has no landing party");
  const mapKey = expeditionMapKey(record.island, record.expeditionId);
  const world = await chart(record.island, mapKey);
  if (!world) throw new Error(expeditionWorldError(record.island));
  return { mapKey, record, world };
};

export type ColonyArrival = Awaited<ReturnType<typeof planColonyArrival>>;

/** A colony starts from its pre-built harbour; an adventure island has no building at all. */
const arrivalHome = (arrival: ColonyArrival) =>
  isAdventureIsland(arrival.record.island) ? null : 39 as const;

/** A restored adventure from before 2026-10-13 still has its landing harbour. */
const restoredHome = (restored: LoadedGameSave) => {
  const { adventure, buildings, colony } = restored.settlement;
  if (colony) return 39 as const;
  if (!adventure) return undefined;
  return buildings.some(isHomeBuilding) ? 39 as const : null;
};

/**
 * A new colony's settlers: the landed crew plus the starting settlers talent (extra settlers, not taken
 * from home), never above the colony's base limit; an adventure lands only its crew.
 */
const arrivalSettlers = (arrival: ColonyArrival, talentSettlers: number) => {
  const crew = arrival.record.landing!.crew;
  if (isAdventureIsland(arrival.record.island)) return crew;
  return Math.max(crew, Math.min(TALENT_COLONY_SETTLER_CAP, crew + talentSettlers));
};

/**
 * Colonies start from their harbour with only the landed crew (plus `talentSettlers`) and supplies;
 * adventures without buildings.
 */
export const colonySettlementOptions = (
  restored: LoadedGameSave | null, arrival: ColonyArrival | null, talentSettlers = 0,
  difficulty?: DifficultyLevel
) => {
  if (arrival) return { difficulty, homeBuilding: arrivalHome(arrival),
    initialSettlers: arrivalSettlers(arrival, talentSettlers), initialStock: {} };
  const homeBuilding = restored ? restoredHome(restored) : undefined;
  return homeBuilding === undefined ? { difficulty } : { difficulty, homeBuilding };
};

/** Where the camera starts: the home building, or an adventure's landing beach. */
export const islandStartPoint = (simulation: SettlementSimulation) =>
  simulation.home() ?? simulation.adventure()?.landing?.shore ?? null;

/** When the colony cannot be reached, the visit falls back to the filed home island. */
export const colonyHomeFallback = (visit: ColonyVisitRequest) =>
  ({ ...visit.archipelago.home!, archipelago: { ...visit.archipelago, active: null, home: undefined } });

export const islandNation = (restored: LoadedGameSave | null, visit: ColonyVisitRequest | null) =>
  restored?.settlement.playerNation ?? visit?.archipelago.home?.settlement.playerNation;

/** The game's difficulty: a restored island's own save, or the home save of a first visit. */
export const islandDifficulty = (
  restored: LoadedGameSave | null, visit: ColonyVisitRequest | null
): DifficultyLevel | undefined =>
  restored?.settlement.difficulty ?? visit?.archipelago.home?.settlement.difficulty;

export const islandArchipelago = (
  restored: LoadedGameSave | null, visit: ColonyVisitRequest | null
): Archipelago | undefined => visit?.archipelago ?? restored?.archipelago;

/**
 * Lands troops (and a colony's supplies) and raises the hostile forts and camps on the fresh island. A new
 * colony (never an adventure) also gets the home Monument's harbour defenders when `monumentBonus` is on.
 */
export const settleArrivingColony = (
  simulation: SettlementSimulation, arrival: ColonyArrival, monumentBonus = false
) => {
  const { expeditionId, island, landing } = arrival.record;
  if (isAdventureIsland(island)) return simulation.startAdventure({ island, troops: landing!.troops });
  const defenders = monumentStartGarrison({ active: monumentBonus, key: expeditionId, seed: island.seed });
  return simulation.startColony({ island, landed: landing!.landed, troops: landing!.troops,
    ...(defenders.length ? { defenders } : {}) });
};

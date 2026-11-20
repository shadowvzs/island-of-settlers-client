import type { ScenarioFactionAi } from "../world/scenario-faction-ai";
import { activeFactionAi } from "../world/scenario-faction-ai";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Options are optional for bare rate/UI contexts: without them only the player runs an economy. The source is the
 * map's `factionAi` (enemy economy AI P2), pinned with the map file, so every path that has the world (live game,
 * verifier, offline staging, save validation) agrees; a live island adds the factions a script woke (EAI2b, saved
 * with the faction AI state).
 */
export type EconomyContext = {
  factionAi?: { liveEconomies: () => readonly number[] | undefined };
  options?: { world?: { scenario?: { factionAi?: readonly ScenarioFactionAi[] } } };
};

/**
 * One source of ownership for the faction-scoped economy kernel (enemy economy AI plan P1, EAI1a
 * inventory §2). Every helper is a read: `militaryFaction` is never written here, because `undefined`
 * ("never fortified") and `0` (a player building that took walls) are different saved states (R-a).
 */

/** The human player's faction: the fog on screen, the talents, the HUD numbers. */
export const PLAYER_FACTION = 0;

type Owned = Pick<SettlementBuilding, "militaryFaction">;

/** The faction owning a building: computer factions own the sites with `militaryFaction > 0`. */
export const ownerOf = (owned: Owned) => owned.militaryFaction ?? PLAYER_FACTION;

/** Both buildings belong to one faction. */
export const sameOwner = (first: Owned, second: Owned) => ownerOf(first) === ownerOf(second);

type OwnedActor = Pick<SettlementActor, "hostileCivilianFaction" | "job" | "uid">;

/** The faction of a civilian: the player's unless it carries a saved `hostileCivilianFaction`. */
export const civilianOwnerOf = (actor: Pick<SettlementActor, "hostileCivilianFaction">) =>
  actor.hostileCivilianFaction ?? PLAYER_FACTION;

/**
 * The faction of a person: a soldier fights for its combat faction; a civilian belongs to the player
 * unless it carries a saved `hostileCivilianFaction`.
 */
export const actorOwnerOf = (context: Pick<SettlementContext, "military">, actor: OwnedActor) => {
  if (actor.job === "Soldier") return context.military?.factionOf?.(actor.uid) ?? PLAYER_FACTION;
  return civilianOwnerOf(actor);
};

const PLAYER_ONLY: readonly number[] = [PLAYER_FACTION];
const noComputerEconomies: readonly number[] = [];

interface EconomyLists {
  /** The computer factions the map gives an AI (`maintain` or `develop`), ascending. */
  computers: readonly number[];
  /** The player first, then `computers`. */
  owners: readonly number[];
}
const economyLists = new WeakMap<readonly unknown[], EconomyLists>();

/** Memoises the lists of an ascending computer set under its source array (`key`). */
const remember = (key: readonly unknown[], computers: readonly number[]) => {
  const lists = { computers, owners: computers.length ? [PLAYER_FACTION, ...computers] : PLAYER_ONLY };
  economyLists.set(key, lists);
  return lists;
};

/**
 * The economy factions: the live set while a script has woken one (a new array per change), else the map's,
 * memoised per `factionAi` list; undefined on every map without either.
 */
const economyListsOf = (context: EconomyContext): EconomyLists | undefined => {
  const live = context.factionAi?.liveEconomies();
  if (live) return economyLists.get(live) ?? remember(live, live);
  const factionAi = context.options?.world?.scenario?.factionAi;
  if (!factionAi?.length) return undefined;
  return economyLists.get(factionAi) ??
    remember(factionAi, activeFactionAi(factionAi).map(entry => entry.faction).sort((a, b) => a - b));
};

/**
 * Whether a faction runs an economy (pools, workers, logistics). The player always does; a computer
 * faction when the map gives it an AI (`factionAi` mode `maintain` or `develop`), or from the moment a script
 * wakes it to one of those modes; a script that later stops its decisions keeps its economy. False for every
 * hostile site of a `none` faction, so those keep today's rules.
 */
export const hasEconomy = (context: EconomyContext, owner: number): boolean =>
  owner === PLAYER_FACTION || economyListsOf(context)?.computers.includes(owner) === true;

/** The computer factions that run an economy (the map's AI factions and woken ones), ascending; empty without. */
export const computerEconomies = (context: EconomyContext): readonly number[] =>
  economyListsOf(context)?.computers ?? noComputerEconomies;

/**
 * Whether a building serves `owner`'s economy: it belongs to `owner`, or to a faction without an
 * economy. The second half keeps a known BD1 gap exactly as it is: an authored enemy depot of a `none`
 * faction still seeds the player's road flood and road-work stock (EAI1a A5; closed in EAI1c c4).
 */
export const servesEconomyOf = (context: EconomyContext, building: Owned, owner: number) => {
  const buildingOwner = ownerOf(building);
  return buildingOwner === owner || !hasEconomy(context, buildingOwner);
};

/** The economy `owner`'s stock and services belong to: itself when it runs one, else the player's. */
const economyOf = (context: EconomyContext, owner: number) =>
  owner !== PLAYER_FACTION && hasEconomy(context, owner) ? owner : PLAYER_FACTION;

/**
 * The economy a building's stock and services belong to: its owner when that faction runs an economy;
 * otherwise the player's, so a site of a `none` faction falls back to the player's storages, as before.
 */
export const economyOwnerOf = (context: EconomyContext, building: Owned) => economyOf(context, ownerOf(building));

/**
 * The economy a civilian works for: its saved faction when that faction runs one; otherwise the player's
 * (an authored catapult porter of a `none` faction keeps today's player services).
 */
export const actorEconomyOwnerOf = (context: EconomyContext, actor: Pick<SettlementActor, "hostileCivilianFaction">) =>
  economyOf(context, civilianOwnerOf(actor));

/** Whether `candidate` (a storage, source or depot) may serve `building`'s economy (EAI1c storage lookups). */
export const servesBuildingEconomy = (context: EconomyContext, candidate: Owned, building: Owned) =>
  servesEconomyOf(context, candidate, economyOwnerOf(context, building));

/**
 * The economies the scheduler serves, the player first, then each computer economy ascending. `[0]` on
 * every island without an economy faction, so the player's pass is the only one (EAI1a D16).
 */
export const economyOwners = (context: EconomyContext): readonly number[] =>
  economyListsOf(context)?.owners ?? PLAYER_ONLY;

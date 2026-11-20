import { HEADQUARTERS_TYPE_ID } from "./building-type-ids";
import { ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

type OwnedBuilding = Pick<SettlementBuilding, "militaryFaction">;
type HomeCandidate = Pick<SettlementBuilding, "colonyHome" | "militaryFaction" | "typeId">;

/** A building of the human player: computer factions own the sites with `militaryFaction > 0`. */
export const isOwnBuilding = (building: OwnedBuilding) => ownerOf(building) === PLAYER_FACTION;

/**
 * The player's own headquarters. An enemy HQ reuses type 0 with an enemy faction (owner Q-BD2), so
 * every home, territory, storage and "at home" lookup asks this, never `typeId === 0` alone.
 */
export const isOwnHeadquarters = (building: Pick<SettlementBuilding, "militaryFaction" | "typeId">) =>
  building.typeId === HEADQUARTERS_TYPE_ID && isOwnBuilding(building);

/** A headquarters or the pre-built harbour a colony starts from, of any owner. */
export const isHomeType = (building: Pick<SettlementBuilding, "colonyHome" | "typeId">) =>
  building.typeId === HEADQUARTERS_TYPE_ID || building.colonyHome === true;

/** The settlement's home: the player's headquarters, or the pre-built harbour a colony starts from. */
export const isHomeBuilding = (building: HomeCandidate) => isOwnBuilding(building) && isHomeType(building);

/** The first harbour founded on a landmass where this player had no previous buildings. */
export const isFoundingAnchor = (building: Pick<SettlementBuilding, "foundingAnchor" | "typeId">) =>
  building.typeId === 39 && building.foundingAnchor === true;

/** Map home plus the permanent founding anchor; ordinary harbours stay demolishable. */
export const isDemolitionProtected = (building: HomeCandidate & Pick<SettlementBuilding, "foundingAnchor">) =>
  isHomeBuilding(building) || isFoundingAnchor(building);

export const findHomeBuilding = (context: Pick<SettlementContext, "buildings">) =>
  context.buildings.find(isHomeBuilding);

/** A faction's home: its headquarters or colony base; the player's is `findHomeBuilding`. */
export const findFactionHome = (context: Pick<SettlementContext, "buildings">, owner: number) => {
  if (owner === PLAYER_FACTION) return findHomeBuilding(context);
  return context.buildings.find(building => ownerOf(building) === owner && isHomeType(building));
};

/** The player's own headquarters on this island, if it has one. */
export const findOwnHeadquarters = (context: Pick<SettlementContext, "buildings">) =>
  context.buildings.find(isOwnHeadquarters);

/** `home`/`building` of soldiers on a building-free adventure island. */
export const NO_BUILDING = -1;

/** The home building's uid, or NO_BUILDING on an island without buildings. */
export const homeUid = (context: Pick<SettlementContext, "buildings">) =>
  findHomeBuilding(context)?.uid ?? NO_BUILDING;

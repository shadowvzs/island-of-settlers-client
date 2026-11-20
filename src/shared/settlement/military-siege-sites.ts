import {
  GARRISON_CAPACITIES, PLAYER_FORT_TYPE_IDS, PLAYER_SUPPORT_MILITARY_TYPE_IDS, RAID_NEARBY_RADIUS
} from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { destructibleWalls, isIndestructible } from "./building-destruction";
import { buildingStructure } from "./fort-assault-rules";
import type { MilitaryCombatant, MilitaryDoor } from "./military-combat-rules";
import { isOwnBuilding } from "./settlement-home";
import { ownerOf } from "./settlement-ownership";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";

/** The siege door every new military door starts with (hit points of the door leaf itself). */
const DOOR_HP = 200;

/**
 * A player-owned building under the shared wall assault: the Catapult Tower and the player's own
 * military buildings. Forts the player captured keep a door without walls and stay recapturable.
 */
export const isPlayerSiegeDoor = (door: MilitaryDoor | undefined) =>
  door?.faction === 0 && door.structure !== undefined;

/**
 * Raid tier 1 (owner 2026-11-09): a completed player building that can hold soldiers (own garrison
 * buildings, the Catapult Tower, captured forts).
 */
export const isPlayerGarrisonSite = (site: SettlementBuilding) => site.construction === 1 &&
  isOwnBuilding(site) && GARRISON_CAPACITIES[site.typeId] !== undefined;

const isStanding = (site: SettlementBuilding, doors: ReadonlyMap<number, MilitaryDoor>) =>
  (doors.get(site.uid)?.structure?.hp ?? 1) > 0;

/**
 * A player Military Academy or Commander's Lodge (raid tier 2) with a standing garrison building
 * whose plot centre lies within `RAID_NEARBY_RADIUS` of its own: raiders leave it alone until
 * that building has fallen (owner 2026-11-09).
 */
export const isShieldedSupportSite = (
  site: SettlementBuilding, buildings: readonly SettlementBuilding[], doors: ReadonlyMap<number, MilitaryDoor>
) => PLAYER_SUPPORT_MILITARY_TYPE_IDS.has(site.typeId) && buildings.some(other => other !== site &&
  isPlayerGarrisonSite(other) && isStanding(other, doors) &&
  DMath.hypot(other.x - site.x, other.z - site.z) <= RAID_NEARBY_RADIUS);

/** A player Academy or Lodge that raiders may assault now: completed, own, standing, unshielded. */
export const isExposedSupportSite = (
  site: SettlementBuilding, buildings: readonly SettlementBuilding[], doors: ReadonlyMap<number, MilitaryDoor>
) => PLAYER_SUPPORT_MILITARY_TYPE_IDS.has(site.typeId) && site.construction === 1 &&
  isOwnBuilding(site) && isStanding(site, doors) && !isShieldedSupportSite(site, buildings, doors);

/** A player-built Barracks, Guardhouse, Watchtower, Fortress, Academy or Lodge never fortified yet. */
const isUnfortifiedPlayerFort = (site: SettlementBuilding) =>
  (PLAYER_FORT_TYPE_IDS.has(site.typeId) || PLAYER_SUPPORT_MILITARY_TYPE_IDS.has(site.typeId)) &&
  site.construction === 1 && site.militaryFaction === undefined &&
  site.bandit === undefined && !site.eventCourtyard;

/** A player building outside the fort rules that raiders may destroy (BD1): any own, attackable plot. */
const isUnwalledPlayerBuilding = (site: SettlementBuilding) => isOwnBuilding(site) && !isIndestructible(site) &&
  site.bandit === undefined && !site.eventCourtyard && !isUnfortifiedPlayerFort(site) &&
  (site.militaryFaction === undefined || site.construction !== 1);

const newDoor = (site: SettlementBuilding, structure: MilitaryDoor["structure"], faction = 0): MilitaryDoor =>
  ({ building: site.uid, faction, hp: DOOR_HP, maximum: DOOR_HP, structure });

/**
 * A computer economy's garrison building (EAI2b) takes a door of its owner with its type's walls when its first
 * soldier is sent, as authored enemy forts have theirs, so the player can besiege and raze it. No-op once it has one.
 */
export const fortifyEconomyGarrison = (site: SettlementBuilding, doors: Map<number, MilitaryDoor>) => {
  if (doors.has(site.uid)) return;
  doors.set(site.uid, newDoor(site, buildingStructure(site.typeId), ownerOf(site)));
};

/**
 * A player building takes a door with walls on its first assault (MIL-ASSAULT 2026-11-08; every building
 * since BD1), never earlier: buildings that are never attacked keep their exact state. Military buildings
 * become faction 0 sites with their type's walls; any other building (a construction site too) gets
 * `destructibleWalls` and keeps its ownership unset. Returns the door of a besiegeable player site (also
 * an already fortified one), otherwise undefined. A shielded Academy or Lodge is not besiegeable.
 */
export const fortifyPlayerSite = (
  site: SettlementBuilding, doors: Map<number, MilitaryDoor>, buildings: readonly SettlementBuilding[]
) => {
  if (isShieldedSupportSite(site, buildings, doors)) return undefined;
  const existing = doors.get(site.uid);
  if (existing) return isPlayerSiegeDoor(existing) ? existing : undefined;
  if (isUnfortifiedPlayerFort(site)) {
    site.militaryFaction = 0;
    const door = newDoor(site, buildingStructure(site.typeId));
    doors.set(site.uid, door);
    return door;
  }
  const walls = isUnwalledPlayerBuilding(site) ? destructibleWalls(site) : undefined;
  if (!walls) return undefined;
  const door = newDoor(site, walls);
  doors.set(site.uid, door);
  return door;
};

/** Whether this player site can still be fortified or is fortified and standing (and unshielded). */
export const isPlayerFortCandidate = (
  site: SettlementBuilding, doors: ReadonlyMap<number, MilitaryDoor>, buildings: readonly SettlementBuilding[]
) => {
  const support = PLAYER_SUPPORT_MILITARY_TYPE_IDS.has(site.typeId);
  if ((!PLAYER_FORT_TYPE_IDS.has(site.typeId) && !support) || site.construction !== 1) return false;
  if (support && isShieldedSupportSite(site, buildings, doors)) return false;
  const door = doors.get(site.uid);
  if (!door) return isUnfortifiedPlayerFort(site);
  return isPlayerSiegeDoor(door) && door.structure!.hp > 0;
};

/** An idle field soldier free to start an assault: no order, target, swing or route of its own. */
export const isUncommitted = (state: MilitaryCombatant, body: SettlementActor) =>
  body.visible && body.phase === "militaryField" && state.hp > 0 && state.siege === undefined &&
  state.order !== "retreat" && state.order !== "move" && state.target === undefined &&
  state.pendingTarget === undefined && !state.attackTime && state.destination === undefined;

/** Distance (tiles) from a body to the nearest edge of a building's plot; 0 inside it. */
export const plotDistance = (site: SettlementBuilding, body: { x: number; z: number }) =>
  DMath.hypot(Math.max(0, Math.abs(body.x - site.x) - site.width / 2),
    Math.max(0, Math.abs(body.z - site.z) - site.depth / 2));

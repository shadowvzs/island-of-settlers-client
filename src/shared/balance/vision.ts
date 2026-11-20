import { commanderEntry, soldierEntries } from "@shared/catalog";

import type { MilitaryTroopType } from "../settlement/military-combat-rules";

/**
 * Faction perception sight radii in tiles (A13, owner decision D-AI1). Troops and commanders carry
 * theirs in the content catalog (`soldier:*` profile, `commander:*`); the people and buildings below
 * have no catalog entry of their own. Owner 2026-11-13: civilians keep today's 12-tile fog reveal, so
 * sight >= archer range everywhere (archers 8, tower posts at most x1.125). Phase 2: the player's
 * layer is the fog of war; phase 3 (AI knowledge) still has to retune against it (DEC-03).
 */
export const SOLDIER_SIGHT: Readonly<Record<MilitaryTroopType, number>> = Object.freeze(Object.fromEntries(
  soldierEntries().map(entry => [entry.key, entry.soldier.profile.sight])
) as Record<MilitaryTroopType, number>);
/** Fallback when a nation has no commander entry: the Roman commander's sight. */
const DEFAULT_COMMANDER_NATION = "roman";
/** The commander of `nation` (catalog `commander:<nation>.sight`). */
export const commanderSight = (nation: string) =>
  (commanderEntry(nation) ?? commanderEntry(DEFAULT_COMMANDER_NATION)!).commander.sight;
/** Every civilian outside a building (carriers, builders, producers, hostile civilians). */
export const CIVILIAN_SIGHT = 12;
/** A player exploration ship under way (its passengers' sight; the coast discovery radius is separate). */
export const EXPLORER_SHIP_SIGHT = 12;
/** A Scout walking its survey legs (it looks six tiles further for hidden ground: scout-exploration.ts). */
export const SCOUT_SIGHT = 18;
/** A finished headquarters or colony home. */
export const HEADQUARTERS_SIGHT = 14;
/**
 * A finished garrison building (barracks, guardhouse, watchtower, fortress, catapult tower, camps) with
 * at least one soldier inside; an empty one is blind (owner 2026-11-13).
 */
export const GARRISON_BUILDING_SIGHT = 16;
/**
 * A13 phase 3 (`FactionKnowledge`): an enemy that leaves sight is remembered at its last known position for
 * this long (game seconds). In 20 s a shield soldier (1.4 tiles/s) walks about 28 tiles, roughly the medium
 * commander's 26-tile attack radius: an older memory would point the commander at empty ground. It is 13
 * commander decisions (1.5 s), so a squad that lost contact still acts on it for a while.
 */
export const KNOWLEDGE_MEMORY_SECONDS = 20;
/**
 * A hit from an unseen attacker makes the attacker known to the victim's faction for this long (game seconds),
 * refreshed by every further hit: 2.5 archer intervals (1.6 s), so a steady volley stays known and a single
 * stray shot does not reveal the archer for long.
 */
export const HIT_ALERT_SECONDS = 4;

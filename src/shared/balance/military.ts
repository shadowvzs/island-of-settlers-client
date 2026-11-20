import { type BuildingMilitary, entriesOfKind, soldierEntries } from "@shared/catalog";
import { buildingsWithRules } from "@shared/catalog/building-data/rules";

import type { ColonyDifficulty } from "../settlement/colony-expedition-rules";
import type { CommanderWeights } from "../settlement/commander/commander-types";
import type { MilitaryProfile, MilitaryTroopType, OrdinaryTroopType } from "../settlement/military-combat-rules";
import type { Goods } from "../settlement/settlement-types";

/** Measured live profiles (content catalog `soldier:*`); terrain and mounted balance still need playtests. */
export const MILITARY_PROFILES: Readonly<Record<MilitaryTroopType, MilitaryProfile>> = Object.freeze(Object.fromEntries(
  soldierEntries().map(entry => [entry.key, entry.soldier.profile])
) as Record<MilitaryTroopType, MilitaryProfile>);
/** Saved archer HP below this marker predates the 2026-10-27 ×0.75 balance change. */
export const ARCHER_HEALTH_VERSION = 1;
/** One-time migration factor applied to a pre-marker archer's stored HP; preserves wounded fraction. */
export const LEGACY_ARCHER_HEALTH_SCALE = .75;
/** Archers deal this share of their damage against shielded defenders before armour is applied. */
export const ARCHER_SHIELD_DAMAGE_MULTIPLIER = .67;
/** Heavy infantry ignore target armour on this share of their attacks. */
export const HEAVY_ARMOUR_BYPASS_CHANCE = .33;
/** One actual HP is recovered per this many eligible resting simulation seconds. */
export const MILITARY_REST_SECONDS_PER_HP = 60;

/**
 * Net equipment after normal storage recruitment (content catalog). Ordinary cavalry is retired
 * (HORSE-RETIREMENT-01), so no current recipe demands a horse; its old profile remains only for historical riders.
 */
export const MILITARY_RECRUIT_COSTS: Readonly<Record<OrdinaryTroopType, Goods>> = Object.freeze(Object.fromEntries(
  entriesOfKind("soldier").map(entry => [entry.key, entry.soldier.recruitCost])
) as Record<OrdinaryTroopType, Goods>);
/** Largest single Tavern order. */
export const MAX_TAVERN_ORDER = 50;
/** Equipment for at most four queued recruits may wait at the Tavern, enabling shared cart loads. */
export const TAVERN_EQUIPMENT_BUFFER = 4;
/** Seconds the recruit spends inside the Tavern being equipped, once every ingredient is there. */
export const TAVERN_TRAINING_SECONDS = 6;

/** One military value per building type that has it (rules sidecar `military`), keyed by type id. */
const militaryTable = (field: keyof Omit<BuildingMilitary, "assault">): Readonly<Record<number, number>> =>
  Object.freeze(Object.fromEntries(buildingsWithRules().flatMap(({ entry, rules }) => {
    const value = rules.military?.[field];
    return value === undefined ? [] : [[entry.code, value]];
  })));
/** Building types whose raid rule (rules sidecar `military.assault`) is the given one. */
const assaultTypes = (assault: BuildingMilitary["assault"]): ReadonlySet<number> => new Set(buildingsWithRules()
  .filter(({ rules }) => rules.military?.assault === assault).map(({ entry }) => entry.code));

/**
 * Garrison limits: barracks 2 (windows only), guardhouse 3 (small tower: 2 posts),
 * watchtower 6 (large tower: 3 posts), fortress 10 (castle: 4 corner towers and a keep).
 */
export const GARRISON_CAPACITIES = militaryTable("garrison");
/** Archer posts on open tower decks; must match each recipe's `archerPositions`. */
export const GARRISON_ARCHER_POSTS = militaryTable("archerPosts");
/** Coin stock limit per military building type (owner decision 2026-10-26: six per building). */
export const MILITARY_COIN_CAPACITIES = militaryTable("coinCapacity");
/**
 * Bounded national-drink refill target per military building. The owner's explicit six-unit limit
 * applies to coins, not drinks: three drinks cover three promotion events between refills without
 * turning every garrison into a warehouse.
 */
export const MILITARY_DRINK_LIMIT = 3;
/**
 * A coin-funded training event takes this many game frames plus a random share of the span
 * (50 ms frames: 5–19.95 seconds at normal speed).
 */
export const MILITARY_TRAINING_MIN_FRAMES = 100;
export const MILITARY_TRAINING_FRAME_SPAN = 300;

/**
 * Damage share of an archer shooting its bow point-blank: the last door defender, and a cornered
 * field archer (owner decision 2026-10-13).
 */
export const DOOR_ARCHER_DAMAGE = .5;
/** Window archers shoot only within this angle either side of the window's outward facing. */
export const WINDOW_FIRING_HALF_ANGLE = Math.PI / 6;
/**
 * Enemies this close to a building's footprint (tiles) are under its walls: tower and window
 * archers cannot shoot down at them. Archers fight close only as the last door defender.
 */
export const GARRISON_ARCHER_DEAD_ZONE = 2;
/**
 * Most a tower or roof post raises a garrison archer's bow range (owner request 2026-10-19). The
 * arrow's own ballistics give R(h)/R(0) = (1 + √(1 + 2gh/vy²)) / 2 from h tiles above the target's
 * ground; every post deck (1.5–5 tiles up) would reach 1.35–1.9×. Ten-seed colony sweeps: 1.125×
 * (9 tiles) keeps the colony targets (one test seed re-picked); 1.25× already leaves easy colonies
 * untakeable by 12–13 soldiers and hard ones by 40 veterans (1/10), and from 1.375× an easy
 * adventure fort's two towers cover each other's door queue. Posts below 0.44 tiles get less.
 * Window archers: 1×. Retune under DEC-03 if the owner wants a bigger bonus.
 */
export const GARRISON_POST_MAX_RANGE_FACTOR = 1.125;
/**
 * Melee attackers that may fight a building's single door defender at once (owner decision
 * 2026-10-13): one takes the duel, the others strike from the door's flanks; the rest queue.
 */
export const MAX_DOOR_ATTACKERS = 3;

/**
 * Wall hit points of every building type once it is assaulted (rules sidecar `structureHp`; BD1, owner
 * 2026-11-09: every building of both sides is destroyable). Forts by size: barracks 10,000, guardhouse
 * 20,000, watchtower 35,000, fortress 50,000 (colony forts are destroyed, never captured, owner 2026-10-13);
 * the HQ and the harbour are the strongest. The player's own HQ never takes walls (home only).
 */
export const BUILDING_STRUCTURE_HP: Readonly<Record<number, number>> = Object.freeze(Object.fromEntries(
  buildingsWithRules().map(({ entry, rules }) => [entry.code, rules.structureHp])));
/**
 * A construction site has this share of its building type's walls (owner Q-BD9: construction sites are
 * destroyable, roads and bridges are not).
 */
export const CONSTRUCTION_SITE_HP_SHARE = .25;
/**
 * Share of a destroyed building's materials its ruin yields, per ware, rounded down (plan review B8e; owner
 * Q-BD9: the rest is lost): of the materials delivered to a construction site, of the construction cost of a
 * finished building. The clearing job carries it to storage (BD2).
 */
export const DESTROYED_SITE_SALVAGE_SHARE = .25;
/**
 * Share of a destroyed storage's part of its pool that is lost (BD2, plan review B8f: "stock partly lost").
 * Its part is the pool total in proportion to the storage's capacity; the loss is rounded down per ware.
 */
export const DESTROYED_STORAGE_LOSS_SHARE = .5;
/**
 * EAI2d wall repair: one repair trip restores the missing walls, at most this share of their maximum; it costs the
 * same share of the building's construction cost, rounded down per ware (at least one ware: never free).
 */
export const WALL_REPAIR_TRIP_SHARE = .5;
/** Seconds a repairer works at the walls for one trip. */
export const WALL_REPAIR_SECONDS = 10;
/** Seconds of work to clear a ruin, by the plot's longer side: up to 4, 5, and larger (owner: ~10-20 s). */
export const RUIN_CLEARING_SECONDS = [10, 15, 20] as const;
/** Ruins one owner clears at the same time, so a battle's ruins never take every free carrier (B8c). */
export const RUIN_CLEARER_LIMIT = 3;
/**
 * Reachability searches the ruin dispatch may run per scheduler run (every half second): an unreachable search
 * on a big island costs milliseconds, so a battle's fifty ruins never spend more than this per run (B8b).
 */
export const RUIN_SEARCHES_PER_RUN = 1;
/** Retry delay after a ruin was found unreachable; it doubles with every failure up to the cap (B8a). */
export const RUIN_RETRY_SECONDS = 2;
export const RUIN_RETRY_CAP_SECONDS = 64;
/** Walls of the player's Military Academy (40) once raiders assault it (owner 2026-11-09). */
export const ACADEMY_STRUCTURE_HP = BUILDING_STRUCTURE_HP[40]!;
/** Walls of the player's Commander's Lodge (62) once raiders assault it (owner 2026-11-09). */
export const COMMANDER_LODGE_STRUCTURE_HP = BUILDING_STRUCTURE_HP[62]!;
/**
 * Player Barracks, Guardhouse, Watchtower and Fortress take walls on the first computer assault
 * (MIL-ASSAULT 2026-11-08); like the Catapult Tower they are destroyed, never captured.
 */
export const PLAYER_FORT_TYPE_IDS = assaultTypes("fort");
/**
 * Raid tier 2 (owner 2026-11-09): the Military Academy and the Commander's Lodge are military
 * buildings without a garrison. Raiders assault one only while no player garrison building
 * (tier 1) stands within `RAID_NEARBY_RADIUS` of it; they take walls on that first assault too.
 */
export const PLAYER_SUPPORT_MILITARY_TYPE_IDS = assaultTypes("support");
/**
 * The raids' one "nearby" distance in tiles (owner 2026-11-09; 12 -> 18 owner 2026-11-09 MIL-TWEAKS):
 * player soldiers this close to a raider or its target are fought first, and a garrison building
 * this close to an Academy or a Lodge shields it from assault (the owner named one shared radius).
 */
export const RAID_NEARBY_RADIUS = 18;
/**
 * Hit points of a player civilian outside a building (MIL-ASSAULT 2026-11-09): two blows of a rank-0
 * heavy, three of a shieldman. They are whole again once the civilian enters a building.
 */
export const CIVILIAN_HP = 30;
/**
 * Hit points of an open archer scaffold (owner request 2026-10-22): melee strike its supports while
 * its archers shoot down at them (no dead zone), so it is far weaker than a walled watchtower.
 */
export const OPEN_SCAFFOLD_STRUCTURE_HP = 5_000;
/** Seconds a fallen fort burns on before it collapses, then seconds its charred ruin remains. */
export const FORT_COLLAPSE_SECONDS = 5;
export const FORT_RUIN_SECONDS = 5;
/** Seconds the collapse itself takes (from `FORT_COLLAPSE_SECONDS`). */
export const FORT_COLLAPSE_DURATION = 1.5;
/** Walls take this multiple of a soldier's blow: an easy-size force (15) fells a fortress in about 1.5 minutes. */
export const STRUCTURE_DAMAGE_FACTOR = 5;

/** Difficulty only changes the weights: easy raiders hang back and give way, hard ones press on. */
export const COMMANDER_WEIGHTS: Readonly<Record<ColonyDifficulty, CommanderWeights>> = {
  easy: {
    aggression: 0.7,
    attackRadius: 18,
    attackRatio: 1.1,
    caution: 1.2,
    cohesion: 0.6,
    defend: 0.55,
    retreatRatio: 0.6
  },
  medium: {
    aggression: 1,
    attackRadius: 26,
    attackRatio: 0.85,
    caution: 1,
    cohesion: 0.8,
    defend: 0.5,
    retreatRatio: 0.45
  },
  hard: {
    aggression: 1.25,
    attackRadius: 34,
    attackRatio: 0.7,
    caution: 0.8,
    cohesion: 1,
    defend: 0.45,
    retreatRatio: 0.35
  }
};
/** Seconds between two decisions of a faction (each faction offset a little). */
export const DECISION_INTERVAL = 1.5;
/**
 * An attack-moving soldier this close (tiles) to an enemy is closing in: its own targeting takes the
 * fight, so a new squad order would only stall it in the scrum (owner decision 2026-10-19).
 */
export const CLOSING_RANGE = 8;
/**
 * Seconds a soldier may spend retreating while enemies stay on it; then it turns and fights (a
 * lone rider no longer flees round the island for ever). It refills once no enemy is near.
 */
export const RETREAT_BUDGET = 9;

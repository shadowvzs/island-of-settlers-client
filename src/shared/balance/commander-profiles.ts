import { secondsToTicks } from "../../../../island-of-settlers-shared/src/time/constants";
import type { ColonyDifficulty } from "../settlement/colony-expedition-rules";
import type { CommanderProfile } from "../settlement/commander/commander-types";
import type { MilitaryTroopType } from "../settlement/military-combat-rules";
import { DIRECTOR_INTERVAL_TICKS, RAID_RATIO, SCOUT_AGE_TICKS, UNCERTAINTY_MARGIN } from "./commander-director";
import { CLOSING_RANGE, COMMANDER_WEIGHTS, DECISION_INTERVAL } from "./military";

/** The commander levels a computer faction can play at (the island difficulty and the map's AI level name them). */
export type CommanderLevel = ColonyDifficulty;

/** A level with the global Very hard difficulty's faster pace (the economy AI's decision cadence, EAI5a). */
export type CommanderPace = CommanderLevel | "veryHard";

/** The level of a faction that no script, map or island gives one. */
export const DEFAULT_COMMANDER_LEVEL: CommanderLevel = "medium";

/**
 * The profile table (A14 plan §7): everything of a level but its utility weights. Medium is the behaviour the
 * commander had before levels existed, so its row only names the shared constants. No level reacts late yet
 * except easy: the plan's 1 s (medium) and 0.5 s (hard) would change medium, which A14-5 must not (A14-8 tunes).
 */
const LEVEL_ROWS: Readonly<Record<CommanderLevel, Omit<CommanderProfile, "weights">>> = {
  easy: {
    dangerWeight: 0.5,
    decisionInterval: 2,
    directorIntervalTicks: secondsToTicks(9),
    focusWeight: 0.5,
    moraleUse: 0.5,
    raidRatio: 1.5,
    reactionTicks: secondsToTicks(2),
    roleUse: "frontAndOverwatch",
    scoutAgeTicks: secondsToTicks(90),
    uncertaintyMargin: 0.6
  },
  hard: {
    dangerWeight: 1.25,
    decisionInterval: 1,
    directorIntervalTicks: secondsToTicks(4),
    focusWeight: 1.25,
    moraleUse: 1.25,
    raidRatio: 1,
    reactionTicks: 0,
    roleUse: "flankPreferred",
    scoutAgeTicks: secondsToTicks(45),
    uncertaintyMargin: 0.25
  },
  medium: {
    dangerWeight: 1,
    decisionInterval: DECISION_INTERVAL,
    directorIntervalTicks: DIRECTOR_INTERVAL_TICKS,
    focusWeight: 1,
    moraleUse: 1,
    raidRatio: RAID_RATIO,
    reactionTicks: 0,
    roleUse: "all",
    scoutAgeTicks: SCOUT_AGE_TICKS,
    uncertaintyMargin: UNCERTAINTY_MARGIN
  }
};

const profileOf = (level: CommanderLevel): CommanderProfile =>
  Object.freeze({ ...LEVEL_ROWS[level], weights: COMMANDER_WEIGHTS[level] });

/**
 * One commander profile per level (A14 plan §7). Difficulty is weights, cadence and reaction time only, never
 * information or a larger search.
 */
export const COMMANDER_PROFILES: Readonly<Record<CommanderLevel, CommanderProfile>> = {
  easy: profileOf("easy"),
  hard: profileOf("hard"),
  medium: profileOf("medium")
};

/** The global Very hard difficulty plays the hard profile with its intervals and reaction delay times this. */
export const VERY_HARD_PACE = 0.75;

/** The hard profile at the Very hard pace (plan §7 step 4); the director keeps whole ticks. */
export const VERY_HARD_COMMANDER_PROFILE: CommanderProfile = Object.freeze({
  ...COMMANDER_PROFILES.hard,
  decisionInterval: COMMANDER_PROFILES.hard.decisionInterval * VERY_HARD_PACE,
  directorIntervalTicks: Math.round(COMMANDER_PROFILES.hard.directorIntervalTicks * VERY_HARD_PACE),
  reactionTicks: Math.round(COMMANDER_PROFILES.hard.reactionTicks * VERY_HARD_PACE)
});

/**
 * The longest decision interval (s) any profile plays at. A saved commander clock is always below its faction's
 * interval, so the save validator bounds every clock by this, whatever level the faction plays.
 */
export const MAX_DECISION_INTERVAL = Math.max(
  VERY_HARD_COMMANDER_PROFILE.decisionInterval,
  ...Object.values(COMMANDER_PROFILES).map((profile) => profile.decisionInterval)
);

/** The global Hard difficulty plays one level above the island's or the map's (plan §7 step 4). */
export const HARDER_COMMANDER_LEVEL: Readonly<Record<CommanderLevel, CommanderLevel>> = {
  easy: "medium",
  hard: "hard",
  medium: "hard"
};

/**
 * How far (tiles) any level looks for the nearest enemy. Squads search this far on every level, so the
 * retreat budget and the regroup rule see the same enemies whatever the weights are.
 */
export const COMMANDER_SEARCH_RADIUS = Math.max(
  ...Object.values(COMMANDER_PROFILES).map((profile) => profile.weights.attackRadius)
);

/**
 * Role use (plan §7): swordsmen flank beside an axeman front while they number at most this share of the
 * axemen. Hard prefers the flank; easy keeps to front and overwatch (no flank, no reserve).
 */
export const FLANK_LIMITS: Readonly<Record<CommanderProfile["roleUse"], number>> = {
  all: 1,
  flankPreferred: 1.5,
  frontAndOverwatch: 0
};

/**
 * Danger matrix (A14 plan §3.3): how much (score units, about tiles) a soldier of the row type prefers a target
 * of the column type. Ordinary cavalry is retired (HORSE-RETIREMENT-01): swordsmen, the fastest foot, hunt
 * archers; archers spend their arrows on unshielded axemen; axemen bypass the swordsmen's shields. The cavalry
 * row and column remain for historical riders only.
 */
export const DANGER_MATRIX: Readonly<Record<MilitaryTroopType, Readonly<Record<MilitaryTroopType, number>>>> = {
  archer: { archer: 0.5, cavalry: 1.5, heavy: 1.5, shield: 0 },
  cavalry: { archer: 2, cavalry: 0.5, heavy: 0, shield: 0 },
  heavy: { archer: 0.5, cavalry: 0.5, heavy: 0, shield: 1 },
  shield: { archer: 2, cavalry: 0.5, heavy: 0.5, shield: 0 }
};
/** Extra danger of the enemy commander hero for every attacker type (killing it removes its aura). */
export const HERO_DANGER = 1.5;
/** The player's automatic targeting weighs the shared danger matrix by this (owner Q5: a small bonus). */
export const PLAYER_DANGER_WEIGHT = 0.25;
/** A computer soldier's squad focus target scores this much better (× the level's `focusWeight`). */
export const FOCUS_BONUS = 2;
/** The focus is chosen among enemies known now this near (tiles) to the group, and kept while this near. */
export const FOCUS_RADIUS = CLOSING_RANGE + 4;

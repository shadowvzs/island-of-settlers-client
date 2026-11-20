import type { MoraleState } from "../../balance/morale";
import type { MilitaryTroopType } from "../military-combat-rules";
import type { ObjectiveUnit } from "../military-commander-objectives";
import type { MilitaryOrder } from "../military-targeting";
import type { SettlementPoint } from "../settlement-types";

/** The four squad actions of the tactical commander (see `military-commander.ts`). */
export type CommanderAction = "attack" | "defend" | "retreat" | "regroup";

/**
 * The role of a squad's role group (A14 plan §3.1): front holds the contact line, overwatch shoots from
 * behind it, flank hits the enemy's side, reserve stands back to replace a broken front.
 */
export type CommanderRole = "front" | "overwatch" | "flank" | "reserve";

export interface CommanderWeights {
  /** Attack: weight, the strength ratio (own / enemy) it wants, and how far (tiles) it looks for enemies. */
  aggression: number;
  attackRatio: number;
  attackRadius: number;
  /** Retreat: weight and the local strength ratio below which it pulls back. */
  caution: number;
  retreatRatio: number;
  /** Regroup and defend weights. */
  cohesion: number;
  defend: number;
}

/**
 * Which roles a level's commander uses (A14 plan §7; the same candidates, only weighed differently): front and
 * overwatch alone, every role, or every role with a wider flank.
 */
export type CommanderRoleUse = "frontAndOverwatch" | "all" | "flankPreferred";

/** How one computer faction's commander plays (A14 plan §7): its weights, cadence and reaction time. */
export interface CommanderProfile {
  /** Seconds between two tactical decisions of the faction. */
  decisionInterval: number;
  /** Ticks between two decisions of the faction's strategic director. */
  directorIntervalTicks: number;
  /** A known enemy soldier counts for the commander and the director once known this long without a break. */
  reactionTicks: number;
  /** Weight of the danger matrix and of the squad focus in its soldiers' targeting (A14-2). */
  dangerWeight: number;
  focusWeight: number;
  /** How much the commander reacts to its soldiers' morale (regroup bonus; A14 plan §7). */
  moraleUse: number;
  roleUse: CommanderRoleUse;
  /** The director's caution about remembered (unseen now) defenders of a target (plan §6). */
  uncertaintyMargin: number;
  /** A raid strikes while own strength over the target's known defence is at least this. */
  raidRatio: number;
  /** A sector unseen for longer than this is worth a scout's visit. */
  scoutAgeTicks: number;
  weights: CommanderWeights;
}

/** What a squad knows when it decides (strengths in soldier-equivalents, distances in tiles). */
export interface SquadView {
  own: number;
  /** Enemy and own strength round the squad (influence near its centre). */
  threat: number;
  support: number;
  /** Mean distance of the members from their centre. */
  spread: number;
  /** Nearest enemy (Infinity: none) and the strength round it. */
  enemyDistance: number;
  enemyStrength: number;
  homeDistance: number;
  current?: CommanderAction;
  /** The squad has used up its retreat time while still pressed: it turns and fights. */
  retreatSpent?: boolean;
  /** Share (0-1) of the members whose morale is shaken (A14-2: they hesitate). */
  shaken?: number;
}

export interface CommanderUnit extends ObjectiveUnit {
  faction: number;
  type: MilitaryTroopType;
  rank: number;
  /** Health share left (0-1). */
  health: number;
  /** Fighting a foe right now (its order is not replaced, except by a retreat). */
  fighting: boolean;
  /** At a siege or otherwise not the commander's to move. */
  busy: boolean;
  /** Its camp or post: where it last arrived (defending walks back there). */
  home: SettlementPoint;
  /** An enemy the deciding faction only remembers (A13 phase 3): its last known place and strength. */
  remembered?: boolean;
  /** The squad (its id) the soldier belonged to at its faction's last decision (A14-2: squads keep their memory). */
  squad?: number;
  /** Morale 0-100 and state (A14-2; absent: steady at the base morale). */
  morale?: number;
  moraleState?: MoraleState;
}

export interface MilitaryCommanderOptions {
  cellsX: number;
  cellsZ: number;
  /**
   * Factions with field soldiers this tick (may repeat). The cheap clock input: without it the
   * factions come from `units`, which is then built every tick.
   */
  factions?: () => readonly number[];
  /** Field soldiers of every side this tick (built only when a faction decides). */
  units: () => readonly CommanderUnit[];
  /** Issues a march order of the computer side (the player's march); false when refused. */
  command: (
    ids: readonly number[],
    point: SettlementPoint,
    faction: number,
    order: MilitaryOrder
  ) => boolean;
  /**
   * The profile a faction plays with. Read once per decision of the faction (its weights) and once per
   * decision cycle (its interval), so a level change acts from the faction's next decision.
   */
  profile: (faction: number) => CommanderProfile;
  isClear: (point: SettlementPoint) => boolean;
  /**
   * A13 knowledge: `faction` knows `unit` only by a hit alert (it is shooting from outside the faction's sight).
   * A role group under such fire scores its current place as more exposed (A14 plan §6). Never true without it.
   */
  knowsByAlertOnly?: (faction: number, unit: CommanderUnit) => boolean;
  /** A14-2: writes a group's focus target (undefined clears it) into its members' field memory. */
  setFocus?: (members: readonly CommanderUnit[], focus: number | undefined) => void;
  /** A14-2: a flank group begins its strike: its members get the strike's morale grace (`STRIKE_SECONDS`). */
  strikeBegins?: (members: readonly CommanderUnit[]) => void;
  /** A14-2: writes the squad id into its members' field memory (`CommanderUnit.squad` at the next decision). */
  setSquad?: (members: readonly CommanderUnit[], squad: number) => void;
  /** Ground height (world units) at a point, for the position choice's height term; flat without it. */
  heightAt?: (point: SettlementPoint) => number;
  /**
   * A13 phase 3: what a deciding faction knows of `units` (its own soldiers, the enemies it knows now and the
   * ones it remembers). Without it every faction sees every soldier (the bare commander of unit tests).
   */
  perceive?: (faction: number, units: readonly CommanderUnit[]) => readonly CommanderUnit[];
}

/** The last decision of one role group of a squad (one group per troop type). */
export interface RoleGroupMemory {
  type: MilitaryTroopType;
  role: CommanderRole;
  /** The point the group was last sent to (absent: no order stands). */
  point?: SettlementPoint;
  /** Decisions since the group's last order (the churn guard, capped). */
  age: number;
  /** A14-2: a flank group striking the enemy's archers: decisions since the strike began (1 = this one). */
  strike?: number;
}

/** The last decision of a squad. Never mutated: an unchanged decision keeps the same object. */
export interface SquadMemory {
  action: CommanderAction;
  target?: SettlementPoint;
  /** Role groups of an attacking or defending squad, in troop type order (A14-1). */
  groups?: readonly RoleGroupMemory[];
}

/** Where the squad is sent and with which order. */
export interface SquadOrder {
  order: MilitaryOrder;
  point: SettlementPoint;
  resuming: boolean;
}

/** One squad's situation at a decision: its members, where it stands and what it sees. */
export interface SquadContext {
  centre: SettlementPoint;
  home: SettlementPoint;
  marching: boolean;
  nearest: CommanderUnit | undefined;
  squad: readonly CommanderUnit[];
  view: SquadView;
}

/** A role group's part of a squad decision (debug overlay, fixtures): its standing point, whether it was ordered. */
export interface CommanderGroupDecision {
  issued: boolean;
  /** A14-2: sent to the reserve for its morale alone (a morale order in the fixtures, not churn). */
  moraleRelief?: boolean;
  /** A14-2: a flank group striking the enemy's archers from its flank point. */
  strike?: boolean;
  role: CommanderRole;
  target?: SettlementPoint;
  troop: MilitaryTroopType;
}

/** A squad decision as the debug overlay shows it. */
export interface CommanderDecision {
  /** A14-1: the squad's role groups when it was split (absent: the whole squad took `target`). */
  groups?: readonly CommanderGroupDecision[];
  /** A whole-squad decision issued a new order (role groups report theirs per group). */
  issued?: boolean;
  faction: number;
  squad: number;
  centre: SettlementPoint;
  action: CommanderAction;
  score: number;
  scores: Record<CommanderAction, number>;
  target?: SettlementPoint;
  members: number;
}

import type { MoraleState } from "../../balance/morale";
import type { MilitaryTroopType } from "../military-combat-rules";
import type { SettlementPoint } from "../settlement-types";
import type { CommanderUnit } from "./commander-types";
import type { ArmyRequest, CommanderStrategicApi, IntentState } from "./strategic-intents";

/** The strategic macros (A14 plan §5.1): HTN-like, each with a fixed method (task list). */
export type DirectorMacro = "hold" | "scout" | "raid" | "regroup" | "strike" | "defend" | "withdraw";
export const DIRECTOR_MACROS: readonly DirectorMacro[] =
  ["hold", "scout", "raid", "regroup", "strike", "defend", "withdraw"];

/**
 * Where a force came from: a colony counterattack permit (the colony's raid code takes the soldiers back for
 * the hit), a scripted wave (strikes its destination at once, never withdraws) or any other permit (the
 * director runs every task itself; the forces of the economy AI's intents are permits, A14-4c).
 */
export type ForceKind = "colony" | "wave" | "permit";
export const FORCE_KINDS: readonly ForceKind[] = ["colony", "wave", "permit"];

/** One force of a computer faction (saved). Points are plain copies; members ascend by uid. */
export interface DirectorForce {
  id: number;
  kind: ForceKind;
  macro: DirectorMacro;
  /** Index of the running task of the macro's method. */
  task: number;
  /** Tick the running macro (or its current task, where a task times out) began. */
  since: number;
  members: number[];
  /** Where it formed and withdraws to (a fort entrance, a wave's spawn). */
  home: SettlementPoint;
  /** Where it musters and regroups (plan §5.1 staging cell). */
  staging: SettlementPoint;
  /** A wave's destination (an area strike). */
  goal?: SettlementPoint;
  /** The known enemy building it strikes or raids. */
  target?: number;
  /** The detached scout and the scout goals it has visited this trip. */
  scout?: number;
  visited?: number;
  /** Strength at the start (integer, ×100) for the withdraw and raid-loss rules. */
  start: number;
  /** The faction's intent it carries out (its index; `DISMISSED_INTENT` once that intent was dropped). */
  intent?: number;
  /** A defend or hold intent's area radius (tiles) round `home`: the post it watches. */
  radius?: number;
}

/** A force whose intent the economy AI dropped: it withdraws and is released. */
export const DISMISSED_INTENT = -1;

/** A faction's director state (saved): its next due tick, the next force id and its forces. */
export interface DirectorFaction {
  faction: number;
  next: number;
  nextForce: number;
  forces: DirectorForce[];
  /** The economy AI's intents (A14-4c); absent while the director acts on its own defaults. */
  intents?: IntentState[];
  /** What the army wants built, as of the faction's last decision (absent: nothing, or no intents). */
  requests?: ArmyRequest[];
}

export interface DirectorSave { factions: DirectorFaction[] }

/** A known enemy building the director may strike, with its raid priority tier. */
export interface DirectorTarget { uid: number; x: number; z: number; tier: number }

/**
 * What the director knows (owner Q3): terrain, the enemy's landing harbour / key building from the start
 * (scout goals), and every other site only once seen. A14-4a fills it from `FactionKnowledge`; A14-4b replaces
 * the sources with the known-sites ledger and the sector staleness (more scout goals), not the interface.
 */
export interface DirectorKnowledge {
  /** Known enemy buildings that may be attacked now, most urgent tier first. */
  targets: (faction: number) => readonly DirectorTarget[];
  /** The faction has seen the enemy building `uid` (its known-sites ledger; no building is read). */
  knowsSite: (faction: number, uid: number) => boolean;
  /** Up to `SCOUT_GOALS` places worth scouting from `from`, nearest first. */
  scoutGoals: (faction: number, from: SettlementPoint) => readonly SettlementPoint[];
  /** Own soldiers, enemies known now and remembered ones (the commander's perception). */
  perceive: (faction: number) => readonly CommanderUnit[];
}

/** A member as the director weighs it; undefined when gone (fallen, back in a building, captured). */
export interface DirectorMember extends SettlementPoint {
  uid: number;
  type: MilitaryTroopType;
  rank: number;
  health: number;
  morale?: number;
  moraleState?: MoraleState;
  /** Walking to a destination now. */
  marching: boolean;
}

/** A launch (permit) handed to the director. */
export interface ForceLaunch {
  home: SettlementPoint;
  /** A scripted wave's destination: the force strikes there at once. */
  goal?: SettlementPoint;
  kind: ForceKind;
}

export type MilitaryOrderMode = "move" | "attackMove";

/** The order layer the director drives (all orders are the computer side's ordinary march/siege orders). */
export interface DirectorOrders {
  march: (ids: readonly number[], point: SettlementPoint, faction: number, mode: MilitaryOrderMode) => boolean;
  siege: (ids: readonly number[], site: number, faction: number) => boolean;
  /** A withdrawn soldier at home goes into an own building there (false: it stays in the field). */
  rejoin: (uid: number, faction: number) => boolean;
  isClear: (point: SettlementPoint) => boolean;
}

/** Hands a colony force's soldiers back to the colony's raid code (target: a known site, or none). */
export type ForceHandover = (ids: readonly number[], target: number | undefined) => boolean;

/** Per-force status (the economy AI reads its intents' statuses through `strategy.status`, A14-4c). */
export interface DirectorForceStatus {
  force: number;
  kind: ForceKind;
  macro: DirectorMacro;
  members: number;
  strength: number;
  target?: number;
}

/**
 * The director as other simulation parts see it (`context.militaryDirector`): the colony counterattacks
 * and scripted waves launch through it; the economy AI states its intents through `strategy` (A14-4c).
 */
export interface MilitaryDirectorPort {
  /** A permit: these computer soldiers form a force (≤ 3 per faction); false when refused. */
  launch: (faction: number, ids: readonly number[], launch: ForceLaunch) => boolean;
  /** The soldier belongs to a director force (the colony raid code leaves it alone). */
  owns: (uid: number) => boolean;
  /** The soldier follows a director task the tactical commander must not replace (scout, muster, withdraw). */
  holds: (uid: number) => boolean;
  setHandover: (kind: ForceKind, handover: ForceHandover) => void;
  status: (faction: number) => readonly DirectorForceStatus[];
  /** The economy AI's contract (A14-4c, plan §5.4): intents in, receipts, statuses and army requests out. */
  strategy: CommanderStrategicApi;
}

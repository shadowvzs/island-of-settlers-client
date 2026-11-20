import type { MilitaryTroopType } from "../military-combat-rules";
import type { MilitaryOrder } from "../military-targeting";
import type { SettlementPoint } from "../settlement-types";
import type { CommanderAction, CommanderRole, SquadView } from "./commander-types";

/**
 * What became of a squad decision's order:
 * - issued: a march order went out to `ordered` soldiers;
 * - unchanged: the same action with the same target already stands;
 * - noTarget: the action has no place to send the squad (it keeps what it does);
 * - noTaker: every member is fighting, closing or on its own retreat;
 * - refused: the order layer refused the march.
 */
export type CommanderOrderOutcome = "issued" | "unchanged" | "noTarget" | "noTaker" | "refused";

/** One squad decision with everything it was scored from (A16 diagnostics, A14 fixtures). */
export interface CommanderTraceRecord {
  action: CommanderAction;
  centre: SettlementPoint;
  faction: number;
  /** Members of the squad (or of the role group), and how many of them took the order. */
  members: number;
  order?: MilitaryOrder;
  ordered: number;
  outcome: CommanderOrderOutcome;
  /** The order resumes the squad's own march (a raid or scripted march it was turned from). */
  resuming: boolean;
  /** A14-1: the record is one role group of the squad (its role and troop type); absent: the whole squad. */
  role?: CommanderRole;
  troop?: MilitaryTroopType;
  scores: Readonly<Record<CommanderAction, number>>;
  /** The squad id: the lowest uid of its members. */
  squad: number;
  target?: SettlementPoint;
  view: Readonly<SquadView>;
}

export type CommanderTraceSink = (record: CommanderTraceRecord) => void;

let sink: CommanderTraceSink | null = null;

/**
 * Commander decision trace (tests, benches and diagnostics only). Off unless a sink is installed: the
 * commander then reports every squad decision. Like the tick phase recorder it reads and writes no
 * simulation state, so the state hash is identical with and without it; while off a decision pays one
 * null check and builds no record.
 */
export const setCommanderTraceSink = (next: CommanderTraceSink | null) => {
  sink = next;
};

export const isCommanderTraceActive = () => sink !== null;

export const traceCommanderDecision = (record: CommanderTraceRecord) => {
  if (sink !== null) sink(record);
};

import { type CommanderInput,isCommanderInput } from "../../../../island-of-settlers-shared/src/commander-input";
import { isSaveInteger, isSaveObject } from "./save-validation";

export const COMMANDER_CONTROL_LEASE_TICKS = 10;
export const COMMANDER_ESCORT_LIMIT = 32;
export type CommanderFollowType = "shield" | "heavy" | "archer";
export interface CommanderControlLease {
  actor: number;
  commanderId: string;
  generation: number;
  expiresTick: number;
  lastInputTick: number;
  input: CommanderInput;
  processedButtons: number;
}
export interface CommanderHorseControl {
  actor: number;
  horse: number;
  phase: "waiting" | "calling" | "mounting";
  timer: number;
  replan: number;
}
export interface MilitaryDirectSave {
  version: 1;
  nextGeneration: number;
  lease?: CommanderControlLease;
  horse?: CommanderHorseControl;
  roster: number[];
  follow: Record<CommanderFollowType, boolean>;
  /** Timed directional guard, with its recovery preserved through ownership changes and reload. */
  guard: number;
  guardRecovery: number;
  escort: { remaining: number; anchor?: { x: number; z: number } };
}

export const emptyMilitaryDirectSave = (): MilitaryDirectSave => ({
  version: 1, nextGeneration: 1, roster: [], follow: { shield: true, heavy: true, archer: true },
  guard: 0, guardRecovery: 0, escort: { remaining: 0 }
});

const bounded = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const validLease = (lease: unknown, nextGeneration: number, soldiers: ReadonlySet<number>) =>
  lease === undefined || (isSaveObject(lease) && isSaveInteger(lease.actor) && soldiers.has(lease.actor) &&
    typeof lease.commanderId === "string" && lease.commanderId.length <= 120 && lease.commanderId.length > 0 &&
    isSaveInteger(lease.generation, 1) && lease.generation < nextGeneration &&
    isSaveInteger(lease.lastInputTick) && isSaveInteger(lease.expiresTick) &&
    lease.expiresTick - lease.lastInputTick <= COMMANDER_CONTROL_LEASE_TICKS &&
    lease.expiresTick > lease.lastInputTick && isCommanderInput(lease.input) &&
    lease.input.generation === lease.generation && isSaveInteger(lease.processedButtons) && lease.processedButtons <= 15);
const validHorse = (horse: unknown, soldiers: ReadonlySet<number>) =>
  horse === undefined || (isSaveObject(horse) && isSaveInteger(horse.actor) && soldiers.has(horse.actor) &&
    isSaveInteger(horse.horse) && ["waiting", "calling", "mounting"].includes(horse.phase as string) &&
    bounded(horse.timer, .6) && bounded(horse.replan, 1));
const validEscort = (value: unknown) => {
  if (!isSaveObject(value) || !bounded(value.remaining, .5)) return false;
  const anchor = value.anchor;
  return anchor === undefined || isSaveObject(anchor) && typeof anchor.x === "number" && Number.isFinite(anchor.x) &&
    typeof anchor.z === "number" && Number.isFinite(anchor.z);
};

/** Validate before replacement. Runtime membership is reconciled separately when a soldier departs. */
export const militaryDirectSaveProblem = (value: unknown, soldiers: ReadonlySet<number>): string | null => {
  if (value === undefined) return null;
  if (!isSaveObject(value) || value.version !== 1 || !isSaveInteger(value.nextGeneration, 1) ||
    value.nextGeneration > 0x7fffffff || !Array.isArray(value.roster) || value.roster.length > COMMANDER_ESCORT_LIMIT ||
    !value.roster.every(uid => isSaveInteger(uid) && soldiers.has(uid)) ||
    new Set(value.roster).size !== value.roster.length || !isSaveObject(value.follow) ||
    !["shield", "heavy", "archer"].every(type => typeof (value.follow as Record<string, unknown>)[type] === "boolean") ||
    !bounded(value.guard, .5) || !bounded(value.guardRecovery, 2) || !validEscort(value.escort))
    return "Invalid commander control state";
  if (!validLease(value.lease, value.nextGeneration, soldiers)) return "Invalid commander control lease";
  if (!validHorse(value.horse, soldiers)) return "Invalid commander horse control";
  return null;
};

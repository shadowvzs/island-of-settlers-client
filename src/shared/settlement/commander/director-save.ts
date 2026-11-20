import { MAX_FORCES, SCOUT_GOALS } from "../../balance/commander-director";
import { isSaveObject } from "../save-validation";
import {
  DIRECTOR_MACROS, type DirectorForce, type DirectorSave, DISMISSED_INTENT, FORCE_KINDS
} from "./director-types";
import { intentsSaveError } from "./strategic-intents";

const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const point = (value: unknown) => isSaveObject(value) && Number.isFinite(value.x) && Number.isFinite(value.z) &&
  Math.abs(Number(value.x)) <= 2048 && Math.abs(Number(value.z)) <= 2048;
const optional = (value: unknown, valid: (value: unknown) => boolean) => value === undefined || valid(value);
const ascendingUnique = (values: readonly number[]) =>
  values.every((value, index) => !index || value > values[index - 1]!);

const forceError = (force: unknown, soldierIds: ReadonlySet<number>, members: Set<number>) => {
  if (!isSaveObject(force) || !count(force.id) || !FORCE_KINDS.includes(force.kind as never) ||
    !DIRECTOR_MACROS.includes(force.macro as never) || !count(force.task) || force.task > 3 || !count(force.since) ||
    !count(force.start) || !point(force.home) || !point(force.staging) || !optional(force.goal, point) ||
    !optional(force.target, count) || !optional(force.scout, count) ||
    !optional(force.intent, value => Number.isSafeInteger(value) && Number(value) >= DISMISSED_INTENT) ||
    !optional(force.radius, value => Number.isFinite(value) && Number(value) >= 0) ||
    !optional(force.visited, value => count(value) && value <= SCOUT_GOALS)) return true;
  const ids = force.members;
  if (!Array.isArray(ids) || !ids.length || !ids.every(count) || !ascendingUnique(ids as number[])) return true;
  for (const uid of ids as number[]) {
    if (!soldierIds.has(uid) || members.has(uid)) return true;
    members.add(uid);
  }
  return force.scout !== undefined && !(ids as number[]).includes(force.scout as number);
};

/**
 * Validation of the saved director (A14-4a, settlement format 11): factions ascending, ≤ 3 forces each with
 * ascending ids below `nextForce`, every member a saved soldier in at most one force. A14-4c (format 13): a
 * faction may carry the economy AI's intents (then also without a force) and its army requests.
 */
export const directorSaveError = (saved: unknown, soldierIds: ReadonlySet<number>) => {
  if (saved === undefined) return null;
  if (!isSaveObject(saved) || !Array.isArray(saved.factions)) return "Invalid military director";
  const members = new Set<number>();
  let previous = 0;
  for (const entry of saved.factions as unknown[]) {
    if (!isSaveObject(entry) || !count(entry.faction) || entry.faction <= previous || !count(entry.next) ||
      !count(entry.nextForce) || !Array.isArray(entry.forces) || entry.forces.length > MAX_FORCES ||
      (!entry.forces.length && entry.intents === undefined)) return "Invalid military director faction";
    previous = entry.faction;
    const intentsError = intentsSaveError(entry.intents, entry.requests);
    if (intentsError) return intentsError;
    const forces = entry.forces as DirectorForce[], intents = Array.isArray(entry.intents) ? entry.intents.length : 0;
    if (forces.some(force => force.intent !== undefined && force.intent >= intents))
      return "Invalid military director force intent";
    if (forces.some(force => forceError(force, soldierIds, members))) return "Invalid military director force";
    if (!ascendingUnique(forces.map(force => force.id)) || forces.some(force => force.id >= Number(entry.nextForce)))
      return "Invalid military director force ids";
  }
  return null;
};

/** A deep copy of the director state (saves never share live arrays or points). */
export const copyDirector = (saved: DirectorSave): DirectorSave => structuredClone(saved);

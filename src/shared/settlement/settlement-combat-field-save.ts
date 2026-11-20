import { restoreEntries, saveEntries, type SavedEntries } from "./military-field-save";
import type { ArrivingBlocksSave, MarchSettlingSave } from "./military-formation";
import type { MilitaryMarchRoutesSave } from "./military-long-routes";
import type { MilitaryMeleeSave } from "./military-melee";
import type { MilitaryMountPointsSave } from "./military-mount-points";
import type { MilitaryRidersSave } from "./military-riders";
import type { MilitarySteeringSave } from "./military-steering";
import type { StructureAssaultSave } from "./military-structure-assault";
import type { MilitaryStuckSave } from "./military-stuck";
import type { CombatCore, FieldMemory, MountCheck } from "./settlement-combat-core";
import type { SiegeFieldSave } from "./settlement-siege";

/** The battlefield working state of every combat module (see `military-field-save.ts`). */
export interface MilitaryFieldSave {
  arriving: ArrivingBlocksSave;
  assault: StructureAssaultSave;
  marches: MilitaryMarchRoutesSave;
  melee: MilitaryMeleeSave;
  memories: SavedEntries<FieldMemory>;
  mountChecks: SavedEntries<MountCheck>;
  mounts: MilitaryMountPointsSave;
  riders: MilitaryRidersSave;
  settling: MarchSettlingSave;
  sieges: SiegeFieldSave;
  steering: MilitarySteeringSave;
  stuck: MilitaryStuckSave;
}

interface Savable<Saved> { save: () => Saved; restore: (saved: Saved | undefined) => void }

/** The combat modules outside the shared core whose working state is saved. */
export interface CombatFieldParts {
  assault: Savable<StructureAssaultSave>;
  core: CombatCore;
  riders: Savable<MilitaryRidersSave>;
}

/** Every entry list empty: the whole block is omitted (saves without a battle stay as they were). */
const isEmptyField = (value: unknown): boolean =>
  Array.isArray(value) ? value.length === 0 : Object.values(value as object).every(isEmptyField);

export const saveCombatField = ({ assault, core, riders }: CombatFieldParts): MilitaryFieldSave | undefined => {
  const field: MilitaryFieldSave = {
    arriving: core.arriving.save(), assault: assault.save(), marches: core.marches.save(), melee: core.melee.save(),
    memories: saveEntries(core.memories), mountChecks: saveEntries(core.mountChecks), mounts: core.mounts.save(),
    riders: riders.save(), settling: core.settling.save(), sieges: core.sieges.saveField(),
    steering: core.steering.save(), stuck: core.stuck.save()
  };
  return isEmptyField(field) ? undefined : field;
};

/** Restores every module (a missing block, as in a save without a battle, leaves them empty). */
export const restoreCombatField = (
  { assault, core, riders }: CombatFieldParts, saved: Partial<MilitaryFieldSave> | undefined
) => {
  core.arriving.restore(saved?.arriving); assault.restore(saved?.assault); core.marches.restore(saved?.marches);
  core.melee.restore(saved?.melee); restoreEntries(core.memories, saved?.memories);
  restoreEntries(core.mountChecks, saved?.mountChecks); core.mounts.restore(saved?.mounts);
  riders.restore(saved?.riders); core.settling.restore(saved?.settling); core.sieges.restoreField(saved?.sieges);
  core.steering.restore(saved?.steering); core.stuck.restore(saved?.stuck);
};

/** Saved values hold only finite numbers, strings, booleans, arrays and plain objects (absent fields allowed). */
const MAXIMUM_DEPTH = 8;
const MAXIMUM_ENTRIES = 200_000;
const isPlainData = (value: unknown, depth = 0): boolean => {
  if (value === undefined) return depth > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (!value || typeof value !== "object" || depth > MAXIMUM_DEPTH) return false;
  const items = Array.isArray(value) ? value : Object.values(value);
  return items.length <= MAXIMUM_ENTRIES && items.every(item => isPlainData(item, depth + 1));
};
const isEntryList = (value: unknown) => value === undefined || Array.isArray(value) && value.every(entry =>
  Array.isArray(entry) && entry.length === 2 && Number.isSafeInteger(entry[0]) && entry[0] >= 0);

/** Entry lists by path below the field block (`melee.places`: the `places` list of `melee`). */
const ENTRY_LISTS = ["assault", "marches", "memories", "mountChecks", "mounts", "settling", "stuck",
  "melee.claimants", "melee.firstBlows", "melee.places", "riders.idle", "riders.returning", "sieges.approaches",
  "sieges.helpers", "sieges.queue.places", "sieges.queue.resting", "steering.detours", "steering.motions"];

const at = (field: object, path: string) =>
  path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], field);

/** Null when `field` (the optional `field` block of a combat save) is plain, well-formed data. */
export const militaryFieldSaveError = (field: unknown) => {
  if (field === undefined) return null;
  if (!field || typeof field !== "object" || Array.isArray(field) || !isPlainData(field))
    return "Invalid military field state";
  const arriving = (field as Partial<MilitaryFieldSave>).arriving;
  if (arriving !== undefined && (!Array.isArray(arriving) || !arriving.every(block =>
    Array.isArray(block?.uids) && Array.isArray(block.waiting) && block.destination)))
    return "Invalid military field state";
  return ENTRY_LISTS.every(path => isEntryList(at(field, path))) ? null : "Invalid military field state";
};

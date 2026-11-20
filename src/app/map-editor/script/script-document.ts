import type {
  MapScript, ScriptFolder, ScriptIdCounters
} from "../../../../../island-of-settlers-shared/src/script/types/script";
import type {
  ScriptAction, ScriptTrigger
} from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { RANDOM_ID_RADIX, SCRIPT_ID_PREFIXES, STEP_ID_PREFIX } from "./constants";

/**
 * Immutable edits of the map script document (design §4.1): ids from the per-map counters (never reused), triggers,
 * folders and step ids. Every function returns a new script; the workspace store keeps the history.
 */

type CounterKind = keyof ScriptIdCounters;

const QUEST_BOOK_ID = "map-book";

/** A random script document id (kept on save/export, rev M5). */
export const createScriptUid = () =>
  `script-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(RANDOM_ID_RADIX).slice(2)}`;

/** The empty script of a map that had none (the first edit creates it). */
export const createEmptyMapScript = (scriptUid = createScriptUid()): MapScript => ({
  actors: [], cameraShots: [], folders: [], homeRewards: [],
  nextIds: { actor: 0, folder: 0, region: 0, reward: 0, trigger: 0, variable: 0 },
  quests: { daily: "off", dailyResetUtcMinutes: 0, groups: [], id: QUEST_BOOK_ID, quests: [], revision: 1,
    version: 1 },
  regions: [], revision: 1, scriptUid, sequences: [], triggers: [], variables: [], version: 1
});

const idsInUse = (script: MapScript, kind: CounterKind): ReadonlySet<string> => {
  switch (kind) {
    case "actor": return new Set(script.actors.map(item => item.id));
    case "folder": return new Set(script.folders.map(item => item.id));
    case "region": return new Set(script.regions.map(item => item.id));
    case "reward": return new Set(script.homeRewards.map(item => item.id));
    case "trigger": return new Set(script.triggers.map(item => item.id));
    case "variable": return new Set(script.variables.map(item => item.id));
  }
};

/** The next free id of a kind and the script with its counter raised (imported ids above the counter are skipped). */
export const allocateId = (script: MapScript, kind: CounterKind): { id: string; script: MapScript } => {
  const used = idsInUse(script, kind);
  let counter = script.nextIds[kind];
  let id: string;
  do {
    counter += 1;
    id = `${SCRIPT_ID_PREFIXES[kind]}-${counter}`;
  } while (used.has(id));
  return { id, script: { ...script, nextIds: { ...script.nextIds, [kind]: counter } } };
};

/** Allocates several ids of one kind at once. */
export const allocateIds = (script: MapScript, kind: CounterKind, count: number) => {
  const ids: string[] = [];
  let next = script;
  for (let index = 0; index < count; index += 1) {
    const allocated = allocateId(next, kind);
    ids.push(allocated.id);
    next = allocated.script;
  }
  return { ids, script: next };
};

const CHILD_LISTS = ["then", "else", "body"] as const;

/** Every step id used in an action list, nested steps included. */
export const collectStepIds = (actions: readonly ScriptAction[], into = new Set<string>()) => {
  for (const step of actions) {
    into.add(step.id);
    for (const field of CHILD_LISTS) {
      const children = (step as unknown as Record<string, unknown>)[field];
      if (Array.isArray(children)) collectStepIds(children as ScriptAction[], into);
    }
  }
  return into;
};

/** The next free `s<n>` step id of an action list. */
export const nextStepId = (actions: readonly ScriptAction[], reserved: ReadonlySet<string> = new Set()) => {
  const used = collectStepIds(actions);
  let counter = used.size + reserved.size;
  let id: string;
  do {
    counter += 1;
    id = `${STEP_ID_PREFIX}${counter}`;
  } while (used.has(id) || reserved.has(id));
  return id;
};

/** Gives every step of `steps` (nested ones too) a fresh id that is unused in `actions`. */
export const withFreshStepIds = (steps: readonly ScriptAction[], actions: readonly ScriptAction[]) => {
  const reserved = new Set<string>();
  const renumber = (list: readonly ScriptAction[]): ScriptAction[] => list.map(step => {
    const id = nextStepId(actions, reserved);
    reserved.add(id);
    const copy = { ...step, id } as Record<string, unknown>;
    for (const field of CHILD_LISTS)
      if (Array.isArray(copy[field])) copy[field] = renumber(copy[field] as ScriptAction[]);
    return copy as unknown as ScriptAction;
  });
  return renumber(steps);
};

/** A new enabled trigger with no event, condition or action. */
export const createTrigger = (id: string, name: string, folderId: string | null): ScriptTrigger => ({
  actions: [], concurrency: "queue", conditions: { k: "all", of: [] }, enabled: true, events: [], folderId, id,
  name, runLimit: null
});

export const replaceTrigger = (script: MapScript, trigger: ScriptTrigger): MapScript => ({
  ...script, triggers: script.triggers.map(item => (item.id === trigger.id ? trigger : item))
});

export const addTrigger = (script: MapScript, name: string, folderId: string | null) => {
  const { id, script: next } = allocateId(script, "trigger");
  const trigger = createTrigger(id, name, folderId);
  return { script: { ...next, triggers: [...next.triggers, trigger] }, trigger };
};

export const removeTrigger = (script: MapScript, triggerId: string): MapScript => ({
  ...script, triggers: script.triggers.filter(item => item.id !== triggerId)
});

export const addFolder = (script: MapScript, name: string, parentId: string | null = null) => {
  const { id, script: next } = allocateId(script, "folder");
  const folder: ScriptFolder = { id, name, parentId };
  return { folder, script: { ...next, folders: [...next.folders, folder] } };
};

export const renameFolder = (script: MapScript, folderId: string, name: string): MapScript => ({
  ...script, folders: script.folders.map(folder => (folder.id === folderId ? { ...folder, name } : folder))
});

/** Removes a folder; its triggers and sub-folders move to its parent (nothing is deleted with it). */
export const removeFolder = (script: MapScript, folderId: string): MapScript => {
  const folder = script.folders.find(item => item.id === folderId);
  if (!folder) return script;
  return {
    ...script,
    folders: script.folders.filter(item => item.id !== folderId)
      .map(item => (item.parentId === folderId ? { ...item, parentId: folder.parentId } : item)),
    triggers: script.triggers.map(item => (item.folderId === folderId ? { ...item, folderId: folder.parentId } : item))
  };
};

export const moveTriggerToFolder = (script: MapScript, triggerId: string, folderId: string | null): MapScript => {
  const trigger = script.triggers.find(item => item.id === triggerId);
  return trigger ? replaceTrigger(script, { ...trigger, folderId }) : script;
};

/** Moves an item of a list by `offset` places (clamped); the same list when it cannot move. */
export const moveListItem = <T>(list: readonly T[], index: number, offset: number): T[] => {
  const target = Math.max(0, Math.min(list.length - 1, index + offset));
  if (target === index || index < 0 || index >= list.length) return [...list];
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item as T);
  return copy;
};

/** Quest ids are book-local strings: `quest-<n>`, the first free numbers. */
export const freeQuestIds = (script: MapScript, count: number) => {
  const used = new Set(script.quests.quests.map(item => item.id));
  const ids: string[] = [];
  for (let number = 1; ids.length < count; number += 1) if (!used.has(`quest-${number}`)) ids.push(`quest-${number}`);
  return ids;
};

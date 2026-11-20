import type { QuestText } from "../../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type {
  QuestDeadline, QuestGroup, QuestObjective, QuestRepeat, ScriptQuest
} from "../../../../../../island-of-settlers-shared/src/script/types/quests";
import type { MapScript } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import { numberLiteral } from "../factory";
import { freeQuestIds, moveListItem } from "../script-document";
import { itemUsers } from "../users";
import {
  DAY_MS,   type DeadlineChoice, DEFAULT_COUNTER, DEFAULT_COUNTER_TARGET, DEFAULT_DEADLINE_SECONDS, DEFAULT_INTERVAL_DAYS,
MINUTES_PER_DAY, MINUTES_PER_HOUR, type ObjectiveChoice
} from "./constants";

/**
 * Pure edits of the quest book (design §4.10, §13.6): quests in list order, "Completed when", deadlines, repeats,
 * groups and the delete refusal while a trigger, quest or board references a quest.
 */

/** A new visible quest completed by a trigger ("by a trigger"), once, activated by its group. */
export const createQuest = (id: string, title: QuestText): ScriptQuest => ({
  cost: [], deadline: null, failure: null, id, objective: { kind: "scripted" }, onActivate: [], onFailure: [],
  onSuccess: [], repeat: { kind: "once", retryAfterFail: false }, title, visibility: "visible"
});

export const addQuest = (script: MapScript, title: QuestText) => {
  const [id] = freeQuestIds(script, 1) as [string];
  const quest = createQuest(id, title);
  return { quest, script: { ...script, quests: { ...script.quests, quests: [...script.quests.quests, quest] } } };
};

export const replaceQuest = (script: MapScript, quest: ScriptQuest): MapScript => ({
  ...script, quests: { ...script.quests, quests: script.quests.quests.map(item => (item.id === quest.id ? quest
    : item)) }
});

/** The owners that reference a quest (the quest itself excluded). */
export const questUsers = (script: MapScript, id: string) => itemUsers(script, ["quest"], id, `quest:${id}`);

export type QuestEditResult = { changed: true; script: MapScript } | { changed: false; users: string[] };

export const removeQuest = (script: MapScript, id: string): QuestEditResult => {
  const users = questUsers(script, id);
  if (users.length) return { changed: false, users };
  return { changed: true, script: { ...script, quests: { ...script.quests,
    quests: script.quests.quests.filter(item => item.id !== id) } } };
};

/** Moves a quest in the book's list (a sequential group activates in this order). */
export const moveQuest = (script: MapScript, id: string, offset: number): MapScript => {
  const quests = script.quests.quests;
  return { ...script, quests: { ...script.quests,
    quests: moveListItem(quests, quests.findIndex(item => item.id === id), offset) } };
};

/** The "Completed when" choice of an objective; built-in kinds (from templates) have none. */
export const objectiveChoice = (objective: QuestObjective): ObjectiveChoice | null =>
  (objective.kind === "condition" || objective.kind === "counterReached" || objective.kind === "scripted"
    ? objective.kind : null);

/** The objective of a choice (an empty condition, a counter of tools, "by a trigger"). */
export const objectiveOf = (choice: ObjectiveChoice): QuestObjective => {
  if (choice === "condition") return { condition: { k: "all", of: [] }, kind: "condition", progress: null };
  if (choice === "counterReached") return { counter: DEFAULT_COUNTER, kind: "counterReached", since: "activation",
    target: DEFAULT_COUNTER_TARGET };
  return { kind: "scripted" };
};

/** Progress shown for a condition objective: on starts at 0 / 1, off removes it. */
export const withProgress = (objective: QuestObjective, on: boolean): QuestObjective => {
  if (objective.kind !== "condition") return objective;
  return { ...objective, progress: on ? { current: numberLiteral(0), target: numberLiteral(1) } : null };
};

export const deadlineChoice = (deadline: QuestDeadline | null): DeadlineChoice => deadline?.kind ?? "none";

/** The deadline of a kind; the date kind starts one day after now (UTC ms). */
export const deadlineOf = (choice: DeadlineChoice, now: number): QuestDeadline | null => {
  switch (choice) {
    case "none": return null;
    case "playTime": case "gameTime": return { kind: choice, seconds: DEFAULT_DEADLINE_SECONDS };
    case "date": return { at: numberLiteral(now + DEFAULT_INTERVAL_DAYS * DAY_MS), kind: "date" };
    case "dateAfterActivation": return { days: DEFAULT_INTERVAL_DAYS, hours: 0, kind: choice, minutes: 0 };
  }
};

/** The repeat of a kind, keeping "retry after a failure". */
export const repeatOf = (kind: QuestRepeat["kind"], current: QuestRepeat): QuestRepeat => {
  const { retryAfterFail } = current;
  switch (kind) {
    case "once": return { kind, retryAfterFail };
    case "onCompletion": return { kind, maxClaims: null, retryAfterFail };
    case "interval": return { days: DEFAULT_INTERVAL_DAYS, hours: 0, kind, minutes: 0, retryAfterFail };
    case "calendar": return { kind, minuteUtc: 0, retryAfterFail };
  }
};

/** A whole, non-negative number from an input (0 when empty or invalid). */
export const wholeNumber = (text: string) => {
  const value = Math.round(Number(text));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/** A calendar field from its select ("" = any): the rule without the field, or with it. */
export const withCalendarField = (repeat: QuestRepeat, field: "day" | "month" | "weekday", text: string) => {
  if (repeat.kind !== "calendar") return repeat;
  const { [field]: _old, ...rest } = repeat;
  return text === "" ? rest : { ...rest, [field]: Number(text) };
};

/** `HH:MM` (UTC) ↔ minutes after midnight. */
export const minuteOfDay = (text: string) => {
  const [hours = 0, minutes = 0] = text.split(":").map(Number);
  return Math.max(0, Math.min(MINUTES_PER_DAY - 1, hours * MINUTES_PER_HOUR + minutes));
};

export const clockText = (minute: number) => `${String(Math.floor(minute / MINUTES_PER_HOUR)).padStart(2, "0")}:${
  String(minute % MINUTES_PER_HOUR).padStart(2, "0")}`;

/** Adds or removes a prerequisite quest. */
export const togglePrerequisite = (quest: ScriptQuest, id: string, on: boolean): ScriptQuest => {
  const rest = (quest.prerequisites ?? []).filter(ref => ref.id !== id);
  const prerequisites = on ? [...rest, { id, k: "ref" as const, kind: "quest" as const }] : rest;
  const { prerequisites: _old, ...base } = quest;
  return prerequisites.length ? { ...base, prerequisites } : base;
};

/** Groups: add (parallel, no unlock), change, remove (refused while a quest or group needs it). */
export const addGroup = (script: MapScript, title: QuestText) => {
  const used = new Set(script.quests.groups.map(group => group.id));
  let number = script.quests.groups.length + 1;
  while (used.has(`group-${number}`)) number += 1;
  const group: QuestGroup = { activation: "parallel", completionTopUp: null, id: `group-${number}`,
    requiresGroups: [], title, unlock: null };
  return { ...script, quests: { ...script.quests, groups: [...script.quests.groups, group] } };
};

export const replaceGroup = (script: MapScript, group: QuestGroup): MapScript => ({
  ...script, quests: { ...script.quests, groups: script.quests.groups.map(item => (item.id === group.id ? group
    : item)) }
});

export const removeGroup = (script: MapScript, id: string): MapScript | null => {
  const { groups, quests } = script.quests;
  if (quests.some(quest => quest.groupId === id) || groups.some(group => group.requiresGroups.includes(id)))
    return null;
  return { ...script, quests: { ...script.quests, groups: groups.filter(group => group.id !== id) } };
};

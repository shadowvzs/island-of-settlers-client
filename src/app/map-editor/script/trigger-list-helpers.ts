import { walkScriptRefs } from "../../../../../island-of-settlers-shared/src/script/references";
import type { MapScript, ScriptFolder } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScriptTrigger } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { foldSearchText } from "../reward-picker/catalog";
import type { TriggerListFilter } from "./constants";
import { type DescribeContext, describeRef } from "./describe";
import { countErrors, type ScriptIssueIndex, triggerIssues } from "./validation";

/**
 * The trigger list (design §13.2, §13.8): folders as a tree, triggers inside, the "not in a folder" group, search
 * over names, comments, every text in every language and the names of what a trigger references, and the
 * errors-only / off-only filters.
 */

export type TriggerListRow =
  | { count: number; depth: number; id: string | null; kind: "folder"; name: string }
  | { depth: number; enabled: boolean; errors: number; id: string; kind: "trigger"; name: string; selected: boolean };

const stringLeaves = (value: unknown, into: string[]) => {
  if (typeof value === "string") { into.push(value); return; }
  if (Array.isArray(value)) { for (const item of value) stringLeaves(item, into); return; }
  if (typeof value !== "object" || value === null) return;
  for (const item of Object.values(value)) stringLeaves(item, into);
};

/** Everything a search matches in a trigger: its texts and the names of the items it references. */
export const triggerSearchText = (trigger: ScriptTrigger, context: DescribeContext) => {
  const texts: string[] = [];
  stringLeaves(trigger, texts);
  walkScriptRefs(trigger, "", ref => texts.push(describeRef(ref, context)));
  return foldSearchText(texts.join(" "));
};

export const triggerMatches = (trigger: ScriptTrigger, query: string, context: DescribeContext) => {
  const words = foldSearchText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = triggerSearchText(trigger, context);
  return words.every(word => text.includes(word));
};

interface ListOptions {
  context: DescribeContext;
  filter: TriggerListFilter;
  issues: ScriptIssueIndex;
  query: string;
  selectedId: string | null;
}

const passesFilter = (filter: TriggerListFilter, trigger: ScriptTrigger, errors: number) =>
  filter === "all" || (filter === "errors" && errors > 0) || (filter === "disabled" && !trigger.enabled);

const folderChildren = (folders: readonly ScriptFolder[], parentId: string | null) =>
  folders.filter(folder => folder.parentId === parentId).sort((left, right) => left.name.localeCompare(right.name));

/** The visible rows: folders (depth-first) with their matching triggers, then the triggers without a folder. */
export const triggerListRows = (script: MapScript, options: ListOptions): TriggerListRow[] => {
  const { context, filter, issues, query, selectedId } = options;
  const visible = script.triggers.flatMap((trigger, index) => {
    const errors = countErrors(triggerIssues(issues, index));
    const shown = passesFilter(filter, trigger, errors) && triggerMatches(trigger, query, context);
    return shown ? [{ errors, trigger }] : [];
  });
  const searching = query.trim().length > 0 || filter !== "all";
  const triggerRows = (folderId: string | null, depth: number): TriggerListRow[] => visible
    .filter(item => item.trigger.folderId === folderId)
    .map(({ errors, trigger }) => ({ depth, enabled: trigger.enabled, errors, id: trigger.id, kind: "trigger",
      name: trigger.name, selected: trigger.id === selectedId }));
  const folderRows = (parentId: string | null, depth: number): TriggerListRow[] =>
    folderChildren(script.folders, parentId).flatMap(folder => {
      const inner = [...triggerRows(folder.id, depth + 1), ...folderRows(folder.id, depth + 1)];
      const count = inner.filter(row => row.kind === "trigger").length;
      if (searching && !count) return [];
      return [{ count, depth, id: folder.id, kind: "folder" as const, name: folder.name }, ...inner];
    });
  const loose = triggerRows(null, 1);
  const unsorted: TriggerListRow[] = loose.length || !searching
    ? [{ count: loose.length, depth: 0, id: null, kind: "folder", name: "" }, ...loose] : [];
  return [...folderRows(null, 0), ...unsorted];
};

/** The next "New trigger <n>" / "New folder <n>" number (one more than the item count). */
export const nextItemNumber = (items: readonly unknown[]) => items.length + 1;

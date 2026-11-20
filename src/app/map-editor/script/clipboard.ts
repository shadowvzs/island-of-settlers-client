import { walkScriptRefs } from "../../../../../island-of-settlers-shared/src/script/references";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScriptAction, ScriptTrigger } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { SCRIPT_CLIPBOARD_FORMAT } from "./constants";
import { allocateId } from "./script-document";

/**
 * Copy / paste of triggers and steps (design §13.2): a page-wide clipboard, so a copy survives switching maps in
 * the editor. The JSON is also written to the system clipboard when the browser allows it. A pasted trigger gets a
 * new id; its references are kept, so pasting into another map shows unknown references as validation errors
 * (the id-remapping import is TRG14).
 */

export type ScriptClipboard =
  | { format: typeof SCRIPT_CLIPBOARD_FORMAT; kind: "trigger"; trigger: ScriptTrigger }
  | { format: typeof SCRIPT_CLIPBOARD_FORMAT; kind: "steps"; steps: ScriptAction[] };

let clipboard: ScriptClipboard | null = null;
const listeners = new Set<() => void>();

const writeSystemClipboard = (value: ScriptClipboard) => {
  try {
    void globalThis.navigator?.clipboard?.writeText(JSON.stringify(value)).catch(() => undefined);
  } catch {
    // The system clipboard is optional (permissions, insecure contexts); the page clipboard still holds the copy.
  }
};

const store = (value: ScriptClipboard) => {
  clipboard = value;
  writeSystemClipboard(value);
  for (const listener of listeners) listener();
};

export const copyTrigger = (trigger: ScriptTrigger) =>
  store({ format: SCRIPT_CLIPBOARD_FORMAT, kind: "trigger", trigger: structuredClone(trigger) });

export const copySteps = (steps: readonly ScriptAction[]) =>
  store({ format: SCRIPT_CLIPBOARD_FORMAT, kind: "steps", steps: structuredClone([...steps]) });

export const readClipboard = () => clipboard;

export const subscribeClipboard = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Pastes the copied trigger as a new trigger (new id, "(copy)" name, into `folderId` when it exists). */
export const pasteTrigger = (script: MapScript, folderId: string | null, copyName: (name: string) => string) => {
  if (clipboard?.kind !== "trigger") return null;
  const copied = clipboard.trigger;
  const { id, script: next } = allocateId(script, "trigger");
  const folder = folderId && script.folders.some(item => item.id === folderId) ? folderId : null;
  const trigger = { ...structuredClone(copied), folderId: folder, id, name: copyName(copied.name) };
  // A self-reference in the copied trigger (enable/disable itself) follows the new id; all other references stay.
  walkScriptRefs(trigger, "", ref => {
    if (ref.kind === "trigger" && ref.id === copied.id) ref.id = id;
  });
  return { script: { ...next, triggers: [...next.triggers, trigger] }, trigger };
};

/** The copied steps (a fresh copy each time), or null. */
export const clipboardSteps = () => (clipboard?.kind === "steps" ? structuredClone(clipboard.steps) : null);

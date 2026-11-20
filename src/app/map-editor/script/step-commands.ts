import type { ScriptActionKind } from "../../../../../island-of-settlers-shared/src/script/catalog/actions";
import type { ScriptEventKind } from "../../../../../island-of-settlers-shared/src/script/catalog/events";
import type { ScriptPredicateKind } from "../../../../../island-of-settlers-shared/src/script/catalog/predicates";
import type { ScriptAction, ScriptTrigger } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { clipboardSteps, copySteps } from "./clipboard";
import { CONDITION_ROW_KINDS, DEFAULT_WAIT_TIMEOUT_SECONDS, type FlowStepKind } from "./constants";
import {
  createActionStep, createCondition, createEvent, createFlowStep, createPredicateCondition
} from "./factory";
import { getAtPath, type NodePath } from "./paths";
import type { ScriptWorkspace } from "./script-workspace";
import {
  addCondition, addEvent, addRootCondition, addSteps, duplicateNode, isStepPath, moveNode, newStepId, removeNode,
  setStepComment, setStepField, setStepWait, stepsAt, togglePhrasing, toggleStep, wrapStep
} from "./trigger-edits";
import type { ScriptDialogs } from "./use-script-dialogs";

type ConditionRowKind = (typeof CONDITION_ROW_KINDS)[number];

const conditionFromKey = (key: string) => {
  const [kind, name] = key.split(":") as [string, string];
  return kind === "predicate" ? createPredicateCondition(name as ScriptPredicateKind)
    : createCondition(name as ConditionRowKind);
};

/** A new step from an add-list key; `runTrigger` starts another trigger (else the node's own or the first one). */
const stepFromKey = (key: string, node: object, triggers: readonly ScriptTrigger[]): ScriptAction => {
  const [kind, name] = key.split(":") as [string, string];
  const id = newStepId(node);
  if (kind === "action") return createActionStep(name as ScriptActionKind, id);
  const ownId = (node as { id?: string }).id;
  const target = triggers.find(item => item.id !== ownId)?.id ?? ownId ?? "";
  return createFlowStep(name as FlowStepKind, id, target);
};

/**
 * The node whose rows a form edits (a trigger, a quest): its current value, how a change is committed, and the
 * script's triggers (a new "run trigger" step starts one of them).
 */
export interface RowHost<T extends object> {
  node: T;
  triggers: readonly ScriptTrigger[];
  update: (change: (value: T) => T) => void;
}

/** A trigger as a row host of the workspace. */
export const triggerHost = (workspace: ScriptWorkspace, trigger: ScriptTrigger): RowHost<ScriptTrigger> => ({
  node: trigger, triggers: workspace.getSnapshot().script.triggers,
  update: change => workspace.updateTrigger(trigger.id, change)
});

/** Commands of the event, condition and step rows: add lists, the ⋯ menu, wait and lock options, keyboard. */
export const createStepCommands = <T extends object>(host: RowHost<T>, dialogs: ScriptDialogs) => {
  const { node, triggers, update } = host;
  return {
    onAddEvent: () => dialogs.openAdd({ apply: key => update(current =>
      addEvent(current as unknown as ScriptTrigger, createEvent(key.split(":")[1] as ScriptEventKind)) as unknown as
      T), kind: "event" }),
    /** "+ condition" of a root condition (`conditions` of a trigger, `failure` or the objective of a quest). */
    onAddRootCondition: (rootPath: NodePath) => dialogs.openAdd({ apply: key => update(current =>
      addRootCondition(current, rootPath, conditionFromKey(key))), kind: "condition" }),
    onAddCondition: (listPath: NodePath) => dialogs.openAdd({ apply: key => update(current =>
      addCondition(current, listPath, conditionFromKey(key))), kind: "condition" }),
    onAddAction: (listPath: NodePath) => dialogs.openAdd({ apply: key => update(current =>
      addSteps(current, listPath, [stepFromKey(key, current, triggers)])), kind: "action" }),
    onPasteSteps: (listPath: NodePath) => {
      const steps = clipboardSteps();
      if (steps) update(current => addSteps(current, listPath, steps));
    },
    onMove: (path: NodePath, offset: number) => update(current => moveNode(current, path, offset)),
    onDuplicate: (path: NodePath) => update(current => duplicateNode(current, path)),
    onDelete: (path: NodePath) => update(current => removeNode(current, path)),
    onToggle: (path: NodePath) => { if (isStepPath(path)) update(current => toggleStep(current, path)); },
    onComment: (path: NodePath, comment: string) => update(current => setStepComment(current, path, comment)),
    onCopy: (path: NodePath) => copySteps(stepsAt(node, [path])),
    onCut: (path: NodePath) => {
      copySteps(stepsAt(node, [path]));
      update(current => removeNode(current, path));
    },
    onWrap: (path: NodePath, kind: "if" | "forEach") => update(current => wrapStep(current, path, kind)),
    onInvert: (path: NodePath) => update(current =>
      togglePhrasing(current as unknown as ScriptTrigger, path) as unknown as T),
    onWaitToggle: (path: NodePath, on: boolean) => update(current => setStepWait(current, path, on
      ? { onFail: "continue", timeoutSeconds: DEFAULT_WAIT_TIMEOUT_SECONDS } : undefined)),
    onWaitTimeout: (path: NodePath, seconds: number) => {
      const wait = getAtPath(node, [...path, "wait"]) as { onFail: "continue" | "stop" } | undefined;
      if (wait && Number.isFinite(seconds) && seconds > 0) update(current => setStepWait(current, path,
        { ...wait, timeoutSeconds: seconds }));
    },
    onWaitStop: (path: NodePath, stop: boolean) => {
      const wait = getAtPath(node, [...path, "wait"]) as { timeoutSeconds: number } | undefined;
      if (wait) update(current => setStepWait(current, path, { ...wait, onFail: stop ? "stop" : "continue" }));
    },
    onLock: (path: NodePath, locked: boolean) =>
      update(current => setStepField(current, path, "overridable", locked ? false : undefined)),
    onRunTriggerOption: (path: NodePath, field: "checkConditions" | "wait", on: boolean) =>
      update(current => setStepField(current, path, field, on)),
    /** Ctrl+D duplicates, Ctrl+/ turns a step off or on (design §13.2 keyboard). */
    onRowKey: (path: NodePath, key: string, ctrl: boolean) => {
      if (!ctrl) return false;
      if (key === "d") { update(current => duplicateNode(current, path)); return true; }
      if (key === "/" && isStepPath(path)) { update(current => toggleStep(current, path)); return true; }
      return false;
    }
  };
};

export type StepCommands = ReturnType<typeof createStepCommands>;

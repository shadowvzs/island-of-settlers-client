import type { MapRegion } from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type { ScriptActor } from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import type { ScriptQuest } from "../../../../../island-of-settlers-shared/src/script/types/quests";
import type { ScriptRef, ScriptRefKind } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type { ScriptVariable } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScriptAction, ScriptTrigger } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import type { Expr } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { HUMAN_FACTION, PICKED_REGION_RADIUS } from "./constants";
import { numberLiteral } from "./factory";
import { createTrigger } from "./script-document";

/** Shared pieces of the trigger templates (`templates.ts`, `templates-goals.ts`): parameters and small builders. */

/** Editor-only names of what a template creates (triggers, actors, regions), in the editor's language. */
export const TEMPLATE_LABEL_KEYS = [
  "start", "killCounter", "collectCounter", "areaReached", "guardLost", "chiefFlees", "fledVictory", "escortedArcher",
  "protectedGuard", "enemyChief", "escapeShip", "goalArea", "escortStart", "escortGoal", "guardPost", "enemyHarbour",
  "plantCounter", "buildCounter", "deadlineCounter", "deadlineExpired", "deadlineMet", "holdEntered",
  "holdAbandoned", "holdDone", "holdArea", "sellCounter", "aiWakeUp", "aiAttackOnBuild", "aiResume", "aiRampUp",
  "aiDefendBorder", "aiBorder", "aiExpandAfter"
] as const;
export type TemplateLabels = Readonly<Record<(typeof TEMPLATE_LABEL_KEYS)[number], string>>;

/** How "Capture the island" is won: every enemy building taken, or no enemy soldier left. */
export const CAPTURE_GOALS = ["capture", "defeat"] as const;
export type CaptureGoal = (typeof CAPTURE_GOALS)[number];

export interface TemplateParams {
  /** Build X: also add a progress board. */
  board: boolean;
  /** Build X building key (`woodcutter`). */
  building: string;
  /** Collect N / kill counter / build / sell target. */
  count: number;
  /** Kill counter family (`animal.deer`). */
  family: string;
  /** Enemy AI templates: the computer faction they steer (1 = Player 2). */
  faction: number;
  /** Capture the island win rule. */
  goal: CaptureGoal;
  /** Names of the created triggers, actors and regions ("start" names the start trigger). */
  labels: TemplateLabels;
  /** Map centre (new regions are placed around it). */
  mapCenter: { x: number; z: number };
  /** Reach area / hold region / AI border: an existing region; null makes a new one. */
  region: string | null;
  /** Protect / hold duration, collect deadline, the delay or duration of an enemy AI template. */
  seconds: number;
  /** Collect N / sell N ware key (`planks`). */
  ware: string;
}

/** What a template adds; ids are allocated by `applyTemplate`. */
export interface TemplateParts {
  actors: ScriptActor[];
  quests: ScriptQuest[];
  regions: MapRegion[];
  triggers: ScriptTrigger[];
  variables: ScriptVariable[];
}

export interface TemplateIds {
  actors: string[];
  quests: string[];
  regions: string[];
  triggers: string[];
  variables: string[];
}

export type TemplateBuilder = (ids: TemplateIds, params: TemplateParams) => TemplateParts;

export const PLAYER_ONE = { faction: HUMAN_FACTION, kind: "slot" as const };
export const BOARD_NUMBER_WIDTH = 64;

export const ref = <K extends ScriptRefKind>(kind: K, id: string): ScriptRef<K> => ({ id, k: "ref", kind });
export const variable = (id: string): Expr => ({ k: "var", variable: ref("variable", id) });

/** Player-visible template text that only has its English form yet (translators add the rest). */
export const english = (en: string): QuestText => ({ en });

/** A quest with player-visible title text (English is required; other languages are optional). */
export const titledQuest = (id: string, title: QuestText, fields: Partial<ScriptQuest>): ScriptQuest => ({
  cost: [], deadline: null, failure: null, id, objective: { kind: "scripted" }, onActivate: [], onFailure: [],
  onSuccess: [], repeat: { kind: "once", retryAfterFail: false }, title, visibility: "visible", ...fields
});

/** A quest that completes when a number variable reaches the target, with a progress bar. */
export const counterQuest = (id: string, counter: string, target: number, title: QuestText) =>
  titledQuest(id, title, {
    objective: { condition: { a: variable(counter), b: numberLiteral(target), k: "compare", op: ">=" },
      kind: "condition", progress: { current: variable(counter), target: numberLiteral(target) } }
  });

export const numberVariable = (id: string, name: string): ScriptVariable =>
  ({ id, initial: { type: "number", value: 0 }, name, type: "number" });

export const circle = (id: string, name: string, x: number, z: number): MapRegion =>
  ({ id, name, shape: { centerX: x, centerZ: z, kind: "circle", radius: PICKED_REGION_RADIUS } });

export const trigger = (id: string, name: string, fields: Partial<ScriptTrigger>): ScriptTrigger =>
  ({ ...createTrigger(id, name, null), ...fields });

export const step = (id: string, op: string, args: Record<string, unknown>, extra: object = {}) =>
  ({ args, id, k: "do", op, ...extra }) as ScriptAction;

/** Adds a number to a counter variable. */
export const increaseStep = (id: string, counter: string, amount: Expr) =>
  step(id, "increaseVariable", { amount, variable: ref("variable", counter) });

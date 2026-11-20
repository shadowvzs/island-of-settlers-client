import type { ScriptAction, ScriptEvent } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import type { Expr } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { booleanLiteral, numberLiteral, stringLiteral } from "./factory";
import {
  circle, english, PLAYER_ONE, ref, step, type TemplateBuilder, titledQuest, trigger
} from "./template-parts";

/**
 * Enemy AI templates (enemy economy AI plan §5.2, EAI5c): ready-made triggers over `setFactionAi`,
 * `factionAiPause` and `setFactionGoal` for one computer faction. Every value stays editable with the pickers.
 * Their player-visible texts are English; translators add the rest.
 */

const ANYONE = { kind: "any" as const };
const ONCE = { concurrency: "ignore" as const, runLimit: 1 };
const ELAPSED: Expr = { args: {}, fn: "elapsedSeconds", k: "fn" };
const NO_EXTRAS = { actors: [], quests: [], regions: [], variables: [] };

const computer = (faction: number) => ({ faction, kind: "slot" as const });
const afterSeconds = (seconds: number): ScriptEvent =>
  ({ kind: "elapsedTime", player: ANYONE, slots: { seconds: numberLiteral(seconds) } });
const waitStep = (id: string, seconds: number): ScriptAction => ({ id, k: "wait", seconds: numberLiteral(seconds) });
const levelStep = (id: string, faction: number, level: string) =>
  step(id, "setFactionAi", { faction: computer(faction), level: stringLiteral(level) });
const goalStep = (id: string, faction: number, goal: string, extra: Record<string, unknown> = {}) =>
  step(id, "setFactionGoal", { faction: computer(faction), goal: stringLiteral(goal), ...extra });
const pauseStep = (id: string, faction: number, paused: boolean) =>
  step(id, "factionAiPause", { faction: computer(faction), paused: booleanLiteral(paused) });

/** The enemy wakes up: after N seconds a sleeping (`none`) faction starts to maintain its camp. */
export const aiWakeUp: TemplateBuilder = (ids, params) => ({
  ...NO_EXTRAS,
  triggers: [trigger(ids.triggers[0]!, params.labels.aiWakeUp, {
    ...ONCE,
    actions: [step("s1", "setFactionAi", { faction: computer(params.faction), mode: stringLiteral("maintain") })],
    events: [afterSeconds(params.seconds)]
  })]
});

/** The enemy attacks once Player 1 finishes a building of the picked type. */
export const aiAttackOnBuild: TemplateBuilder = (ids, params) => ({
  ...NO_EXTRAS,
  triggers: [trigger(ids.triggers[0]!, params.labels.aiAttackOnBuild, {
    ...ONCE,
    actions: [goalStep("s1", params.faction, "attack")],
    events: [{ kind: "constructionCompleted", player: PLAYER_ONE, slots: {
      building: { kind: "type", type: { type: ref("content", `building:${params.building}`) } }
    } }]
  })]
});

/**
 * The enemy AI is paused while a quest runs: the quest pauses it when it starts, and the AI resumes as soon as the
 * quest succeeds or fails (a quest's own `onSuccess` would wait for the claim). The quest lasts N seconds.
 */
export const aiPauseDuringQuest: TemplateBuilder = (ids, params) => {
  const quest = ref("quest", ids.quests[0]!);
  const questEvent = (kind: "questFailed" | "questSucceeded"): ScriptEvent =>
    ({ kind, player: ANYONE, slots: { quest } });
  return {
    actors: [], regions: [], variables: [],
    quests: [titledQuest(quest.id, english("Prepare while the enemy rests"), {
      objective: { condition: { a: ELAPSED, b: numberLiteral(params.seconds), k: "compare", op: ">=" },
        kind: "condition", progress: { current: ELAPSED, target: numberLiteral(params.seconds) } },
      onActivate: [pauseStep("s1", params.faction, true)]
    })],
    triggers: [trigger(ids.triggers[0]!, params.labels.aiResume, {
      ...ONCE,
      actions: [pauseStep("s1", params.faction, false)],
      events: [questEvent("questSucceeded"), questEvent("questFailed")]
    })]
  };
};

/** The difficulty ramps up: the enemy starts easy, turns medium after N seconds and hard after another N. */
export const aiRampUp: TemplateBuilder = (ids, params) => ({
  ...NO_EXTRAS,
  triggers: [trigger(ids.triggers[0]!, params.labels.aiRampUp, {
    ...ONCE,
    actions: [
      levelStep("s1", params.faction, "easy"), waitStep("s2", params.seconds),
      levelStep("s3", params.faction, "medium"), waitStep("s4", params.seconds),
      levelStep("s5", params.faction, "hard")
    ],
    events: [{ kind: "mapStarted", player: ANYONE, slots: {} }]
  })]
});

/** The enemy defends its border: a building Player 1 places inside the region makes it defend there for N seconds. */
export const aiDefendBorder: TemplateBuilder = (ids, params) => {
  const region = ref("region", params.region ?? ids.regions[0]!);
  return {
    actors: [], quests: [], variables: [],
    regions: params.region ? [] : [circle(region.id, params.labels.aiBorder, params.mapCenter.x, params.mapCenter.z)],
    triggers: [trigger(ids.triggers[0]!, params.labels.aiDefendBorder, {
      actions: [goalStep("s1", params.faction, "defend", { region, seconds: numberLiteral(params.seconds) })],
      concurrency: "ignore",
      events: [{ kind: "constructionPlaced", player: PLAYER_ONE, slots: {
        building: { family: ref("family", "building"), kind: "family", region }
      } }]
    })]
  };
};

/** The enemy expands: after N seconds it builds as if it knew of no enemy soldier. */
export const aiExpandAfter: TemplateBuilder = (ids, params) => ({
  ...NO_EXTRAS,
  triggers: [trigger(ids.triggers[0]!, params.labels.aiExpandAfter, {
    ...ONCE,
    actions: [goalStep("s1", params.faction, "expand")],
    events: [afterSeconds(params.seconds)]
  })]
});

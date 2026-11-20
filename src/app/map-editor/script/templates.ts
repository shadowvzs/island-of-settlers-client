import type { ScriptActor } from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { ScriptQuest } from "../../../../../island-of-settlers-shared/src/script/types/quests";
import type { MapKind } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type { MapScript, ScriptVariable } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { Condition } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import type { Expr } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { numberLiteral, stringLiteral } from "./factory";
import { allocateIds, freeQuestIds } from "./script-document";
import {
  BOARD_NUMBER_WIDTH, circle, counterQuest, increaseStep, numberVariable, PLAYER_ONE, ref, step, type TemplateBuilder,
  type TemplateIds, type TemplateParams, type TemplateParts, titledQuest, trigger, variable
} from "./template-parts";
import {
  aiAttackOnBuild, aiDefendBorder, aiExpandAfter, aiPauseDuringQuest, aiRampUp, aiWakeUp
} from "./templates-ai";
import { buildCount, captureIsland, collectDeadline, holdRegion, tradeQuest } from "./templates-goals";

/**
 * Trigger templates (design §13.7, owner examples §14): one click inserts a trigger set with its variables, quest
 * and actors; the author then edits it with the pickers. Every generated script passes the Ready check on the map
 * kinds a template lists (tests/script-editor-helpers.test.ts). The goal templates (build, deadline, capture, hold,
 * trade) live in `templates-goals.ts`, the enemy AI templates (EAI5c) in `templates-ai.ts`.
 */

export const TEMPLATE_IDS = [
  "killCounter", "collect", "collectDeadline", "buildCount", "plantBoard", "reachArea", "holdRegion", "escort",
  "protect", "tradeQuest", "captureIsland", "fleeVictory", "aiWakeUp", "aiAttackOnBuild", "aiPauseDuringQuest",
  "aiRampUp", "aiDefendBorder", "aiExpandAfter"
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Parameters a template dialog may ask for. */
export const TEMPLATE_PARAMS = [
  "board", "building", "count", "faction", "family", "goal", "region", "seconds", "ware"
] as const;
export type TemplateParam = (typeof TEMPLATE_PARAMS)[number];

export interface TemplateDefinition {
  id: TemplateId;
  /** Map kinds the generated script is valid on (scope table: endMap, victory, trade…). */
  mapKinds: readonly MapKind[];
  /** The parameters the dialog asks for. */
  params: readonly TemplateParam[];
}

const ALL_KINDS: readonly MapKind[] = ["home", "adventure", "colony", "campaign"];
const WON_MAP_KINDS: readonly MapKind[] = ["adventure", "campaign"];
/** Maps with computer factions: the enemy AI actions are refused on a home island. */
const AI_MAP_KINDS: readonly MapKind[] = ["adventure", "colony", "campaign"];

export const TEMPLATES: Readonly<Record<TemplateId, TemplateDefinition>> = {
  killCounter: { id: "killCounter", mapKinds: ALL_KINDS, params: ["family", "count"] },
  collect: { id: "collect", mapKinds: ALL_KINDS, params: ["ware", "count"] },
  collectDeadline: { id: "collectDeadline", mapKinds: ALL_KINDS, params: ["ware", "count", "seconds"] },
  buildCount: { id: "buildCount", mapKinds: ALL_KINDS, params: ["building", "count", "board"] },
  plantBoard: { id: "plantBoard", mapKinds: ALL_KINDS, params: ["count"] },
  reachArea: { id: "reachArea", mapKinds: ALL_KINDS, params: ["region"] },
  holdRegion: { id: "holdRegion", mapKinds: ALL_KINDS, params: ["region", "seconds"] },
  escort: { id: "escort", mapKinds: ALL_KINDS, params: [] },
  protect: { id: "protect", mapKinds: ALL_KINDS, params: ["seconds"] },
  tradeQuest: { id: "tradeQuest", mapKinds: ["home"], params: ["ware", "count"] },
  captureIsland: { id: "captureIsland", mapKinds: WON_MAP_KINDS, params: ["goal"] },
  fleeVictory: { id: "fleeVictory", mapKinds: WON_MAP_KINDS, params: [] },
  aiWakeUp: { id: "aiWakeUp", mapKinds: AI_MAP_KINDS, params: ["faction", "seconds"] },
  aiAttackOnBuild: { id: "aiAttackOnBuild", mapKinds: AI_MAP_KINDS, params: ["faction", "building"] },
  aiPauseDuringQuest: { id: "aiPauseDuringQuest", mapKinds: AI_MAP_KINDS, params: ["faction", "seconds"] },
  aiRampUp: { id: "aiRampUp", mapKinds: AI_MAP_KINDS, params: ["faction", "seconds"] },
  aiDefendBorder: { id: "aiDefendBorder", mapKinds: AI_MAP_KINDS, params: ["faction", "region", "seconds"] },
  aiExpandAfter: { id: "aiExpandAfter", mapKinds: AI_MAP_KINDS, params: ["faction", "seconds"] }
};

export const DEFAULT_TEMPLATE_PARAMS: Omit<TemplateParams, "labels" | "mapCenter"> = {
  board: true, building: "woodcutter", count: 10, faction: 1, family: "animal.deer", goal: "capture", region: null,
  seconds: 300, ware: "planks"
};

const ENEMY = { faction: 1, kind: "slot" as const };
const ESCORT_DEADLINE_SECONDS = 900;
const FLEE_DELAY_SECONDS = 4;
const BOARD_TIMEOUT_SECONDS = 60;
const SAIL_TIMEOUT_SECONDS = 120;
const REGION_OFFSET = 12;

/** A quest title in English, Hungarian and German (player-visible script text, design §12). */
type QuestTitle = readonly [en: string, hu: string, de: string];

const titleText = ([en, hu, de]: QuestTitle) => ({ de, en, hu });
const quest = (id: string, title: QuestTitle, fields: Partial<ScriptQuest>) =>
  titledQuest(id, titleText(title), fields);

const instance = (id: string) => ({ actor: ref("actor", id), kind: "instance" as const });
const alive = (actor: string): Condition => ({ args: { actor: instance(actor) }, k: "is", pred: "actorAlive" });

const killCounter = (ids: TemplateIds, params: TemplateParams): TemplateParts => ({
  actors: [], regions: [],
  quests: [counterQuest(ids.quests[0]!, ids.variables[0]!, params.count,
    titleText(["The hunt", "A vadászat", "Die Jagd"]))],
  triggers: [trigger(ids.triggers[0]!, params.labels.killCounter, {
    actions: [increaseStep("s1", ids.variables[0]!, numberLiteral(1))],
    events: [{ kind: "animalKilled", player: PLAYER_ONE, slots: {
      killer: { kind: "type", type: { type: ref("content", "settler:hunter") } },
      victim: { family: ref("family", params.family), kind: "family", owner: { kind: "neutral" } }
    } }]
  })],
  variables: [numberVariable(ids.variables[0]!, "killCount")]
});

const collect = (ids: TemplateIds, params: TemplateParams): TemplateParts => ({
  actors: [], regions: [],
  quests: [counterQuest(ids.quests[0]!, ids.variables[0]!, params.count,
    titleText(["Collect wares", "Gyűjts árut", "Sammle Waren"]))],
  triggers: [trigger(ids.triggers[0]!, params.labels.collectCounter, {
    actions: [increaseStep("s1", ids.variables[0]!, { k: "resp", key: "amount" })],
    events: [{ kind: "wareDelivered", player: PLAYER_ONE, slots: { ware: ref("content", `ware:${params.ware}`) } }]
  })],
  variables: [numberVariable(ids.variables[0]!, "collected")]
});

/** A board with one row ("Plant trees" + tree icon) and a progress cell (planted / N), design §14.4. */
const plantingBoard = (counter: string, count: number): ScriptVariable["initial"] => ({ type: "multiboard", value: {
  audience: PLAYER_ONE,
  cells: { c1: { expr: { k: "cell", key: "rowLabel" }, format: "text" },
    c2: { current: variable(counter), format: "fraction", target: numberLiteral(count) } },
  columns: [{ align: "left", header: { de: "Aufgabe", en: "Task", hu: "Feladat" }, id: "c1", width: "auto" },
    { align: "right", header: { de: "Erledigt", en: "Done", hu: "Kész" }, id: "c2", width: BOARD_NUMBER_WIDTH }],
  initiallyCollapsed: false, initiallyVisible: false,
  rows: { kind: "static", rows: [{ icon: ref("content", "tree:broadleafTree"), id: "r1",
    label: { de: "Bäume pflanzen", en: "Plant trees", hu: "Ültess fákat" } }] },
  sort: null, title: { de: "Hain-Projekt", en: "Grove project", hu: "Liget projekt" }
} });

const plantBoard = (ids: TemplateIds, params: TemplateParams): TemplateParts => {
  const [counter, board] = ids.variables as [string, string];
  const boardRef = ref("multiboard", board);
  return {
    actors: [], regions: [],
    quests: [{ ...counterQuest(ids.quests[0]!, counter, params.count,
      titleText(["A grove for the village", "Liget a falunak", "Ein Hain für das Dorf"])),
    onActivate: [step("s1", "showMultiboard", { multiboard: boardRef })],
    onSuccess: [step("s2", "hideMultiboard", { multiboard: boardRef })] }],
    triggers: [trigger(ids.triggers[0]!, params.labels.plantCounter, {
      actions: [increaseStep("s1", counter, numberLiteral(1))],
      events: [{ kind: "treePlanted", player: PLAYER_ONE, slots: {} }]
    })],
    variables: [numberVariable(counter, "planted"),
      { id: board, initial: plantingBoard(counter, params.count), name: "groveBoard", type: "multiboard" }]
  };
};

const reachArea = (ids: TemplateIds, params: TemplateParams): TemplateParts => {
  const region = params.region ?? ids.regions[0]!;
  return {
    actors: [], variables: [],
    quests: [quest(ids.quests[0]!, ["Reach the area", "Érd el a területet", "Erreiche das Gebiet"], {})],
    regions: params.region ? [] : [circle(region, params.labels.goalArea, params.mapCenter.x, params.mapCenter.z)],
    triggers: [trigger(ids.triggers[0]!, params.labels.areaReached, {
      actions: [step("s1", "completeQuest", { quest: ref("quest", ids.quests[0]!) })],
      concurrency: "ignore",
      events: [{ kind: "enteredRegion", player: PLAYER_ONE, slots: {
        region: ref("region", region), subject: { family: ref("family", "soldier"), kind: "family" }
      } }],
      runLimit: 1
    })]
  };
};

const spawnActor = (id: string, name: string, type: string, region: string, fields: Partial<ScriptActor> = {}) =>
  ({ binding: "spawn", count: 1, id, lifetime: "keepIncarnation", look: { kind: "ownerNation" }, name,
    owner: PLAYER_ONE, place: { region: ref("region", region) }, respawn: "refuse", spawnAtStart: false,
    type: { type: ref("content", type) }, ...fields }) as ScriptActor;

const escort = (ids: TemplateIds, params: TemplateParams): TemplateParts => {
  const [start, goal] = ids.regions as [string, string];
  const actor = ids.actors[0]!;
  const { x, z } = params.mapCenter;
  return {
    actors: [spawnActor(actor, params.labels.escortedArcher, "soldier:archer", start, {
      look: { kind: "nation", nation: "nubian" } } as Partial<ScriptActor>)],
    quests: [quest(ids.quests[0]!, ["Escort the archer", "Kísérd el az íjászt", "Geleite den Bogenschützen"], {
      deadline: { kind: "playTime", seconds: ESCORT_DEADLINE_SECONDS },
      failure: { k: "not", of: alive(actor) },
      objective: { actor: ref("actor", actor), kind: "actorReachedRegion", quantifier: "any",
        region: ref("region", goal) },
      onActivate: [step("s1", "appear", { actor: instance(actor) })],
      repeat: { kind: "once", retryAfterFail: true }
    })],
    regions: [circle(start, params.labels.escortStart, x - REGION_OFFSET, z),
      circle(goal, params.labels.escortGoal, x + REGION_OFFSET, z)],
    triggers: [],
    variables: []
  };
};

const protect = (ids: TemplateIds, params: TemplateParams): TemplateParts => {
  const actor = ids.actors[0]!;
  const elapsed: Expr = { args: {}, fn: "elapsedSeconds", k: "fn" };
  return {
    actors: [spawnActor(actor, params.labels.protectedGuard, "soldier:shield", ids.regions[0]!,
      { spawnAtStart: true } as
      Partial<ScriptActor>)],
    quests: [quest(ids.quests[0]!, ["Protect the guard", "Védd meg az őrt", "Beschütze die Wache"], {
      failure: { k: "not", of: alive(actor) },
      objective: { condition: { a: elapsed, b: numberLiteral(params.seconds), k: "compare", op: ">=" },
        kind: "condition", progress: { current: elapsed, target: numberLiteral(params.seconds) } }
    })],
    regions: [circle(ids.regions[0]!, params.labels.guardPost, params.mapCenter.x, params.mapCenter.z)],
    triggers: [trigger(ids.triggers[0]!, params.labels.guardLost, {
      actions: [step("s1", "notify", { important: { k: "lit", type: "boolean", value: true },
        text: { k: "text",
          text: { de: "Die Wache ist gefallen.", en: "The guard has fallen.", hu: "Az őr elesett." } } })],
      concurrency: "ignore",
      events: [{ kind: "questFailed", player: { kind: "any" }, slots: { quest: ref("quest", ids.quests[0]!) } }],
      runLimit: 1
    })],
    variables: []
  };
};

const fleeVictory = (ids: TemplateIds, params: TemplateParams): TemplateParts => {
  const [chief, raider] = ids.actors as [string, string];
  const [defend, fled] = ids.quests as [string, string];
  const region = ids.regions[0]!;
  const locked = (timeoutSeconds: number) => ({ overridable: false, wait: { onFail: "continue", timeoutSeconds } });
  return {
    actors: [
      spawnActor(chief, params.labels.enemyChief, "soldier:heavy", region, { look: { kind: "bandits" }, owner: ENEMY,
        spawnAtStart: true } as Partial<ScriptActor>),
      spawnActor(raider, params.labels.escapeShip, "ship:raider", region, { look: { kind: "pirates" }, owner: ENEMY,
        spawnAtStart: true } as Partial<ScriptActor>)
    ],
    quests: [quest(defend, ["Defeat the enemy", "Győzd le az ellenséget", "Besiege den Feind"], {}),
      quest(fled, ["The enemy fled", "Az ellenség elmenekült", "Der Feind ist geflohen"], { visibility: "hidden" })],
    regions: [circle(region, params.labels.enemyHarbour, params.mapCenter.x + REGION_OFFSET, params.mapCenter.z)],
    triggers: [
      trigger(ids.triggers[0]!, params.labels.chiefFlees, {
        actions: [
          step("s1", "boardShip", { actor: instance(chief), ship: instance(raider) }, locked(BOARD_TIMEOUT_SECONDS)),
          step("s2", "sail", { ship: instance(raider), to: stringLiteral("mapEdge") }, locked(SAIL_TIMEOUT_SECONDS))
        ],
        concurrency: "ignore",
        events: [{ kind: "questSucceeded", player: { kind: "any" }, slots: { quest: ref("quest", defend) } }],
        runLimit: 1
      }),
      trigger(ids.triggers[1]!, params.labels.fledVictory, {
        actions: [{ id: "s1", k: "wait", seconds: numberLiteral(FLEE_DELAY_SECONDS) },
          step("s2", "endMap", { outcome: stringLiteral("victory"), storyQuest: ref("quest", fled) })],
        concurrency: "ignore",
        events: [{ kind: "shipLeftMap", player: ENEMY, slots: { ship: instance(raider) } }],
        runLimit: 1
      })
    ],
    variables: []
  };
};

const BUILDERS: Readonly<Record<TemplateId, TemplateBuilder>> = {
  aiAttackOnBuild, aiDefendBorder, aiExpandAfter, aiPauseDuringQuest, aiRampUp, aiWakeUp, buildCount, captureIsland,
  collect, collectDeadline, escort, fleeVictory, holdRegion, killCounter, plantBoard, protect, reachArea, tradeQuest
};

/** How many ids of each kind a template needs. */
const NEEDS: Readonly<Record<TemplateId, Record<keyof TemplateIds, number>>> = {
  aiAttackOnBuild: { actors: 0, quests: 0, regions: 0, triggers: 1, variables: 0 },
  aiDefendBorder: { actors: 0, quests: 0, regions: 1, triggers: 1, variables: 0 },
  aiExpandAfter: { actors: 0, quests: 0, regions: 0, triggers: 1, variables: 0 },
  aiPauseDuringQuest: { actors: 0, quests: 1, regions: 0, triggers: 1, variables: 0 },
  aiRampUp: { actors: 0, quests: 0, regions: 0, triggers: 1, variables: 0 },
  aiWakeUp: { actors: 0, quests: 0, regions: 0, triggers: 1, variables: 0 },
  buildCount: { actors: 0, quests: 1, regions: 0, triggers: 1, variables: 2 },
  captureIsland: { actors: 0, quests: 1, regions: 0, triggers: 0, variables: 0 },
  collect: { actors: 0, quests: 1, regions: 0, triggers: 1, variables: 1 },
  collectDeadline: { actors: 0, quests: 1, regions: 0, triggers: 3, variables: 3 },
  escort: { actors: 1, quests: 1, regions: 2, triggers: 0, variables: 0 },
  fleeVictory: { actors: 2, quests: 2, regions: 1, triggers: 2, variables: 0 },
  holdRegion: { actors: 0, quests: 1, regions: 1, triggers: 3, variables: 2 },
  killCounter: { actors: 0, quests: 1, regions: 0, triggers: 1, variables: 1 },
  plantBoard: { actors: 0, quests: 1, regions: 0, triggers: 1, variables: 2 },
  protect: { actors: 1, quests: 1, regions: 1, triggers: 1, variables: 0 },
  reachArea: { actors: 0, quests: 1, regions: 1, triggers: 1, variables: 0 },
  tradeQuest: { actors: 0, quests: 1, regions: 0, triggers: 1, variables: 1 }
};

/** The ids this insert needs: a picked region replaces the new one, and Build X without a board has no board. */
const neededIds = (id: TemplateId, params: TemplateParams) => {
  const needs = NEEDS[id];
  const reusesRegion = params.region !== null && TEMPLATES[id].params.includes("region");
  const skipsBoard = id === "buildCount" && !params.board;
  return { ...needs, regions: reusesRegion ? 0 : needs.regions,
    variables: skipsBoard ? needs.variables - 1 : needs.variables };
};

/** Unique variable names: a taken name gets a number suffix. */
const uniqueVariableNames = (script: MapScript, variables: ScriptVariable[]) => {
  const taken = new Set(script.variables.map(item => item.name.toLowerCase()));
  return variables.map(item => {
    let name = item.name;
    for (let suffix = 2; taken.has(name.toLowerCase()); suffix += 1) name = `${item.name}${suffix}`;
    taken.add(name.toLowerCase());
    return { ...item, name };
  });
};

/** The template's start trigger: at map start it activates every visible quest the template made. */
const startTrigger = (id: string, name: string, quests: readonly ScriptQuest[]) => trigger(id, name, {
  actions: quests.filter(item => item.visibility === "visible")
    .map((item, index) => step(`s${index + 1}`, "activateQuest", { quest: ref("quest", item.id) })),
  concurrency: "ignore", events: [{ kind: "mapStarted", player: { kind: "any" }, slots: {} }], runLimit: 1
});

/**
 * Inserts a template into the script; returns the new script and the id of its first trigger: the start trigger,
 * which only a template with a quest gets (it has nothing to activate otherwise).
 */
export const applyTemplate = (script: MapScript, id: TemplateId, params: TemplateParams) => {
  const needs = neededIds(id, params);
  const startCount = needs.quests > 0 ? 1 : 0;
  const actors = allocateIds(script, "actor", needs.actors);
  const regions = allocateIds(actors.script, "region", needs.regions);
  const triggers = allocateIds(regions.script, "trigger", needs.triggers + startCount);
  const variables = allocateIds(triggers.script, "variable", needs.variables);
  const startIds = triggers.ids.slice(0, startCount);
  const ids: TemplateIds = { actors: actors.ids, quests: freeQuestIds(script, needs.quests), regions: regions.ids,
    triggers: triggers.ids.slice(startCount), variables: variables.ids };
  const parts = BUILDERS[id](ids, params);
  const starts = startIds.map(startId => startTrigger(startId, params.labels.start, parts.quests));
  const next = variables.script;
  return {
    firstTrigger: triggers.ids[0]!,
    script: {
      ...next,
      actors: [...next.actors, ...parts.actors],
      quests: { ...next.quests, quests: [...next.quests.quests, ...parts.quests] },
      regions: [...next.regions, ...parts.regions],
      triggers: [...next.triggers, ...starts, ...parts.triggers],
      variables: [...next.variables, ...uniqueVariableNames(next, parts.variables)]
    }
  };
};

/** Templates offered on a map kind. */
export const templatesFor = (mapKind: MapKind) => TEMPLATE_IDS.filter(id => TEMPLATES[id].mapKinds.includes(mapKind));

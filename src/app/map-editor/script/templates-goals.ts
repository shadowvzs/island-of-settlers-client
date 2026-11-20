import type { QuestObjective } from "../../../../../island-of-settlers-shared/src/script/types/quests";
import type { ScriptVariable } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { Condition, ScriptAction } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import type { Expr } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { numberLiteral, stringLiteral } from "./factory";
import {
  BOARD_NUMBER_WIDTH, type CaptureGoal, circle, counterQuest, english, increaseStep, numberVariable, PLAYER_ONE, ref,
  step, type TemplateBuilder, titledQuest, trigger, variable
} from "./template-parts";

/**
 * Goal templates (EXT-TEMPLATES, owner 2026-11-11): build X buildings, collect by a deadline, capture the island,
 * hold a region and the home trade quest. Their player-visible texts are English; translators add the rest.
 */

const BOARD_TIME_WIDTH = 72;
const RESPONSE_AMOUNT: Expr = { k: "resp", key: "amount" };
const remaining = (timer: string): Expr => ({ args: { timer: ref("timer", timer) }, fn: "timerRemaining", k: "fn" });
const questActive = (quest: string): Condition =>
  ({ args: { quest: ref("quest", quest), state: stringLiteral("active") }, k: "is", pred: "questIs" });
const timerVariable = (id: string, name: string, seconds: number): ScriptVariable => ({
  id, initial: { type: "timer", value: { autoStart: false, periodic: false, seconds, window: null } }, name,
  type: "timer"
});

interface GoalBoard {
  /** The counter shown as "current / target"; null leaves the progress column out. */
  counter: { target: number; variable: string } | null;
  /** Catalog id of the row icon (`ware:planks`); null shows no icon. */
  icon: string | null;
  row: string;
  /** The timer shown as a countdown; null leaves the time column out. */
  timer: string | null;
  title: string;
}

/** A one-row board: the task with an optional progress fraction and an optional countdown. */
const goalBoard = ({ counter, icon, row, timer, title }: GoalBoard): ScriptVariable["initial"] => ({
  type: "multiboard", value: {
    audience: PLAYER_ONE,
    cells: {
      task: { expr: { k: "cell", key: "rowLabel" }, format: "text" },
      ...(counter && { done: { current: variable(counter.variable), format: "fraction" as const,
        target: numberLiteral(counter.target) } }),
      ...(timer && { left: { expr: remaining(timer), format: "countdown" as const } })
    },
    columns: [
      { align: "left", header: english("Task"), id: "task", width: "auto" },
      ...(counter ? [{ align: "right" as const, header: english("Done"), id: "done", width: BOARD_NUMBER_WIDTH }] : []),
      ...(timer ? [{ align: "right" as const, header: english("Time left"), id: "left", width: BOARD_TIME_WIDTH }] : [])
    ],
    initiallyCollapsed: false, initiallyVisible: false,
    rows: { kind: "static", rows: [{ ...(icon && { icon: ref("content", icon) }), id: "r1", label: english(row) }] },
    sort: null, title: english(title)
  }
});

const boardSteps = (board: string) => {
  const multiboard = ref("multiboard", board);
  return { hide: (id: string) => step(id, "hideMultiboard", { multiboard }),
    show: (id: string) => step(id, "showMultiboard", { multiboard }) };
};

/** Build X buildings of a type: each finished construction counts; an optional board shows the progress. */
export const buildCount: TemplateBuilder = (ids, params) => {
  const [counter, board] = ids.variables as [string, string | undefined];
  const building = `building:${params.building}`;
  const steps = board ? boardSteps(board) : null;
  return {
    actors: [], regions: [],
    quests: [{ ...counterQuest(ids.quests[0]!, counter, params.count, english("Build for the settlement")),
      onActivate: steps ? [steps.show("s1")] : [], onSuccess: steps ? [steps.hide("s1")] : [] }],
    triggers: [trigger(ids.triggers[0]!, params.labels.buildCounter, {
      actions: [increaseStep("s1", counter, numberLiteral(1))],
      events: [{ kind: "constructionCompleted", player: PLAYER_ONE, slots: {
        building: { kind: "type", type: { type: ref("content", building) } }
      } }]
    })],
    variables: [numberVariable(counter, "built"), ...(board ? [{ id: board, initial: goalBoard({
      counter: { target: params.count, variable: counter }, icon: building, row: "Buildings finished", timer: null,
      title: "Building project"
    }), name: "buildBoard", type: "multiboard" as const }] : [])]
  };
};

/**
 * Collect Y wares by a deadline: production counts, a timer runs from the quest's activation, a board shows both,
 * and the quest fails when the time is up. Reaching Y stops the clock at once (`onSuccess` would wait for the claim).
 */
export const collectDeadline: TemplateBuilder = (ids, params) => {
  const [counter, timer, board] = ids.variables as [string, string, string];
  const [count, expired, met] = ids.triggers as [string, string, string];
  const questId = ids.quests[0]!;
  const ware = `ware:${params.ware}`;
  const steps = boardSteps(board);
  const timerStep = (id: string, op: "timerStart" | "timerStop") => step(id, op, { timer: ref("timer", timer) });
  return {
    actors: [], regions: [],
    quests: [{ ...counterQuest(questId, counter, params.count, english("Deliver before the deadline")),
      onActivate: [timerStep("s1", "timerStart"), steps.show("s2")], onFailure: [steps.hide("s1")] }],
    triggers: [
      trigger(count, params.labels.deadlineCounter, {
        actions: [increaseStep("s1", counter, RESPONSE_AMOUNT)], conditions: questActive(questId),
        events: [{ kind: "wareProduced", player: PLAYER_ONE, slots: { ware: ref("content", ware) } }]
      }),
      trigger(expired, params.labels.deadlineExpired, {
        actions: [step("s1", "failQuest", { quest: ref("quest", questId) })], conditions: questActive(questId),
        events: [{ kind: "timerExpired", player: { kind: "any" }, slots: { timer: ref("timer", timer) } }]
      }),
      trigger(met, params.labels.deadlineMet, {
        actions: [timerStep("s1", "timerStop"), steps.hide("s2")],
        events: [{ kind: "questSucceeded", player: { kind: "any" }, slots: { quest: ref("quest", questId) } }]
      })
    ],
    variables: [numberVariable(counter, "produced"), timerVariable(timer, "deadlineTimer", params.seconds),
      { id: board, initial: goalBoard({ counter: { target: params.count, variable: counter }, icon: ware,
        row: "Wares produced", timer, title: "Deadline" }), name: "deadlineBoard", type: "multiboard" }]
  };
};

const endMap = (id: string, outcome: "defeat" | "victory"): ScriptAction =>
  step(id, "endMap", { outcome: stringLiteral(outcome) });

const CAPTURE_OBJECTIVES: Readonly<Record<CaptureGoal, QuestObjective>> = {
  capture: { all: true, buildingId: null, kind: "enemyBuildingDestroyed" },
  defeat: { all: true, count: 1, kind: "enemiesDefeated" }
};
const CAPTURE_TITLES: Readonly<Record<CaptureGoal, string>> = {
  capture: "Capture the island", defeat: "Defeat every enemy"
};

/**
 * Capture the island (the generated adventure book's rule): once the enemy is beaten, claiming the quest ends the
 * map in victory; the map is lost when Player 1 is defeated.
 */
export const captureIsland: TemplateBuilder = (ids, params) => ({
  actors: [], regions: [], triggers: [], variables: [],
  quests: [titledQuest(ids.quests[0]!, english(CAPTURE_TITLES[params.goal]), {
    failure: { args: { player: PLAYER_ONE }, k: "is", pred: "playerDefeated" },
    objective: CAPTURE_OBJECTIVES[params.goal],
    onFailure: [endMap("s1", "defeat")], onSuccess: [endMap("s1", "victory")]
  })]
});

/**
 * Hold a region (the EXT-TIMER `holdRegion` example): the countdown runs while a soldier of Player 1 stands in the
 * region, pauses when the last one leaves, and its expiry completes the quest; a board shows the time left.
 */
export const holdRegion: TemplateBuilder = (ids, params) => {
  const region = ref("region", params.region ?? ids.regions[0]!);
  const [timer, board] = ids.variables as [string, string];
  const [entered, abandoned, done] = ids.triggers as [string, string, string];
  const questId = ids.quests[0]!;
  const soldiers = { family: ref("family", "soldier"), kind: "family" as const };
  const steps = boardSteps(board);
  const timerStep = (id: string, op: string) => step(id, op, { timer: ref("timer", timer) });
  const regionEvent = (kind: "enteredRegion" | "leftRegion") =>
    ({ kind, player: PLAYER_ONE, slots: { region, subject: soldiers } });
  const soldiersInside: Expr = { args: { region, selector: { ...soldiers, owner: PLAYER_ONE } }, fn: "countInRegion",
    k: "fn" };
  return {
    actors: [],
    quests: [titledQuest(questId, english("Hold the region"),
      { onActivate: [steps.show("s1")], onSuccess: [steps.hide("s1")] })],
    regions: params.region ? [] : [circle(region.id, params.labels.holdArea, params.mapCenter.x, params.mapCenter.z)],
    triggers: [
      trigger(entered, params.labels.holdEntered, {
        actions: [{ cond: { a: remaining(timer), b: numberLiteral(0), k: "compare", op: ">" },
          else: [timerStep("s3", "timerStart")], id: "s1", k: "if", then: [timerStep("s2", "timerResume")] }],
        conditions: questActive(questId), events: [regionEvent("enteredRegion")]
      }),
      trigger(abandoned, params.labels.holdAbandoned, {
        actions: [timerStep("s1", "timerPause")],
        conditions: { a: soldiersInside, b: numberLiteral(0), k: "compare", op: "==" },
        events: [regionEvent("leftRegion")]
      }),
      trigger(done, params.labels.holdDone, {
        actions: [step("s1", "completeQuest", { quest: ref("quest", questId) })],
        events: [{ kind: "timerExpired", player: { kind: "any" }, slots: { timer: ref("timer", timer) } }], runLimit: 1
      })
    ],
    variables: [timerVariable(timer, "holdTimer", params.seconds),
      { id: board, initial: goalBoard({ counter: null, icon: null, row: "Hold the region", timer,
        title: "Defence of the region" }), name: "holdBoard", type: "multiboard" }]
  };
};

/** Trade quest (home island only): wares sold at the trade office count towards N. */
export const tradeQuest: TemplateBuilder = (ids, params) => ({
  actors: [], regions: [],
  quests: [counterQuest(ids.quests[0]!, ids.variables[0]!, params.count, english("Sell wares at the trade office"))],
  triggers: [trigger(ids.triggers[0]!, params.labels.sellCounter, {
    actions: [increaseStep("s1", ids.variables[0]!, RESPONSE_AMOUNT)],
    events: [{ kind: "wareSold", player: PLAYER_ONE, slots: { ware: ref("content", `ware:${params.ware}`) } }]
  })],
  variables: [numberVariable(ids.variables[0]!, "sold")]
});

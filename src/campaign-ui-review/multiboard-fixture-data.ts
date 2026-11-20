import type { MapScript, ScriptAction, ScriptTrigger } from "../../../island-of-settlers-shared/src/script/types/index";

/**
 * Review script of the multiboards (TRG8): the design's §14.4 "plant 8 trees" board with its quest and counting
 * trigger, plus a second board ("who has more soldiers") with one row per player, sorted, and (EXT-TIMER) a
 * "hold the pass" board with a countdown cell next to a timer window. Plain map data.
 */
const ref = <K extends string>(kind: K, id: string) => ({ id, k: "ref" as const, kind });
const num = (value: number) => ({ k: "lit" as const, type: "number" as const, value });
const player1 = { faction: 0, kind: "slot" as const };
const planted = { k: "var" as const, variable: ref("variable", "var-2") };
const rowPlayer = { k: "cell" as const, key: "rowPlayer" as const };
const holdTimer = ref("timer", "var-5");

export const GROVE_QUEST_ID = "grove";
export const GROVE_TARGET = 8;
/** The event the review fires to show the second board. */
export const ARMY_BOARD_HOUR = 1;
/** The event the review fires to start the two timers and show the hold board. */
export const HOLD_BOARD_HOUR = 2;
export const REVIEW_SOLDIERS = [14, 23, 9] as const;
export const REVIEW_PLAYER_NAMES = ["Aurelia", "Bjorn", "Kasumi"] as const;

const doStep = (id: string, op: string, args: Record<string, unknown>) =>
  ({ args, id, k: "do", op }) as ScriptAction;

const trigger = (id: string, name: string, fields: Pick<ScriptTrigger, "actions" | "events">): ScriptTrigger =>
  ({ concurrency: "queue", conditions: { k: "all", of: [] }, enabled: true, folderId: null, id, name,
    runLimit: null, ...fields });

export const multiboardReviewScript = (): MapScript => ({
  actors: [], cameraShots: [], folders: [], homeRewards: [],
  nextIds: { actor: 0, folder: 0, region: 0, reward: 0, trigger: 10, variable: 8 },
  quests: {
    daily: "off", dailyResetUtcMinutes: 0, groups: [], id: "review-book", revision: 1, version: 1,
    quests: [{
      cost: [], deadline: null, failure: null, id: GROVE_QUEST_ID, onFailure: [],
      objective: {
        condition: { a: planted, b: num(GROVE_TARGET), k: "compare", op: ">=" }, kind: "condition",
        progress: { current: planted, target: num(GROVE_TARGET) }
      },
      onActivate: [doStep("s1", "showMultiboard", { multiboard: ref("multiboard", "var-3") })],
      onSuccess: [doStep("s1", "hideMultiboard", { multiboard: ref("multiboard", "var-3") })],
      repeat: { kind: "once", retryAfterFail: false }, title: { en: "A grove for the village", hu: "Liget a falunak" },
      visibility: "visible"
    }]
  },
  regions: [], revision: 1, scriptUid: "multiboard-review", sequences: [],
  triggers: [
    trigger("trigger-7", "Count planting", {
      actions: [doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", "var-2") })],
      events: [{ kind: "treePlanted", player: player1, slots: {} }]
    }),
    trigger("trigger-8", "Show the army board", {
      actions: [doStep("s1", "showMultiboard", { multiboard: ref("multiboard", "var-4") })],
      events: [{ kind: "clockHour", player: { kind: "any" }, slots: { hour: num(ARMY_BOARD_HOUR) } }]
    }),
    trigger("trigger-9", "Start the hold", {
      actions: [
        doStep("s1", "showMultiboard", { multiboard: ref("multiboard", "var-6") }),
        doStep("s2", "timerStart", { timer: holdTimer }),
        doStep("s3", "timerStart", { timer: ref("timer", "var-7") })
      ],
      events: [{ kind: "clockHour", player: { kind: "any" }, slots: { hour: num(HOLD_BOARD_HOUR) } }]
    })
  ],
  variables: [
    { id: "var-2", initial: { type: "number", value: 0 }, name: "planted", type: "number" },
    { id: "var-3", name: "groveBoard", type: "multiboard", initial: { type: "multiboard", value: {
      audience: player1,
      cells: {
        done: { current: planted, format: "fraction", target: num(GROVE_TARGET) },
        task: { expr: { k: "cell", key: "rowLabel" }, format: "text" }
      },
      columns: [{ align: "left", header: { en: "Task", hu: "Feladat" }, id: "task", width: "auto" },
        { align: "right", header: { en: "Done", hu: "Kész" }, id: "done", width: 64 }],
      initiallyCollapsed: false, initiallyVisible: false,
      rows: { kind: "static", rows: [{ icon: ref("content", "tree:broadleafTree"), id: "trees",
        label: { en: "Plant trees", hu: "Ültess fákat" } }] },
      sort: null, title: { en: "Grove project", hu: "Liget projekt" }
    } } },
    { id: "var-4", name: "armyBoard", type: "multiboard", initial: { type: "multiboard", value: {
      audience: player1,
      cells: {
        player: { expr: { args: { player: rowPlayer }, fn: "playerName", k: "fn" }, format: "text" },
        soldiers: { expr: { args: { owner: rowPlayer }, fn: "soldierCount", k: "fn" }, format: "number" }
      },
      columns: [{ align: "left", header: { en: "Player", hu: "Játékos" }, id: "player", width: "auto" },
        { align: "right", header: { en: "Soldiers", hu: "Katonák" }, id: "soldiers", width: 72 }],
      initiallyCollapsed: false, initiallyVisible: false,
      rows: { filter: { kind: "any" }, kind: "players" },
      sort: { columnId: "soldiers", direction: "desc" },
      title: { en: "Who has more soldiers?", hu: "Kinek van több katonája?" }
    } } },
    { id: "var-5", name: "holdTimer", type: "timer", initial: { type: "timer", value: {
      autoStart: false, periodic: false, seconds: 300, window: null } } },
    { id: "var-6", name: "holdBoard", type: "multiboard", initial: { type: "multiboard", value: {
      audience: player1,
      cells: {
        left: { expr: { args: { timer: holdTimer }, fn: "timerRemaining", k: "fn" }, format: "countdown" },
        task: { expr: { k: "cell", key: "rowLabel" }, format: "text" }
      },
      columns: [{ align: "left", header: { en: "Task", hu: "Feladat" }, id: "task", width: "auto" },
        { align: "right", header: { en: "Time left", hu: "Hátralévő idő" }, id: "left", width: 128 }],
      initiallyCollapsed: false, initiallyVisible: false,
      rows: { kind: "static", rows: [{ id: "hold", label: { en: "Hold the pass", hu: "Tartsd a szorost" } }] },
      sort: null, title: { en: "Defence of the pass", hu: "A szoros védelme" }
    } } },
    { id: "var-7", name: "reliefTimer", type: "timer", initial: { type: "timer", value: {
      autoStart: false, periodic: false, seconds: 600,
      window: { title: { en: "Reinforcements arrive", hu: "Erősítés érkezik" } } } } }
  ],
  version: 1
});

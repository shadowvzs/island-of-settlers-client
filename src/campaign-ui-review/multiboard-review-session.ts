import { ScriptEngine } from "../../../island-of-settlers-shared/src/script/engine/engine";
import { createNullWorldPort, type ScriptWorldPort } from "../../../island-of-settlers-shared/src/script/engine/ports";
import { TICK_HZ } from "../../../island-of-settlers-shared/src/time/constants";
import { publishMultiboards } from "../app/script/multiboard/multiboard-store";
import { REVIEW_SCRIPT_SEED, REVIEW_VIEWER_FACTION } from "./constants";
import {
  ARMY_BOARD_HOUR, GROVE_QUEST_ID, HOLD_BOARD_HOUR, multiboardReviewScript, REVIEW_PLAYER_NAMES, REVIEW_SOLDIERS
} from "./multiboard-fixture-data";

export interface MultiboardReviewOptions {
  /** Script seconds already counted down on the hold board and the timer window; null: no timers shown. */
  countdownSeconds: number | null;
  /** Trees already planted when the page opens. */
  planted: number;
  /** Also show the second board (player rows, sorted). */
  secondBoard: boolean;
}

/** A stand-in world: three players with a soldier count each; the review raises player 1's army. */
const reviewPort = (soldiers: number[]): ScriptWorldPort => ({
  ...createNullWorldPort(),
  callFunction: (fn, args, scope) => {
    const faction = Number(scope.evaluate((args.owner ?? args.player) as Parameters<typeof scope.evaluate>[0]));
    if (fn === "soldierCount") return soldiers[faction] ?? 0;
    return fn === "playerName" ? REVIEW_PLAYER_NAMES[faction] ?? "" : null;
  },
  playerFactions: () => soldiers.map((_count, faction) => faction)
});

/**
 * Runs the review script on the real engine and publishes its boards the way the settlement session will: the
 * engine's snapshots go into the multiboard feed after the ticks that changed them.
 */
export const createMultiboardReviewSession = (
  { countdownSeconds, planted, secondBoard }: MultiboardReviewOptions
) => {
  const soldiers: number[] = [...REVIEW_SOLDIERS];
  const script = multiboardReviewScript();
  const engine = ScriptEngine.create(script,
    { port: reviewPort(soldiers), scriptHash: "review", seed: REVIEW_SCRIPT_SEED });
  const publish = () => publishMultiboards(engine.multiboardSnapshots(REVIEW_VIEWER_FACTION), script.scriptUid);
  const tick = (ticks = 1) => {
    for (let count = 0; count < ticks; count++) engine.endTick();
    publish();
  };
  const plantTree = () => {
    engine.emit({ actors: { by: { family: "settler", handle: { generation: 0, id: 1, space: "actor" },
      owner: REVIEW_VIEWER_FACTION, type: "settler:forester" } }, kind: "treePlanted" });
    tick();
  };
  engine.start("mapStarted");
  engine.activateQuest(GROVE_QUEST_ID);
  tick();
  if (secondBoard) {
    engine.emit({ kind: "clockHour", values: { hour: ARMY_BOARD_HOUR } });
    tick();
  }
  for (let tree = 0; tree < planted; tree++) plantTree();
  if (countdownSeconds !== null) {
    engine.emit({ kind: "clockHour", values: { hour: HOLD_BOARD_HOUR } });
    tick(1 + countdownSeconds * TICK_HZ);
  }
  return {
    /** One script second: countdown cells and timer windows refresh on the engine's one-second cadence. */
    passSecond: () => tick(TICK_HZ),
    plantTree,
    /** One more soldier for player 1; world cells refresh on the engine's one-second cadence. */
    recruitSoldier: () => {
      soldiers[REVIEW_VIEWER_FACTION] = (soldiers[REVIEW_VIEWER_FACTION] ?? 0) + 1;
      tick(TICK_HZ);
    }
  };
};

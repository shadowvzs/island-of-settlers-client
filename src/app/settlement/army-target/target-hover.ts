import type { ArmyTargetHoverOutline } from "../../../render-common/renderer-contract";
import type { MapHoverPick } from "../map-hover-pick";
import { settlementBuildingFrameId } from "../settlement-render-frames";
import { ARMY_HOVER_INTERVAL_MS, ARMY_ORDER_MODIFIER_KEYS } from "./constants";
import { type ArmyTarget, armyTargetCursor, type ArmyTargetModifiers, resolveArmyTarget } from "./helpers";
import { type ArmyTargetPickOptions, collectArmyTargetPicks } from "./target-picks";

type Timers = {
  clear: (handle: number) => void;
  now: () => number;
  set: (run: () => void, delay: number) => number;
};

const BROWSER_TIMERS: Timers = {
  clear: handle => window.clearTimeout(handle),
  now: () => performance.now(),
  set: (run, delay) => window.setTimeout(run, delay)
};

/**
 * At most one run per `intervalMs`: a request inside the interval runs once at its end (trailing), so the
 * last pointer position is always evaluated.
 */
export const createHoverThrottle = (intervalMs: number, timers: Timers = BROWSER_TIMERS) => {
  let last = Number.NEGATIVE_INFINITY, timer = 0, pending: (() => void) | null = null;
  const fire = () => {
    timer = 0;
    last = timers.now();
    const run = pending;
    pending = null;
    run?.();
  };
  return {
    cancel: () => { if (timer) timers.clear(timer); timer = 0; pending = null; },
    request: (run: () => void) => {
      pending = run;
      if (timer) return;
      const wait = last + intervalMs - timers.now();
      if (wait <= 0) fire();
      else timer = timers.set(fire, wait);
    }
  };
};

/**
 * The outline of a hover target: the building, ship or enemy soldier it acts on, by renderer frame id (buildings
 * draw as `settlement-<uid>`); none over ground.
 */
export const armyTargetOutline = (target: ArmyTarget): ArmyTargetHoverOutline => {
  if (target.kind === "attackUnit" || target.kind === "targetUnit") return { soldierId: target.targetUid };
  if (target.kind === "board" || target.kind === "boardRefused") return { shipId: target.shipId };
  if ("building" in target) return { buildingId: settlementBuildingFrameId(target.building.uid) };
  return {};
};

/** What a hover target looks like (cursor and outline): equal keys need no new cursor or outline. */
export const armyTargetHoverKey = (target: ArmyTarget | null) => {
  if (!target) return "";
  const { buildingId = "", shipId = "", soldierId = "" } = armyTargetOutline(target);
  return `${armyTargetCursor(target)}|${buildingId}|${shipId}|${soldierId}`;
};

export interface ArmyTargetHoverOptions extends Omit<ArmyTargetPickOptions, "pickTargetBuilding"> {
  /** Hover work runs only while soldiers are selected and no armed order or box mode owns the cursor. */
  active: () => boolean;
  hover: Pick<MapHoverPick, "building" | "current" | "subscribe">;
  /** The target under the mouse (null: none, or the hover is off). */
  onTarget: (target: ArmyTarget | null) => void;
  timers?: Timers;
}

/**
 * The soldiers' target hover (military controls P3): with soldiers selected, the mouse over the map resolves the
 * smart right-click target at most every 100 ms, on pointer movement (or a held Ctrl / Alt) only, from the
 * shared hover sample and its building pick. Touch never produces a sample, so phones do no hover work.
 */
export const createArmyTargetHover = (options: ArmyTargetHoverOptions) => {
  const events = new AbortController();
  const throttle = createHoverThrottle(ARMY_HOVER_INTERVAL_MS, options.timers);
  const pickOptions: ArmyTargetPickOptions = { ...options, pickTargetBuilding: () => options.hover.building() };
  let modifiers: ArmyTargetModifiers = {};
  let shownKey = "";

  /** Tells the controls only about a changed target (the outline and cursor are applied once per change). */
  const show = (target: ArmyTarget | null) => {
    const key = armyTargetHoverKey(target);
    if (key === shownKey) return;
    shownKey = key;
    options.onTarget(target);
  };
  const evaluate = () => {
    const sample = options.hover.current();
    if (!sample || !options.active()) return show(null);
    show(resolveArmyTarget(collectArmyTargetPicks(pickOptions, sample.x, sample.y), modifiers));
  };
  /** Re-reads the target (after a pointer move, a selection change or a modifier key). */
  const refresh = () => {
    if (!options.hover.current() || !options.active()) { throttle.cancel(); show(null); return; }
    throttle.request(evaluate);
  };
  const stop = options.hover.subscribe(sample => {
    if (sample) modifiers = { altKey: sample.altKey, ctrlKey: sample.ctrlKey };
    refresh();
  });
  const onModifierKey = (event: KeyboardEvent) => {
    if (!ARMY_ORDER_MODIFIER_KEYS.has(event.key)) return;
    modifiers = { altKey: event.altKey, ctrlKey: event.ctrlKey };
    if (shownKey) refresh();
  };
  window.addEventListener("keydown", onModifierKey, { signal: events.signal });
  window.addEventListener("keyup", onModifierKey, { signal: events.signal });
  return {
    refresh,
    dispose: () => { stop(); events.abort(); throttle.cancel(); show(null); }
  };
};

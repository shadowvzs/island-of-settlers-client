/**
 * R09 + C13 budget controller: a pure state machine that holds the frame rate between the lower
 * bound (40 fps) and the target (60 fps) with two kinds of presentation levers.
 *
 * - GPU-bound frames lower the render scale (a multiplier of the drawing-buffer pixel ratio) on a
 *   0.05 grid down to the allowed minimum; CPU-bound frames never lower the resolution.
 * - CPU-bound frames raise the CPU level: coarser pose cadence of small characters, then no
 *   decorative life. Gameplay, simulation, fog and visibility of units are never outputs.
 *
 * Decrease after an overrun lasting at least 1 s, increase after a headroom lasting 8 s (doubled
 * after every rebound), at most one change per 2 s, frozen during loading and view changes.
 * Without a GPU timer an unclear overrun tries one resolution step and keeps it only when the
 * frame interval improved measurably.
 */

/** The bound the controller must hold: below it the frame rate is too low. */
export const BUDGET_LOWER_FPS = 40;
/** The frame rate headroom is measured against (iso and FPS view alike, D-AI6 open). */
export const BUDGET_TARGET_FPS = 60;
/** Grid of the render scale. */
export const RENDER_SCALE_STEP = 0.05;
/** Overrun share above the lower-bound frame time that counts as an overrun. */
const OVERRUN_MARGIN = 1.05;
/** Overrun this large takes two grid steps at once (still one change). */
const LARGE_OVERRUN = 1.3;
/** Work time below this share of the target frame time counts as headroom. */
const HEADROOM_SHARE = 0.85;
/** Unknown cause: main-thread time above this share of the frame interval means CPU-bound. */
const CPU_SHARE_OF_INTERVAL = 0.8;
/** A trial (unknown cause) takes two grid steps: one step is often lost in vsync quantisation. */
const TRIAL_STEPS = 2;
/** With a GPU timer one increase may take this many grid steps when the predicted cost fits. */
const MAX_INCREASE_STEPS = 4;
/** Trial steps must improve the frame interval by this share to stay. */
const TRIAL_IMPROVEMENT = 0.05;
export const OVERRUN_HOLD_MS = 1000;
export const HEADROOM_HOLD_MS = 8000;
export const MIN_STEP_INTERVAL_MS = 2000;
/** A decrease this soon after an increase is a rebound: the next increase waits twice as long. */
const REBOUND_WINDOW_MS = 10000;
const MAX_HEADROOM_HOLD_MS = 64000;
/** A failed resolution trial blocks further trials this long. */
const TRIAL_BLOCK_MS = 30000;
const EVALUATION_INTERVAL_MS = 250;
/** Frames needed after a change or a freeze before the window is judged. */
const MIN_WINDOW_FRAMES = 20;
const WINDOW_FRAMES = 64;
const PERCENTILE = 0.9;

export type BudgetCause = "cpu" | "gpu" | "unknown";
type BudgetLever = "cpu" | "gpu";

export interface RenderBudgetLevers {
  /** 0: full presentation; every level adds one CPU concession (see the app adapter). */
  cpuLevel: number;
  /** Multiplier of the drawing-buffer pixel ratio, in (0, 1]. */
  renderScale: number;
}

export interface RenderBudgetLimits {
  /** The frame rate to hold (BUDGET_LOWER_FPS, or a lower frame-rate limit). */
  lowerFps: number;
  /** Highest CPU level available (0: the CPU branch is off). */
  maxCpuLevel: number;
  /** Lowest render scale allowed (1: the GPU branch is off). */
  minScale: number;
  /** The frame rate headroom is measured against (BUDGET_TARGET_FPS, or a lower limit). */
  targetFps: number;
}

export interface RenderBudgetStatus extends RenderBudgetLevers {
  /** The cause of the latest decrease; null while nothing was lowered. */
  cause: BudgetCause | null;
  /** Over budget with every allowed lever already at its limit: a lower Detail would help. */
  exhausted: boolean;
}

interface WindowStats {
  cpu: number;
  gpu: number | null;
  interval: number;
}

interface Trial {
  baseline: number;
  since: number;
  steps: number;
}

const roundScale = (scale: number) => Math.round(scale / RENDER_SCALE_STEP) * RENDER_SCALE_STEP;

const percentile = (values: Float32Array, count: number) => {
  const sorted = Array.from(values.subarray(0, count)).sort((left, right) => left - right);
  return sorted[Math.min(count - 1, Math.floor(count * PERCENTILE))] ?? 0;
};

/** A ring of the latest values; `count` grows to the capacity. */
const createRing = (capacity: number) => {
  const values = new Float32Array(capacity);
  let cursor = 0;
  let count = 0;
  return {
    clear: () => { cursor = 0; count = 0; },
    count: () => count,
    percentile: () => percentile(values, count),
    push: (value: number) => {
      values[cursor] = value;
      cursor = (cursor + 1) % capacity;
      count = Math.min(capacity, count + 1);
    }
  };
};

// oxlint-disable-next-line max-lines-per-function -- one closure owns the controller state
export const createRenderBudgetController = (initialLimits: RenderBudgetLimits) => {
  const intervals = createRing(WINDOW_FRAMES);
  const cpuTimes = createRing(WINDOW_FRAMES);
  const gpuTimes = createRing(WINDOW_FRAMES);
  const history: BudgetLever[] = [];
  let limits = initialLimits;
  let levers: RenderBudgetLevers = { cpuLevel: 0, renderScale: 1 };
  let cause: BudgetCause | null = null;
  let exhausted = false;
  let frozenUntil = -Infinity;
  let lastChangeAt = -Infinity;
  let lastIncreaseAt = -Infinity;
  let lastEvaluationAt = -Infinity;
  let overrunSince: number | null = null;
  let headroomSince: number | null = null;
  let headroomHold = HEADROOM_HOLD_MS;
  let trial: Trial | null = null;
  let trialBlockedUntil = -Infinity;
  let increasesBlocked = false;

  const budgetMs = () => 1000 / limits.lowerFps;
  const targetMs = () => 1000 / limits.targetFps;

  const clearWindow = () => {
    intervals.clear();
    cpuTimes.clear();
    gpuTimes.clear();
    overrunSince = null;
    headroomSince = null;
  };

  const readWindow = (): WindowStats => ({
    cpu: cpuTimes.percentile(),
    gpu: gpuTimes.count() >= MIN_WINDOW_FRAMES / 2 ? gpuTimes.percentile() : null,
    interval: intervals.percentile()
  });

  const change = (now: number, next: RenderBudgetLevers) => {
    levers = next;
    lastChangeAt = now;
    clearWindow();
    return levers;
  };

  const classify = (stats: WindowStats, now: number): BudgetCause => {
    if (stats.gpu !== null) return stats.gpu > stats.cpu ? "gpu" : "cpu";
    if (stats.cpu > stats.interval * CPU_SHARE_OF_INTERVAL) return "cpu";
    return now < trialBlockedUntil ? "cpu" : "unknown";
  };

  const decreaseSteps = (stats: WindowStats, found: BudgetCause) => {
    if (found === "unknown") return TRIAL_STEPS;
    return stats.interval > budgetMs() * LARGE_OVERRUN ? 2 : 1;
  };

  /** Returns the grid steps taken (0: already at the floor). */
  const lowerScale = (now: number, stats: WindowStats, found: BudgetCause) => {
    const steps = decreaseSteps(stats, found);
    const scale = Math.max(limits.minScale, roundScale(levers.renderScale - steps * RENDER_SCALE_STEP));
    if (scale >= levers.renderScale) return 0;
    const taken = Math.round((levers.renderScale - scale) / RENDER_SCALE_STEP);
    for (let step = 0; step < taken; step++) history.push("gpu");
    change(now, { ...levers, renderScale: scale });
    return taken;
  };

  const raiseCpuLevel = (now: number) => {
    if (levers.cpuLevel >= limits.maxCpuLevel) return null;
    history.push("cpu");
    return change(now, { ...levers, cpuLevel: levers.cpuLevel + 1 });
  };

  const noteRebound = (now: number) => {
    if (now - lastIncreaseAt <= REBOUND_WINDOW_MS)
      headroomHold = Math.min(MAX_HEADROOM_HOLD_MS, headroomHold * 2);
  };

  const decrease = (now: number, stats: WindowStats) => {
    const found = classify(stats, now);
    let steps = 0;
    if (found === "cpu") steps = raiseCpuLevel(now) ? 1 : 0;
    else steps = lowerScale(now, stats, found);
    exhausted = steps === 0;
    if (exhausted) return null;
    cause = found;
    noteRebound(now);
    if (found === "unknown") trial = trial
      ? { ...trial, since: now, steps: trial.steps + steps }
      : { baseline: stats.interval, since: now, steps };
    return levers;
  };

  /** Undoes the latest lowered lever: one CPU level, or up to `gpuSteps` grid steps. */
  const increase = (now: number, gpuSteps = 1) => {
    const lever = history.pop();
    if (!lever) return null;
    lastIncreaseAt = now;
    if (lever === "cpu") {
      if (history.length === 0) cause = null;
      return change(now, { ...levers, cpuLevel: Math.max(0, levers.cpuLevel - 1) });
    }
    let steps = 1;
    while (steps < gpuSteps && history[history.length - 1] === "gpu") {
      history.pop();
      steps++;
    }
    if (history.length === 0) cause = null;
    const renderScale = Math.min(1, roundScale(levers.renderScale + steps * RENDER_SCALE_STEP));
    return change(now, { ...levers, renderScale });
  };

  /** GPU time (ms) predicted at `scale` from the measured time at the current scale (pixel count). */
  const predictGpu = (gpu: number, scale: number) => gpu * (scale / levers.renderScale) ** 2;

  /**
   * Grid steps up whose predicted GPU time still leaves headroom; 1 without a timer (trial and
   * rebound backoff guard it). 0 when even one step would not fit the target frame time.
   */
  const increaseSteps = (stats: WindowStats) => {
    if (stats.gpu === null || history[history.length - 1] !== "gpu") return 1;
    const gpu = stats.gpu;
    const fits = (steps: number, budget: number) =>
      predictGpu(gpu, Math.min(1, levers.renderScale + steps * RENDER_SCALE_STEP)) < budget;
    if (!fits(1, targetMs())) return 0;
    let steps = 1;
    while (steps < MAX_INCREASE_STEPS && fits(steps + 1, targetMs() * HEADROOM_SHARE)) steps++;
    return steps;
  };

  /**
   * Unknown cause: trial steps continue down to the floor (vsync quantisation can hide one step);
   * as soon as the interval beats the pre-trial baseline the steps stay. At the floor without an
   * improvement every trial step is undone and later overruns go to the CPU branch.
   */
  const judgeTrial = (now: number, stats: WindowStats) => {
    if (!trial || now - trial.since < MIN_STEP_INTERVAL_MS) return null;
    if (stats.interval <= trial.baseline * (1 - TRIAL_IMPROVEMENT)) {
      trial = null;
      return null;
    }
    if (levers.renderScale > limits.minScale) return null;
    const { steps } = trial;
    trial = null;
    trialBlockedUntil = now + TRIAL_BLOCK_MS;
    // Undoing a trial is no headroom increase: it must not count towards a rebound.
    const previousIncrease = lastIncreaseAt;
    const undone = increase(now, steps);
    lastIncreaseAt = previousIncrease;
    return undone;
  };

  const hasHeadroom = (stats: WindowStats) => {
    const work = Math.max(stats.cpu, stats.gpu ?? 0);
    if (work >= targetMs() * HEADROOM_SHARE) return false;
    // Without a GPU timer only a frame interval at the display rate shows that the GPU keeps up.
    return stats.gpu !== null || stats.interval <= targetMs() * (2 - HEADROOM_SHARE);
  };

  const trackConditions = (now: number, stats: WindowStats) => {
    const overrun = stats.interval > budgetMs() * OVERRUN_MARGIN;
    overrunSince = overrun ? overrunSince ?? now : null;
    if (!overrun) exhausted = false;
    const headroom = !overrun && !increasesBlocked && history.length > 0 && hasHeadroom(stats);
    headroomSince = headroom ? headroomSince ?? now : null;
  };

  const evaluate = (now: number) => {
    if (intervals.count() < MIN_WINDOW_FRAMES) return null;
    const stats = readWindow();
    const judged = judgeTrial(now, stats);
    if (judged) return judged;
    trackConditions(now, stats);
    if (now - lastChangeAt < MIN_STEP_INTERVAL_MS) return null;
    if (overrunSince !== null && now - overrunSince >= OVERRUN_HOLD_MS) return decrease(now, stats);
    if (headroomSince === null || now - headroomSince < headroomHold) return null;
    const steps = increaseSteps(stats);
    return steps > 0 ? increase(now, steps) : null;
  };

  /**
   * One drawn frame: its interval and main-thread time (ms) at `now` (ms). Returns the new levers
   * when this frame's evaluation changed them, otherwise null.
   */
  const recordFrame = (now: number, intervalMs: number, cpuMs: number) => {
    if (now < frozenUntil) return null;
    intervals.push(intervalMs);
    cpuTimes.push(cpuMs);
    if (now - lastEvaluationAt < EVALUATION_INTERVAL_MS) return null;
    lastEvaluationAt = now;
    return evaluate(now);
  };

  /** A finished GPU timer query (ms); results arrive a few frames late. */
  const recordGpu = (now: number, milliseconds: number) => {
    if (now >= frozenUntil) gpuTimes.push(milliseconds);
  };

  /** Ignores frames until `now + durationMs` (loading, view change, reallocation hitch). */
  const freeze = (now: number, durationMs: number) => {
    frozenUntil = Math.max(frozenUntil, now + durationMs);
    trial = null;
    clearWindow();
  };

  /** New limits clamp the levers at once; returns the clamped levers when they changed. */
  const setLimits = (now: number, next: RenderBudgetLimits) => {
    limits = next;
    const clamped = {
      cpuLevel: Math.min(levers.cpuLevel, next.maxCpuLevel),
      renderScale: Math.max(levers.renderScale, next.minScale)
    };
    let cpuSteps = clamped.cpuLevel;
    let gpuSteps = Math.round((1 - clamped.renderScale) / RENDER_SCALE_STEP);
    for (let index = history.length - 1; index >= 0; index--) {
      const keep = history[index] === "cpu" ? cpuSteps-- > 0 : gpuSteps-- > 0;
      if (!keep) history.splice(index, 1);
    }
    if (history.length === 0) cause = null;
    if (clamped.cpuLevel === levers.cpuLevel && clamped.renderScale === levers.renderScale) return null;
    return change(now, clamped);
  };

  /** Weak signals (pressure, low battery) may hold the levers down without forcing a decrease. */
  const setIncreasesBlocked = (blocked: boolean) => {
    increasesBlocked = blocked;
    if (blocked) headroomSince = null;
  };

  /** Back to full presentation (Auto switched off or on again). */
  const reset = (now: number) => {
    history.length = 0;
    cause = null;
    exhausted = false;
    trial = null;
    headroomHold = HEADROOM_HOLD_MS;
    return change(now, { cpuLevel: 0, renderScale: 1 });
  };

  const status = (): RenderBudgetStatus => ({ ...levers, cause, exhausted });

  return { freeze, recordFrame, recordGpu, reset, setIncreasesBlocked, setLimits, status };
};

export type RenderBudgetController = ReturnType<typeof createRenderBudgetController>;

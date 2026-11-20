import { DMath } from "../../shared/math/deterministic-math";
import { clamp01 } from "../../shared/world/noise";

/** Timing of one felling (seconds from the first swing). */
const FELLING_TIMING = {
  fall: 1.6,
  firstHit: 0.25,
  hitInterval: 0.7,
  hits: 4,
  rest: 0.9,
  sink: 1.4
} as const;

const FALL_START =
  FELLING_TIMING.firstHit + (FELLING_TIMING.hits - 1) * FELLING_TIMING.hitInterval + 0.55;
const LANDING = FALL_START + FELLING_TIMING.fall;
const GONE = LANDING + FELLING_TIMING.rest + FELLING_TIMING.sink;

export type FellingPhase = "standing" | "chopping" | "falling" | "fallen" | "stump";

/**
 * Per tree animation state. chop: x shake (0..1), y fall (0 upright .. 1 on the ground),
 * z fall direction (world yaw, radians), w sink into the ground (0..1).
 */
export interface FellingState {
  chop: [number, number, number, number];
  phase: FellingPhase;
  showStump: boolean;
  showTree: boolean;
}

const STANDING_TREE: FellingState = {
  chop: [0, 0, 0, 0],
  phase: "standing",
  showStump: false,
  showTree: true
};

/** Each axe hit kicks the crown; the last moments before the fall it creaks and leans. */
const getShake = (elapsed: number) => {
  let shake = 0;
  for (let hit = 0; hit < FELLING_TIMING.hits; hit += 1) {
    const since = elapsed - (FELLING_TIMING.firstHit + hit * FELLING_TIMING.hitInterval);
    if (since >= 0) shake = Math.max(shake, DMath.exp(-since * 6));
  }
  const creak = clamp01((elapsed - (FALL_START - 0.45)) / 0.45) * 0.3;
  return elapsed < FALL_START ? Math.max(shake, creak) : 0;
};

/** Accelerating topple, then a small bounce when the crown hits the ground. */
const getFall = (elapsed: number) => {
  if (elapsed < FALL_START) return 0;
  if (elapsed < LANDING) {
    const progress = (elapsed - FALL_START) / FELLING_TIMING.fall;
    return progress * progress;
  }
  const since = elapsed - LANDING;
  return 1 - 0.06 * DMath.exp(-since * 5) * Math.abs(DMath.sin(since * 14));
};

const getPhase = (elapsed: number): FellingPhase => {
  if (elapsed < FALL_START) return "chopping";
  if (elapsed < LANDING) return "falling";
  if (elapsed < GONE) return "fallen";
  return "stump";
};

export const getFellingState = (elapsed: number, fallYaw: number): FellingState => {
  if (elapsed < 0) return STANDING_TREE;
  const sink = clamp01((elapsed - LANDING - FELLING_TIMING.rest) / FELLING_TIMING.sink);
  return {
    chop: [getShake(elapsed), getFall(elapsed), fallYaw, sink],
    phase: getPhase(elapsed),
    showStump: elapsed >= FALL_START,
    showTree: elapsed < GONE
  };
};

/** Read-only work progress ends at landing, when the worker can collect the trunk. */
export interface FellingWorkProgress {
  phase: "chopping" | "falling";
  progress: number;
}
const getFellingWorkProgress = (elapsed: number): FellingWorkProgress | undefined => {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= LANDING) return undefined;
  return { phase: elapsed < FALL_START ? "chopping" : "falling", progress: clamp01(elapsed / LANDING) };
};

type FellingEventKind = "hit" | "impact";

export interface FellingEvent {
  id: number;
  kind: FellingEventKind;
}

/** Moments of a felling that spawn falling leaves. */
const EVENT_TIMES: [number, FellingEventKind][] = [
  ...Array.from({ length: FELLING_TIMING.hits }, (_, hit): [number, FellingEventKind] => [
    FELLING_TIMING.firstHit + hit * FELLING_TIMING.hitInterval,
    "hit"
  ]),
  [LANDING, "impact"]
];

interface Felling {
  fallYaw: number;
  start: number;
  /** Felled by an upgraded woodcutter: the whole chop and fall play this much faster. */
  rate?: number;
}
const fellingElapsed = (felling: Felling, time: number) => (time - felling.start) * (felling.rate ?? 1);

/**
 * Which trees are being (or have been) felled. Renderer independent: renderers read each
 * tree's state, the app turns the events into falling leaves.
 */
export const createFellingController = () => {
  const fellings = new Map<number, Felling>();
  let lastTime = 0;

  const fell = (id: number, time: number, fallYaw: number, rate = 1) => {
    if (fellings.has(id)) return false;
    fellings.set(id, rate === 1 ? { fallYaw, start: time } : { fallYaw, start: time, rate });
    return true;
  };

  const getState = (id: number, time: number) => {
    const felling = fellings.get(id);
    return felling ? getFellingState(fellingElapsed(felling, time), felling.fallYaw) : STANDING_TREE;
  };

  /** Events between the previous update and `time`. */
  const update = (time: number) => {
    const events: FellingEvent[] = [];
    for (const [id, felling] of fellings) {
      for (const [at, kind] of EVENT_TIMES) {
        const moment = felling.start + at / (felling.rate ?? 1);
        if (moment > lastTime && moment <= time) events.push({ id, kind });
      }
    }
    lastTime = time;
    return events;
  };

  const countStumps = (time: number) => {
    let stumps = 0;
    for (const felling of fellings.values()) stumps += fellingElapsed(felling, time) >= GONE ? 1 : 0;
    return stumps;
  };

  const saveState = () => ({ fellings: [...fellings], lastTime });
  const loadState = (saved: ReturnType<typeof saveState>) => {
    fellings.clear(); for (const [id, state] of saved.fellings) fellings.set(id,state);
    lastTime=saved.lastTime;
  };
  return {
    saveState, loadState,
    countStumps,
    fell,
    getState,
    getWorkProgress: (id: number, time: number) => {
      const felling = fellings.get(id);
      return felling ? getFellingWorkProgress(fellingElapsed(felling, time)) : undefined;
    },
    ids: () => fellings.keys(),
    remove: (id: number) => fellings.delete(id),
    reset: () => fellings.clear(),
    update
  };
};

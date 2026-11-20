import { smoothstep } from "../shared/world/noise";

/**
 * Death of a hunted animal, shared by the wildlife (deer, elk, rabbit) and the food critters
 * (wild boar, chamois): seconds of the fall, of lying still as a carcass, and of sinking /
 * fading out.
 */
export const DEATH_TIMING = { fade: 4, fall: 1.4, lie: 45 } as const;
/** Seconds from the kill until the carcass is gone. */
export const DEATH_END = DEATH_TIMING.fall + DEATH_TIMING.lie + DEATH_TIMING.fade;
/** The carcass lies on its right side: the roll at the end of the fall. */
const SIDE_ROLL = Math.PI / 2;

/** 0 .. 1 progress of the fall `seconds` after the kill. */
export const getDeathProgress = (seconds: number) => Math.min(1, seconds / DEATH_TIMING.fall);

/** 0 .. 1 of the final sinking / fading out. */
export const getCarcassFade = (seconds: number) => {
  const start = DEATH_TIMING.fall + DEATH_TIMING.lie;
  return smoothstep(start, start + DEATH_TIMING.fade, seconds);
};

/**
 * Phases of the fall (death progress 0 .. 1): it stumbles (the head drops), buckles (the legs
 * fold) and falls onto its side.
 */
export const getDeathPhases = (death: number) => ({
  buckle: smoothstep(0.15, 0.6, death),
  fall: smoothstep(0.45, 1, death),
  stumble: smoothstep(0, 0.35, death)
});

/** Roll of the fall onto the side (radians, towards the right side). */
export const getDeathRoll = (death: number) => smoothstep(0.45, 1, death) * SIDE_ROLL;

/** Carcass state of a pool (struct of arrays): 1 while the body is there, seconds since kill. */
export interface CarcassState {
  carcass: Uint8Array;
  deathTime: Float32Array;
}

/** Starts the death clock of `index`. */
export const startDeathClock = (state: CarcassState, index: number) => {
  state.carcass[index] = 1;
  state.deathTime[index] = 0;
};

/** Advances the death clock of `index` by `dt`; false once the carcass has faded out. */
export const stepDeathClock = (state: CarcassState, index: number, dt: number) => {
  state.deathTime[index]! += dt;
  if (state.deathTime[index]! < DEATH_END) return true;
  state.carcass[index] = 0;
  return false;
};

/** True while the body lies dead (fallen, before it fades): it can be harvested. */
export const isCarcass = (state: CarcassState, index: number) =>
  state.carcass[index] === 1 && state.deathTime[index]! >= DEATH_TIMING.fall;

/** Takes a lying carcass away at once (hunters, butchers); false when there is none. */
export const harvestCarcass = (state: CarcassState, index: number) => {
  if (!isCarcass(state, index)) return false;
  state.carcass[index] = 0;
  return true;
};

/** Hears of something happening at a point of the island (a kill, an animal breaking away). */
export type PointListener = (x: number, z: number) => void;

/**
 * Listeners of one kind of event at a point, shared by the wildlife and the critters: `listen`
 * subscribes (birds scatter), `emit` tells every listener.
 */
export const createPointEvent = () => {
  const listeners: PointListener[] = [];
  return {
    emit: (x: number, z: number) => {
      for (const listener of listeners) listener(x, z);
    },
    listen: (listener: PointListener) => {
      listeners.push(listener);
    }
  };
};

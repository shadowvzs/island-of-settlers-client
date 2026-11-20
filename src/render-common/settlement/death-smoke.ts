import { MILITARY_DEATH_SECONDS, type MilitaryDeathEffect } from "../../shared/settlement/military-combat-rules";
import { smoothstep } from "../../shared/world/noise";

/** The body falls in this long; the smoke is at full density by then and hides it. */
export const DEATH_FALL_SECONDS = .8;
/**
 * Each puff is drawn this share of its size nearer the camera than its centre: it veils the whole
 * body behind it, and never cuts off in a hard line where its lower half meets the ground.
 */
export const DEATH_SMOKE_DEPTH_BIAS = .6;

interface SmokeLayout {
  /** Puff centres along the body's heading (world units). */
  forward: readonly number[];
  /** Puff centres across the body: [to its right, above the ground]. */
  profile: readonly (readonly [number, number])[];
  /** Sprite size at full density. */
  scale: number;
}

/**
 * Puff lattices in the body's own frame. A foot soldier (1.06 tall) falls forward onto his face;
 * a rider (about 1.7 tall on a 1.9 long horse) goes down with the horse onto its right side. The
 * cloud covers the whole sweep of the fall, so the figure is hidden standing, falling and lying.
 * Minimal uses fewer, larger puffs over the same volume.
 */
const LAYOUTS = {
  cavalry: {
    detailed: {
      forward: [-.7, 0, .7], profile: [[0, .45], [0, 1.35], [.7, .95], [1.3, .35], [.6, .2]], scale: 1.75
    },
    minimal: { forward: [-.5, .5], profile: [[0, .55], [.2, 1.35], [1.1, .3]], scale: 2.5 }
  },
  foot: {
    detailed: { forward: [-.02, .45, .92], profile: [[0, .2], [0, .6], [0, 1]], scale: 1.1 },
    minimal: { forward: [.1, .8], profile: [[0, .3], [0, .9]], scale: 1.5 }
  }
} as const satisfies Record<string, Record<string, SmokeLayout>>;
const PEAK_OPACITY = .85;
/** How far the cloud lifts, and how much it swells, while it thins out. */
const RISE = 1.1;
const SWELL = .6;
/** Each puff drifts a little off its lattice point, so the cloud does not look like a grid. */
const JITTER = .08;

export type DeathSmokeBody = keyof typeof LAYOUTS;
export interface DeathSmokePuff { opacity: number; scale: number; x: number; y: number; z: number }
/** Where and how the unit died: `yaw` is its drawn heading (0 = +z), as the actors. */
export interface DeathSmokeSource {
  age: number; mounted?: boolean; x: number; y: number; yaw?: number; z: number;
}
/** A death as drawn: the simulation's effect plus the fallen figure's heading and mount. */
export interface MilitaryDeathFrame extends MilitaryDeathEffect, DeathSmokeSource {}

export const deathSmokeBody = (source: { mounted?: boolean }): DeathSmokeBody =>
  source.mounted ? "cavalry" : "foot";

const smokeLayout = (body: DeathSmokeBody, detailed: boolean): SmokeLayout =>
  LAYOUTS[body][detailed ? "detailed" : "minimal"];

export const deathSmokePuffCount = (body: DeathSmokeBody, detailed: boolean) => {
  const layout = smokeLayout(body, detailed);
  return layout.forward.length * layout.profile.length;
};

/** Opacity: builds up while the body falls, holds, then thins out as the cloud rises. */
const puffOpacity = (age: number) => PEAK_OPACITY * smoothstep(0, DEATH_FALL_SECONDS * .75, age) *
  (1 - smoothstep(DEATH_FALL_SECONDS + .4, MILITARY_DEATH_SECONDS, age));

/**
 * World position, size and opacity of puff `index` (see deathSmokePuffCount). After the fall the
 * cloud rises, swells and fades.
 */
export const deathSmokePuff = (
  source: DeathSmokeSource, index: number, detailed: boolean, seed = 0
): DeathSmokePuff => {
  const layout = smokeLayout(deathSmokeBody(source), detailed), age = source.age;
  const [side, up] = layout.profile[index % layout.profile.length]!;
  const forward = layout.forward[Math.floor(index / layout.profile.length)]!;
  const rise = smoothstep(DEATH_FALL_SECONDS, MILITARY_DEATH_SECONDS, age), drift = index * 2.39996 + seed;
  const along = forward + Math.cos(drift) * JITTER, across = side + Math.sin(drift) * JITTER;
  const yaw = source.yaw ?? 0, sin = Math.sin(yaw), cos = Math.cos(yaw);
  return {
    opacity: puffOpacity(age),
    scale: layout.scale * (.85 + .15 * smoothstep(0, DEATH_FALL_SECONDS, age) + SWELL * rise),
    x: source.x + sin * along + cos * across,
    y: source.y + up + rise * RISE,
    z: source.z + cos * along - sin * across
  };
};

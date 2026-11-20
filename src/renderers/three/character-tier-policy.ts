import type { CharacterLodLevel } from "@workers/character-lods/lod-policy";

import type { QualityPreset } from "../../render-common/quality";

export type CharacterTier = "A" | "B" | "C" | "D";

export interface CharacterTierInput {
  /** Projected on-screen height in device pixels, spyglass zoom included. */
  screenPixels: number;
  /** Ground contact/IK work is active. */
  contact: boolean;
  selected: boolean;
  threat: boolean;
  view: "fps" | "iso";
}

export type CharacterTierPolicy = QualityPreset["characters"];

export const characterTierPolicy = (quality: QualityPreset): CharacterTierPolicy => quality.characters;

/** Heroes, contact work, selection and threats stay full detail; everyone else follows projected size. */
export const classifyCharacterTier = (input: CharacterTierInput): CharacterTier => {
  if (input.contact || input.selected || input.threat || input.screenPixels >= 64) return "A";
  if (input.screenPixels >= 24) return "B";
  if (input.screenPixels >= 8) return "C";
  return "D";
};

/** LOD index for a tier: A/B use the full body, C/D step down; never finer than the preset allows. */
export const characterLodForTier = (tier: CharacterTier, policy: CharacterTierPolicy): CharacterLodLevel => {
  if (tier === "A") return policy.lodMax;
  if (tier === "B") return Math.max(1, policy.lodMax) as CharacterLodLevel;
  return Math.max(2, policy.lodMax) as CharacterLodLevel;
};

/**
 * Projected height (device pixels) from which each authored level is used, indexed by level:
 * LOD0 from 400 px, LOD1 from 120 px, LOD2 from 30 px and LOD3 below (C04 chain, research §3.3).
 * The projection already includes the spyglass zoom, so a worker seen through it keeps full detail.
 */
export const CHARACTER_LOD_PIXELS: readonly [number, number, number] = [400, 120, 30];
/** Share of a band edge that must be crossed before a level changes again (no flicker). */
export const CHARACTER_LOD_HYSTERESIS = 0.15;
/**
 * Late LOD3 switch for bodies whose authored LOD3 is noticeably coarse: they keep LOD2 until the
 * projected height is below this edge (the default is 30 px). The 890-triangle LOD3 mean is
 * unchanged; only the two body families below use it.
 */
export const CHARACTER_LOD3_LATE_PIXELS = 18;
/** A level survives this long before the next change (presentation seconds). */
export const CHARACTER_LOD_HOLD_SECONDS = 0.3;
/** Below this projected height a character only plays its base clip and may join the GPU crowd (D-C4). */
export const CHARACTER_CROWD_PIXELS = 30;

/**
 * Readable shadows at strategy zoom (owner 2026-11-07): a figure's shadow-map silhouette is only
 * a few pixels wide at iso zoom 1 and is lost in the grass texture. While it casts, a small figure
 * is drawn wider across its body (local x and z, height unchanged) into the shadow map only: up to
 * SHADOW_WIDENING_MAX below SHADOW_WIDENING_FULL_PIXELS, easing back to its true width at
 * SHADOW_WIDENING_NONE_PIXELS (iso close and nearer keep the true silhouette).
 */
export const SHADOW_WIDENING_MAX = 2;
export const SHADOW_WIDENING_FULL_PIXELS = 50;
export const SHADOW_WIDENING_NONE_PIXELS = 120;

/** Horizontal scale of a casting figure in the shadow pass for its projected height. */
export const characterShadowWidening = (pixels: number) => {
  const span = SHADOW_WIDENING_NONE_PIXELS - SHADOW_WIDENING_FULL_PIXELS;
  const share = Math.min(1, Math.max(0, (SHADOW_WIDENING_NONE_PIXELS - pixels) / span));
  return 1 + (SHADOW_WIDENING_MAX - 1) * share;
};

/** Authored level a character draws into the sun shadow map (cheap proxy, R02/C07). */
export const CHARACTER_SHADOW_PROXY_LOD: CharacterLodLevel = 2;

const COARSEST: CharacterLodLevel = 3;

/** The level whose band contains `pixels`, without hysteresis, never finer than `policy.lodMax`. */
export const characterLodForPixels = (pixels: number, policy: CharacterTierPolicy): CharacterLodLevel => {
  let level: CharacterLodLevel = COARSEST;
  for (let candidate = 0; candidate < CHARACTER_LOD_PIXELS.length; candidate++) {
    if (pixels >= CHARACTER_LOD_PIXELS[candidate]!) { level = candidate as CharacterLodLevel; break; }
  }
  return Math.max(level, policy.lodMax) as CharacterLodLevel;
};

/**
 * The next level for a character currently at `current`: it moves one step finer only once the
 * projected height passes the finer band's edge by the hysteresis share, and one step coarser only
 * once it falls that share below its own band's edge. Repeats until stable, so a jump (spyglass,
 * teleport, first frame) settles in one call. `lodMax` is the effective finest level: the preset
 * cap and the player's Character detail choice (C12), or the body's loaded base when coarser.
 */
export const nextCharacterLod = (
  current: CharacterLodLevel,
  pixels: number,
  policy: CharacterTierPolicy,
  lod3Pixels = CHARACTER_LOD_PIXELS[2],
  lodMax: CharacterLodLevel = policy.lodMax
): CharacterLodLevel => {
  let level = Math.max(current, lodMax) as CharacterLodLevel;
  for (let step = 0; step <= COARSEST; step++) {
    const finerEdge = level > lodMax
      ? (level === 3 ? lod3Pixels : CHARACTER_LOD_PIXELS[(level - 1) as 0 | 1 | 2]) *
        (1 + CHARACTER_LOD_HYSTERESIS) : Infinity;
    const coarserEdge = level < COARSEST
      ? (level === 2 ? lod3Pixels : CHARACTER_LOD_PIXELS[level as 0 | 1 | 2]) *
        (1 - CHARACTER_LOD_HYSTERESIS) : -Infinity;
    if (pixels >= finerEdge) level = (level - 1) as CharacterLodLevel;
    else if (pixels < coarserEdge) level = (level + 1) as CharacterLodLevel;
    else break;
  }
  return level;
};

/**
 * Whether a character of `pixels` projected height may cast a sun shadow under `policy`; the per
 * frame caster count is the crowd's job.
 */
export const characterCastsShadow = (pixels: number, policy: CharacterTierPolicy) =>
  policy.shadowCastPixels !== null && policy.shadowCasters > 0 && pixels >= policy.shadowCastPixels;

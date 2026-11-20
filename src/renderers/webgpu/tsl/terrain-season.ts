import { dot, float, fract, max, min, mix, smoothstep, step, texture, vec2, vec3, vec4 } from "three/tsl";
import type { Texture } from "three/webgpu";

import {
  SEASON_MUD_TUNING, SEASON_SNOW_TUNING, SEASON_STONE_SNOW, SEASON_TUFT_SNOW
} from "../../../render-common/shaders/season-ground-glsl";
import { SNOW_NOON_ROLL_OFF } from "../../../render-common/snow-palette";
import { bindTexture, bindVector, type UniformBindings } from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * `getSeasonMud` (season-ground-glsl.ts): fuller swamp/bank mud and wet dirt patches in the monsoon; `noise` is
 * getVariantNoise(xz * 0.3 + 41).
 */
export const getTslSeasonMud = (mud: TslNode, dirt: TslNode, desert: TslNode, noise: TslNode, cover: TslNode) => {
  const patches = smoothstep(SEASON_MUD_TUNING.patch[0], SEASON_MUD_TUNING.patch[1], noise) as TslNode;
  const wet = dirt.mul(cover.y).mul(SEASON_MUD_TUNING.dirt).mul(patches).mul(float(1).sub(desert)) as TslNode;
  return max(mud.mul(cover.y.mul(SEASON_MUD_TUNING.bankGain).add(1)), wet) as TslNode;
};

/** `getSeasonWetness`: damp season ground below the film threshold (not in the desert). */
export const getTslSeasonWetness = (bank: TslNode, desert: TslNode, cover: TslNode) =>
  max(bank.mul(cover.y.mul(0.6).add(1)), cover.x.mul(float(1).sub(desert))) as TslNode;

/** The leaf litter mask gain under the broadleaf crowns (uSeasonLitter.a). */
export const getTslSeasonLeafLitter = (leaf: TslNode, litter: TslNode) =>
  min(leaf.mul(litter.w.add(1)), 1) as TslNode;

/** The tufts' season meadow tint (tips first), like the GLSL prop vertex; a material without it stays summer. */
export const getTslSeasonTuftTint = (bindings: UniformBindings, height: TslNode) => {
  if (!bindings.source.uSeasonMeadow) return vec3(1) as TslNode;
  const meadow = bindVector(bindings, "uSeasonMeadow", 4) as TslNode;
  return meadow.xyz.mul(mix(0.6, 1, smoothstep(0.02, 0.3, height))).add(1) as TslNode;
};

type NoiseNode = (point: TslNode) => TslNode;

/**
 * `getSeasonSnowCover` (SEASON_SNOW_GLSL): the season's cover ramp (cover.w) reaches a spot in the melt order of its
 * snow keep, broken by a noise (the GLSL early-outs at 0 and 1 give the same values).
 */
export const getTslSeasonSnowCover = (xz: TslNode, keep: TslNode, cover: TslNode, valueNoise: NoiseNode) => {
  const { band, noiseScale, orderNoise } = SEASON_SNOW_TUNING;
  const order = mix(float(1).sub(keep), valueNoise(xz.mul(noiseScale)), orderNoise) as TslNode;
  const start = order.mul(1 - band) as TslNode;
  return smoothstep(start, start.add(band), cover.w) as TslNode;
};

/**
 * SEASON_SNOW_TUFT_GLSL (seasons-5 port): under the global snow about a third of the field-cover tufts stays and greys
 * towards the snow. Returns the tuft keep and its snow tint for a tuft root and phase.
 */
export const createTslSeasonTuftSnow = (bindings: UniformBindings, valueNoise: NoiseNode) => {
  const snowMap = bindTexture(bindings, "uSnowMap");
  const cover = bindVector(bindings, "uSeasonCover", 4) as TslNode;
  return (root: TslNode, phase: TslNode) => {
    const keep = snowMap.sample(root.add(0.5).div(vec2(snowMap.size(0)))).g as TslNode;
    const snow = getTslSeasonSnowCover(root, keep, cover, valueNoise).mul(keep) as TslNode;
    const kept = step(snow.mul(SEASON_TUFT_SNOW.thinning), fract(phase.mul(0.618034).add(0.29))) as TslNode;
    const tint = (color: TslNode) => {
      const snowy = vec3(dot(color, vec3(0.3, 0.59, 0.11))).mul(vec3(...SEASON_TUFT_SNOW.cool));
      return mix(color, snowy, snow.mul(SEASON_TUFT_SNOW.grey)) as TslNode;
    };
    return { keep: kept, tint };
  };
};

interface SeasonSnowSplats {
  a: TslNode;
  apron: TslNode;
  b: TslNode;
  c: TslNode;
}

/** `getSeasonStoneHold`: rock and mine ground hold the season's snow on ledges and gentle slopes only. */
const getTslSeasonStoneHold = (normal: TslNode) =>
  smoothstep(SEASON_STONE_SNOW.hold[0], SEASON_STONE_SNOW.hold[1], normal.y) as TslNode;

/**
 * `coverSeasonSnow` (season-ground-glsl.ts, T1): the global season's snow cover moves the exposed loose ground, and
 * rock and mine ground where the slope holds it (seasons-5), to the snow layer in the melt order. The TSL terrain has
 * no keep redistribution, so the keep scales the cover here.
 */
export const coverTslSeasonSnow = (splats: SeasonSnowSplats, xz: TslNode, waterDepth: TslNode, normal: TslNode,
  cover: TslNode, snowMap: Texture | undefined, valueNoise: NoiseNode) => {
  const { a, apron, b, c } = splats;
  const snowNode = snowMap ? texture(snowMap) as TslNode : null;
  const keep = (snowNode ? snowNode.sample(xz.add(0.5).div(vec2(snowNode.size(0)))).g : float(1)) as TslNode;
  const exposed = float(1).sub(smoothstep(0.005, 0.025, waterDepth)) as TslNode;
  const share = getTslSeasonSnowCover(xz, keep, cover, valueNoise).mul(keep).mul(exposed) as TslNode;
  const stone = share.mul(getTslSeasonStoneHold(normal)).mul(SEASON_STONE_SNOW.stoneCover) as TslNode;
  const rockMoved = b.y.mul(stone) as TslNode;
  const mineMoved = c.x.mul(stone).mul(mix(SEASON_STONE_SNOW.mineLoad, 1, apron)) as TslNode;
  const moved = dot(a, vec4(share)).add(b.x.add(b.w).mul(share)).add(rockMoved).add(mineMoved) as TslNode;
  const bare = float(1).sub(share) as TslNode;
  return {
    a: a.mul(bare) as TslNode,
    b: vec4(b.x.mul(bare), b.y.sub(rockMoved), b.z.add(moved), b.w.mul(bare)) as TslNode,
    c: vec4(c.x.sub(mineMoved), c.y, c.z, c.w) as TslNode
  };
};

/**
 * GLSL `rollOffGroundHighlights` (D-W4): under a high sun the lit lowland snow is compressed above a knee
 * toward a ceiling (luminance, hue kept); `weight` is snow share x (1 - summit) x (1 - possession).
 */
export const rollOffTslNoonSnow = (color: TslNode, weight: TslNode, sunHeight: TslNode) => {
  const { ceiling, knee, sunFull, sunStart } = SNOW_NOON_ROLL_OFF;
  const share = weight.mul(smoothstep(sunStart, sunFull, sunHeight)) as TslNode;
  const luma = dot(color, vec3(0.2126, 0.7152, 0.0722)) as TslNode;
  const excess = max(luma.sub(knee), 0) as TslNode;
  const rolled = excess.div(excess.div(ceiling - knee).add(1)).add(knee) as TslNode;
  const scale = luma.greaterThan(knee).select(rolled.div(max(luma, 1e-4)), float(1)) as TslNode;
  return color.mul(mix(1, scale, share)) as TslNode;
};

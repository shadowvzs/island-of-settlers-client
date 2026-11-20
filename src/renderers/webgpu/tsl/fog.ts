import { dot, float, Fn, If, max, mix, normalize, smoothstep, texture, vec2, vec3 } from "three/tsl";
import type { Texture } from "three/webgpu";

import {
  FOG_CLEAR_VISIBILITY,
  FOG_VISIBILITY_FADE_END,
  FOG_VISIBILITY_FADE_START
} from "../../../render-common/atmosphere/fog-visibility";
import { NOISE_LATTICE } from "../../../render-common/noise-textures";
import { FAR_SEA_HAZE, FOG_COVER, MAP_EDGE_CELLS } from "../../../render-common/shaders/common-glsl";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * TSL twin of the fog pieces in `common-glsl.ts`: the visibility band, the drifting cover and
 * the map-edge fade. Atmosphere/live-fog sampling is injected (or omitted in the reference
 * tables); the material port binds it once, in linear light.
 */
export interface FogNodeOptions {
  fbm3: (point: TslNode) => TslNode;
  noiseTexture: Texture;
  /** Optional `sampleLiveFog(visibility, xz)`; absent keeps the passed visibility. */
  liveFog?: (visibility: TslNode, xz: TslNode) => TslNode;
}


export const createFogNodes = ({ fbm3, liveFog, noiseTexture }: FogNodeOptions) => {
  // The Texture itself, not a clone of a uv-less node (per-object uv-matrix refresh, see noise.ts).
  const textureAt = (point: TslNode): TslNode =>
    texture(noiseTexture, point.div(NOISE_LATTICE), 0) as unknown as TslNode;

  const fogVisibilityFade = Fn(([visibility]: [TslNode]) =>
    smoothstep(FOG_VISIBILITY_FADE_START, FOG_VISIBILITY_FADE_END, visibility));

  const fogCoverPuffs = Fn(([xz, time]: [TslNode, TslNode]) => {
    const point = xz.mul(0.05).sub(vec2(time.mul(0.025), 0));
    return textureAt(point).r.mul(0.5)
      .add(textureAt(point.mul(2.03).add(17.1)).g.mul(0.3))
      .add(textureAt(point.mul(4.01).add(3.7)).b.mul(0.2));
  });

  const fogCoverRelief = Fn(([xz, time]: [TslNode, TslNode]) => {
    const point = xz.mul(0.05).sub(vec2(time.mul(0.025), 0));
    return textureAt(point).r.mul(0.5)
      .add(textureAt(point.mul(2.03).add(17.1)).g.mul(0.3)).div(0.8);
  });

  const fogCoverColor = Fn(([puffs, fogColor]: [TslNode, TslNode]) =>
    mix(fogColor.mul(0.62), fogColor.mul(1.12), smoothstep(0.25, 0.8, puffs)));

  const litFogCover = Fn(([puffs, xz, time, viewDirection, sunDirection, sunColor, rain, fogColor]:
  [TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode]) => {
    const toEye: TslNode = normalize(viewDirection);
    const top = xz.add(toEye.xz.div(max(toEye.y, 0.35)).mul(float(FOG_COVER.relief).mul(puffs)));
    const relief = fogCoverRelief(top, time);
    const east = fogCoverRelief(top.add(vec2(FOG_COVER.step, 0)), time);
    const south = fogCoverRelief(top.add(vec2(0, FOG_COVER.step)), time);
    const normal = normalize(vec3(
      relief.sub(east).mul(FOG_COVER.slope),
      1,
      relief.sub(south).mul(FOG_COVER.slope)
    ));
    const light: TslNode = normalize(sunDirection);
    const towardLight = fogCoverRelief(
      top.add(normalize(light.xz.add(vec2(1e-4))).mul(FOG_COVER.shadowStep)), time);
    const shadow = float(1).sub(smoothstep(0.02, 0.12, towardLight.sub(relief)).mul(0.3));
    const diffuse = dot(normal, light).add(0.4).div(1.4).clamp(0, 1).mul(shadow);
    const hollow = mix(0.92, 1.06, smoothstep(0.3, 0.75, relief));
    const lightHue = sunColor.div(max(max(sunColor.r, sunColor.g), sunColor.b).max(0.05));
    const sunlit = mix(vec3(1), lightHue, FOG_COVER.tint).mul(FOG_COVER.sun);
    const level = vec3(FOG_COVER.ambient).add(sunlit.mul(
      light.y.add(0.4).div(1.4).clamp(0, 1)));
    const shade = vec3(FOG_COVER.gain).mul(vec3(FOG_COVER.ambient).add(sunlit.mul(diffuse)))
      .div(level);
    return fogCoverColor(fogCoverPuffs(top, time), fogColor)
      .mul(mix(vec3(1), hollow.mul(shade), float(1).sub(rain.mul(0.6))));
  });

  /**
   * GLSL early-outs: exploration fog >= 1 and clear visibility return the colour untouched, and
   * only hidden pixels with the lit style pay for the lit relief (11 explicit-LOD fetches).
   */
  const applyFogClouds = Fn(([color, visibility, xz, time, explorationFog, fogOfWarLit,
    fogColor, rain, viewDirection, sunDirection, sunColor]:
  [TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode,
    TslNode, TslNode, TslNode]) => {
    const result = color.toVar();
    If(explorationFog.lessThan(1), () => {
      const sampled = liveFog ? liveFog(visibility, xz) : visibility;
      If(sampled.lessThan(FOG_CLEAR_VISIBILITY), () => {
        const grey = dot(color, vec3(0.3, 0.59, 0.11));
        const discovered = float(1).sub(smoothstep(0.55, FOG_CLEAR_VISIBILITY, sampled));
        const desaturated = mix(color, vec3(grey).mul(0.82).add(vec3(0.02, 0.03, 0.06)),
          discovered.mul(0.5));
        const drift = fbm3(xz.mul(0.09).add(vec2(time.mul(0.04), time.mul(0.015)))).sub(0.5);
        const hidden = float(1).sub(fogVisibilityFade(sampled.add(drift.mul(0.35)))).toVar();
        const puffs = fbm3(xz.mul(0.05).sub(vec2(time.mul(0.025), 0))).toVar();
        const cloud = fogCoverColor(puffs, fogColor).toVar();
        If(fogOfWarLit.greaterThan(0.5).and(hidden.greaterThan(0.004)), () => {
          cloud.assign(litFogCover(puffs, xz, time, viewDirection, sunDirection, sunColor, rain,
            fogColor));
        });
        result.assign(mix(mix(desaturated, cloud, hidden.mul(0.96)), color, explorationFog));
      });
    });
    return result;
  });

  const getMapInterior = Fn(([xz, worldSize]: [TslNode, TslNode]) => {
    const inside = xz.min(worldSize.sub(xz));
    const interior = smoothstep(0, MAP_EDGE_CELLS, inside.x.min(inside.y));
    return worldSize.x.lessThanEqual(0).select(1, interior);
  });

  const applyMapEdge = Fn(([color, xz, worldSize]: [TslNode, TslNode, TslNode]) => {
    const beyond: TslNode = max(xz.negate(), xz.sub(worldSize));
    const outside = max(max(beyond.x, beyond.y), 0);
    const bordered = color.mul(mix(0.72, 1, getMapInterior(xz, worldSize)));
    const edged = mix(bordered, vec3(FAR_SEA_HAZE[0], FAR_SEA_HAZE[1], FAR_SEA_HAZE[2]), smoothstep(4, 60, outside).mul(0.85));
    // GLSL `if (uWorldSize.x <= 0.0) return color;`: scenes without a map keep the colour.
    return worldSize.x.lessThanEqual(0).select(color, edged);
  });

  const applyFogOfWar = Fn(([color, visibility, xz, worldSize, time, explorationFog, fogOfWarLit,
    fogColor, rain, viewDirection, sunDirection, sunColor]:
  [TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode,
    TslNode, TslNode, TslNode]) =>
    applyMapEdge(applyFogClouds(color, visibility, xz, time, explorationFog, fogOfWarLit,
      fogColor, rain, viewDirection, sunDirection, sunColor), xz, worldSize));

  return { applyFogClouds, applyFogOfWar, applyMapEdge, fogCoverColor, fogCoverPuffs,
    fogCoverRelief, fogVisibilityFade, getMapInterior, litFogCover };
};

import {
  abs,
  dot,
  float,
  floor,
  fract,
  If,
  int,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  vec2,
  vec3
} from "three/tsl";
import type { Texture } from "three/webgpu";

import { ORE_CODES, ROCK_STONE_DETAIL_SCALE } from "../../../render-common/shaders/rock-tuning";
import { getRockUv, type RockUv, sampleRockTriplanar } from "./rock-uv";

/**
 * TSL twin of the close-up detail of `rock-glsl.ts` / `rock-detail`: fine grain, runoff, ore
 * stones, the mountain's second octave, the detail normals and the stone-material deposit
 * patterns. The material only binds these where the fragment asks for them.
 */
type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;

export interface RockZones {
  clean: TslNode;
  loose: TslNode;
  weathered: TslNode;
}

/** GLSL smoothstep with descending edges, safe on WGSL where the builtin is undefined. */
const smoothstepDescending = (high: number, low: number, value: TslNode): TslNode =>
  float(1).sub(smoothstep(low, high, value));

/** Two octaves of low-contrast grain and sparse light specks from value noise in the planes. */
const sampleFineNoise = (uv: RockUv, scale: number, valueNoise: NoiseNode): TslNode =>
  valueNoise(uv.x.mul(scale)).mul(uv.weights.x)
    .add(valueNoise(uv.y.mul(scale)).mul(uv.weights.y))
    .add(valueNoise(uv.z.mul(scale)).mul(uv.weights.z));

/**
 * Fine stone grain close up: fades out once a pixel covers more than a few centimetres, so it
 * never shimmers at gameplay distance. `footprint` is `length(fwidth(world))` (passed in so the
 * kernel stays parity-testable).
 */
export const getFineGrain = (uv: RockUv, loose: TslNode, footprint: TslNode,
  valueNoise: NoiseNode): TslNode => {
  const fade = float(1).sub(smoothstep(0.015, 0.06, footprint));
  const grain = sampleFineNoise(uv, 38, valueNoise).mul(0.6)
    .add(sampleFineNoise(uv, 97, valueNoise).mul(0.4)).sub(0.5);
  const speck = smoothstep(0.78, 0.95, sampleFineNoise(uv, 160, valueNoise));
  const detail = grain.mul(0.2).add(speck.mul(0.04));
  const result = float(1).add(detail.mul(fade).mul(float(1).sub(loose.mul(0.6))));
  return fade.lessThanEqual(0).select(float(1), result);
};

/** Water runoff: dark vertical streaks on steep faces, broken along their length. */
export const getRunoff = (world: TslNode, normal: TslNode, valueNoise: NoiseNode): TslNode => {
  const across = normalize(vec2(normal.z.negate(), normal.x).add(vec2(0.0001, 0)));
  const streak = valueNoise(vec2(dot(world.xz, across).mul(3.2), world.y.mul(0.14)));
  const broken = valueNoise(vec2(dot(world.xz, across).mul(0.6), world.y.mul(0.5)));
  const steep = float(1).sub(smoothstep(0.35, 0.7, abs(normal.y)));
  return smoothstep(0.6, 0.85, streak).mul(smoothstep(0.25, 0.6, broken)).mul(steep);
};

/**
 * Close-up surface detail of standalone stones: a finer octave of the same packed texture gives
 * mottled tone, mineral speckle, small pits and hairline cracks; lighter weathered tops, darker
 * crevices, pale lichen and moss patches on the shaded and upper sides.
 */
export const applyStoneDetail = (albedo: TslNode, world: TslNode, normal: TslNode,
  breakup: TslNode, valueNoise: NoiseNode, rockTexture: Texture): TslNode => {
  const fineUv = getRockUv(world.mul(ROCK_STONE_DETAIL_SCALE), normal);
  const fine = sampleRockTriplanar(rockTexture, fineUv);
  const mottle = valueNoise(world.xz.mul(0.9).add(world.y.mul(0.7)).add(3.1));
  let stone = albedo.mul(mix(0.86, 1.12, mottle)).mul(float(0.8).add(fine.r.mul(0.45)));
  const speckLight = smoothstep(0.66, 0.82, fine.g);
  const speckDark = smoothstepDescending(0.34, 0.2, fine.b);
  stone = mix(stone, stone.mul(1.25).add(0.04), speckLight.mul(0.35));
  stone = stone.mul(float(1).sub(speckDark.mul(0.18)).sub(fine.a.mul(0.45)));
  stone = mix(stone, stone.mul(1.12).add(0.03),
    smoothstep(0.35, 0.9, normal.y).mul(0.5));
  const lichenNoise = valueNoise(world.xz.mul(3.3).add(world.y.mul(2.1)));
  const lichen = smoothstep(0.74, 0.82, lichenNoise.add(breakup.mul(0.2)))
    .mul(smoothstep(0, 0.6, normal.y));
  stone = mix(stone, stone.mul(vec3(1.08, 1.06, 0.96)).add(0.03), lichen.mul(0.35));
  const mossSide = smoothstepDescending(0.1, -0.7, normal.z).mul(0.6)
    .add(smoothstep(0.5, 0.95, normal.y).mul(0.4));
  const moss = smoothstep(0.55, 0.75, valueNoise(world.xz.mul(1.7).add(8.3))
    .add(breakup.mul(0.3))).mul(mossSide);
  return mix(stone, stone.mul(vec3(0.82, 0.9, 0.74)), moss.mul(0.4));
};

/** Broken mineral faces and fine joints on the massifs, readable beneath broad strata. */
export const applyMountainDetail = (albedo: TslNode, world: TslNode, normal: TslNode,
  zones: RockZones, breakup: TslNode, rockTexture: Texture): TslNode => {
  const uv = getRockUv(world.mul(2.35).add(vec3(11.7, 3.1, -8.4)), normal);
  const detail = sampleRockTriplanar(rockTexture, uv);
  const exposed = float(1).sub(zones.loose.mul(0.8));
  const mineral = detail.r.mul(0.65).add(detail.g.mul(0.35));
  let color = albedo.mul(float(0.72).add(mineral.mul(0.56)));
  color = color.mul(float(1).sub(detail.a.mul(0.22).mul(exposed)));
  const patina = mix(vec3(0.96, 0.98, 1.01), vec3(1.03, 1.0, 0.96),
    smoothstep(-0.2, 0.2, breakup));
  return mix(albedo, color.mul(patina), exposed.mul(0.8));
};

/** One branch of `applyOreStone`: coal seams, iron rust, gold quartz or granite flecks. */
const createOreStone = (fbm3: NoiseNode, time: TslNode) => (albedo: TslNode, world: TslNode,
  ore: TslNode): TslNode => {
  const result = albedo.toVar();
  If(ore.equal(int(ORE_CODES.coal)), () => {
    const grain = fbm3(world.xz.mul(2.4).add(world.y.mul(1.7)));
    const seam = abs(sin(world.y.mul(11).add(world.x.mul(2)).add(grain.mul(7))));
    result.assign(mix(albedo.mul(0.8), vec3(0.08, 0.075, 0.07),
      smoothstepDescending(0.45, 0.15, seam)));
  }).ElseIf(ore.equal(int(ORE_CODES.iron)), () => {
    const grain = fbm3(world.xz.mul(2.4).add(world.y.mul(1.7)));
    const luma = dot(albedo, vec3(0.3, 0.59, 0.11));
    const rust = smoothstep(0.52, 0.7,
      grain.add(float(0.5).sub(fract(world.y.mul(0.9))).mul(0.08)));
    result.assign(mix(albedo, vec3(0.47, 0.26, 0.15).mul(float(0.75).add(luma)),
      rust.mul(0.6)));
  }).ElseIf(ore.equal(int(ORE_CODES.gold)), () => {
    const grain = fbm3(world.xz.mul(2.4).add(world.y.mul(1.7)));
    const vein = abs(sin(world.x.mul(6).sub(world.z.mul(4.5)).add(world.y.mul(3))
      .add(grain.mul(8))));
    const quartz = mix(albedo, vec3(0.86, 0.84, 0.78), smoothstepDescending(0.22, 0.06, vein));
    const speck = fract(sin(dot(floor(world.mul(26)) as TslNode,
      vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    const flash = float(0.6).add(sin(time.mul(3).add(speck.mul(40))).mul(0.4));
    result.assign(mix(quartz, vec3(1, 0.78, 0.25).mul(float(1).add(flash)),
      step(0.92, speck).mul(step(vein, 0.3))));
  }).ElseIf(ore.equal(int(ORE_CODES.granite)), () => {
    const luma = dot(albedo, vec3(0.3, 0.59, 0.11));
    const fleck = fract(sin(dot(floor(world.mul(34)) as TslNode,
      vec3(39.3, 11.7, 83.1))).mul(43758.5453));
    let flecked = vec3(0.8, 0.78, 0.75).mul(float(0.85).add(luma.mul(0.3)));
    flecked = fleck.greaterThan(0.84).select(vec3(0.7, 0.55, 0.5), flecked);
    flecked = fleck.greaterThan(0.9).select(vec3(0.14, 0.14, 0.15), flecked);
    result.assign(mix(albedo, flecked, 0.8));
  });
  return result;
};

/**
 * Ore stones on a surveyed mine field: coal in black seams, iron in rust patches, gold as quartz
 * veins with glinting specks, granite pale and speckled.
 */
export const applyOreStone = (albedo: TslNode, world: TslNode, ore: TslNode, time: TslNode,
  fbm3: NoiseNode): TslNode => createOreStone(fbm3, time)(albedo, world, ore);

/**
 * Bends the vertex normal by the three projected detail slopes (whiteout style blend), weakly
 * and only close up: the rock reads as smooth, softly rounded stone.
 */
export const getRockDetailNormal = (normal: TslNode, uv: RockUv, zones: RockZones,
  fade: TslNode, rockNormal: Texture): TslNode => {
  const decode = (sample: TslNode) => sample.mul(2).sub(1);
  const slopesX = decode(texture(rockNormal, uv.x));
  const slopesY = decode(texture(rockNormal, uv.y));
  const slopesZ = decode(texture(rockNormal, uv.z));
  const nx: TslNode = mix(slopesX.xy, slopesX.zw, zones.loose);
  const ny: TslNode = mix(slopesY.xy, slopesY.zw, zones.loose);
  const nz: TslNode = mix(slopesZ.xy, slopesZ.zw, zones.loose);
  const detail = vec3(0, nx.y, nx.x).mul(uv.weights.x)
    .add(vec3(ny.x, 0, ny.y).mul(uv.weights.y))
    .add(vec3(nz.x, nz.y, 0).mul(uv.weights.z));
  const strength = zones.clean.mul(0.3).add(zones.weathered.mul(0.34)).add(zones.loose.mul(0.2));
  return normalize(normal.add(detail.mul(strength).mul(fade)));
};

/** Subtle fine detail normal on standalone stones close up (the shading stays smooth). */
export const applyStoneDetailNormal = (normal: TslNode, world: TslNode, surfaceNormal: TslNode,
  detailed: TslNode, fade: TslNode, rockNormal: Texture): TslNode => {
  const result = surfaceNormal.toVar();
  If(detailed.greaterThan(0.5).and(fade.greaterThan(0)), () => {
    const uv = getRockUv(world.mul(ROCK_STONE_DETAIL_SCALE), normal);
    const decode = (sample: TslNode) => sample.mul(2).sub(1);
    const slopesX = decode(texture(rockNormal, uv.x));
    const slopesY = decode(texture(rockNormal, uv.y));
    const slopesZ = decode(texture(rockNormal, uv.z));
    const detail = vec3(0, slopesX.y, slopesX.x).mul(uv.weights.x)
      .add(vec3(slopesY.x, 0, slopesY.y).mul(uv.weights.y))
      .add(vec3(slopesZ.x, slopesZ.y, 0).mul(uv.weights.z));
    result.assign(normalize(result.add(detail.mul(0.2).mul(fade))));
  });
  return result;
};

export interface RockNoise {
  /** x breakup, y strata gaps, z snow patches, w growth patches. */
  meso: TslNode;
  region: TslNode;
  /** x turn, y strata warp, z zones. */
  regional: TslNode;
}

/** Noise shared by the rock layers: regional (x turn, y strata warp, z zones), meso breakup. */
export const getRockNoise = (world: TslNode, valueNoise4: NoiseNode,
  fbm3: NoiseNode): RockNoise => ({
  meso: valueNoise4(world.xz.mul(0.6).add(world.y.mul(0.45))),
  region: fbm3(world.xz.mul(0.02).add(world.y.mul(0.03))),
  regional: valueNoise4(world.xz.mul(0.035).add(world.y.mul(0.02)).add(2.7))
});

export type StoneFamily = "basalt" | "granite" | "limestone" | "marble";

/**
 * World-space mineral structure of the stone-material deposits, appended after the flat material
 * tint: cool veins in marble, pale and dark speckles in granite, warm horizontal bedding in
 * limestone and faint blue-grey fractures in basalt. The patterns fade out with the pixel
 * footprint. `footprint` is `length(fwidth(world))`.
 */
export const createDepositDetailNodes = (valueNoise: NoiseNode, valueNoise4: NoiseNode) => {
  const basalt = (albedo: TslNode, world: TslNode, footprint: TslNode): TslNode => {
    const fade = float(1).sub(smoothstep(0.02, 0.085, footprint));
    const crack = pow(float(0.5).add(sin(world.x.mul(8).add(world.z.mul(6.3))
      .add(sin(world.y.mul(5.1)))).mul(0.5)), 28);
    return mix(albedo, albedo.mul(vec3(0.9, 0.95, 1.06)), crack.mul(0.35).mul(fade));
  };
  const granite = (albedo: TslNode, world: TslNode, footprint: TslNode): TslNode => {
    const fade = float(1).sub(smoothstep(0.012, 0.05, footprint));
    const grains = valueNoise4(world.xz.mul(17).add(world.y.mul(11)));
    const mica = smoothstep(0.72, 0.92, grains.r);
    const feldspar = smoothstep(0.76, 0.95, grains.g);
    let stone = mix(albedo, albedo.mul(vec3(0.58, 0.63, 0.72)), mica.mul(0.55).mul(fade));
    stone = mix(stone, albedo.mul(vec3(1.16, 0.95, 0.9)), feldspar.mul(0.4).mul(fade));
    const tone = valueNoise(world.xz.mul(3.7).add(world.y.mul(2.9)));
    return stone.mul(float(1).add(tone.sub(0.5).mul(0.09).mul(fade)));
  };
  const limestone = (albedo: TslNode, world: TslNode, footprint: TslNode): TslNode => {
    const fade = float(1).sub(smoothstep(0.02, 0.085, footprint));
    const beddingNoise = valueNoise(world.xz.mul(2.1).add(world.y.mul(1.5)));
    const bedding = float(0.5).add(sin(world.y.mul(30).add(beddingNoise.mul(3.2))).mul(0.5));
    const beds = smoothstep(0.72, 0.97, bedding);
    let stone = albedo.mul(mix(vec3(1), vec3(0.78, 0.68, 0.5), beds.mul(0.22).mul(fade)));
    const tone = valueNoise(world.xz.mul(9).add(world.y.mul(6)));
    return stone.mul(float(1).add(tone.sub(0.5).mul(0.07).mul(fade)));
  };
  const marble = (albedo: TslNode, world: TslNode, footprint: TslNode): TslNode => {
    const fade = float(1).sub(smoothstep(0.02, 0.08, footprint));
    const band = sin(world.x.mul(4.1).add(world.z.mul(3.3))
      .add(sin(world.y.mul(3.1)).mul(1.4)));
    const thread = sin(world.x.mul(9.7).sub(world.z.mul(7.3)).add(world.y.mul(3.9)));
    const vein = smoothstep(0.9, 0.995, band.mul(0.65).add(thread.mul(0.35)));
    const stone = mix(albedo, albedo.mul(vec3(0.72, 0.78, 0.87)), vein.mul(0.6).mul(fade));
    const tone = valueNoise(world.xz.mul(5).add(world.y.mul(3.5)));
    return stone.mul(float(1).add(tone.sub(0.5).mul(0.06).mul(fade)));
  };
  return { basalt, granite, limestone, marble } as const;
};

import type { IUniform } from "three";
import {
  abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, dot, faceDirection,
  float, floor, Fn, fract, int, ivec2, length, max, mix, normalize, pow, sin, smoothstep,
  texture, textureLoad, uint, uniform, uvec3, varying, vec2, vec3, vec4
} from "three/tsl";
import { DoubleSide, type Material, NodeMaterial, type Texture, Vector2 } from "three/webgpu";

import {
  GRASS_RING_COVER_RAMP,
  GRASS_RING_PATCH_BLADES,
  GRASS_RING_SAMPLE_SPACING,
  GRASS_RING_TILE,
  GRASS_RING_TINT_RANGE
} from "../../../render-common/grass/grass-ring-layout";
import { VERGE_COVER_HEIGHT, VERGE_COVER_KEPT } from "../../../render-common/props/field-cover-exclusions";
import { FIELD_GREENS } from "../../../render-common/props/plants/plant-colors";
import { RAIN_LUSH_TINT } from "../../../render-common/shaders/ground-common-glsl";
import { createFogNodes } from "./fog";
import { createLiveFogSampler } from "./live-fog";
import { createNoiseNodes } from "./noise";
import { createGrassKeepNodes } from "./prop-grass";
import { createPropFogHiding, createTrafficGrassKeep } from "./prop-vertex";
import { sunShadowAt } from "./sun-shadow";
import { createSurfaceColorTail } from "./surface-output";
import { createTerrainLighting } from "./terrain-nodes";
import { getTslSeasonTuftTint } from "./terrain-season";
import {
  bindScalar, bindTexture, bindVector, createUniformBindings, syncUniformBindings,
  type UniformBindings
} from "./uniform-bindings";
import { createWindNodes } from "./wind";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const RING_TILE = GRASS_RING_TILE;
const RING_SPACING = GRASS_RING_SAMPLE_SPACING;
const RING_PATCH_BLADES = GRASS_RING_PATCH_BLADES;
const RING_TINT_RANGE = GRASS_RING_TINT_RANGE;
const HIDDEN_CLIP = vec4(2, 2, 2, 1);

export const isGrassRingMaterial = (material: Material) => {
  const uniforms = (material as { uniforms?: Record<string, IUniform> }).uniforms;
  return uniforms?.uRingGround !== undefined && uniforms.uRingShape !== undefined
    && uniforms.uRingEye !== undefined;
};

interface GrassRingSource {
  uniforms: Record<string, IUniform>;
}

const hashRing = Fn(([value]: [TslNode]) => {
  const hashed = value.toVar();
  hashed.assign(hashed.mul(uint(1664525)).add(uint(1013904223)));
  hashed.x.assign(hashed.x.add(hashed.y.mul(hashed.z)));
  hashed.y.assign(hashed.y.add(hashed.z.mul(hashed.x)));
  hashed.z.assign(hashed.z.add(hashed.x.mul(hashed.y)));
  hashed.assign(hashed.bitXor(hashed.shiftRight(uvec3(uint(16), uint(16), uint(16)))));
  hashed.x.assign(hashed.x.add(hashed.y.mul(hashed.z)));
  return hashed.x.bitXor(hashed.x.shiftRight(uint(11)));
}) as (value: TslNode) => TslNode;

const hashBlade = (tile: TslNode, index: TslNode): TslNode => {
  const seed = uvec3(uint(tile.x.add(32768)), uint(tile.y.add(32768)), uint(index)) as TslNode;
  const first = hashRing(seed);
  const second = hashRing(seed.add(uvec3(uint(0), uint(0), uint(4099))));
  return vec4(float(first.bitAnd(uint(0xffff))), float(first.shiftRight(uint(16))),
    float(second.bitAnd(uint(0xffff))), float(second.shiftRight(uint(16)))).div(65535);
};

/** GLSL getRingRoot: quarter turns and a mirror per tile so the shared patch does not repeat. */
const getRingRoot = Fn(([tile, local]: [TslNode, TslNode]) => {
  const variant = hashRing(uvec3(uint(tile.x.add(32768)), uint(tile.y.add(32768)), uint(7)));
  const offset = local.sub(RING_TILE * 0.5).toVar();
  offset.assign(variant.bitAnd(uint(4)).notEqual(uint(0))
    .select(vec2(offset.x.negate(), offset.y), offset));
  const turn = variant.bitAnd(uint(3));
  offset.assign(turn.equal(uint(1)).select(vec2(offset.y.negate(), offset.x), offset));
  offset.assign(turn.equal(uint(2)).select(offset.negate(), offset));
  offset.assign(turn.equal(uint(3)).select(vec2(offset.y, offset.x.negate()), offset));
  return tile.mul(RING_TILE).add(RING_TILE * 0.5).add(offset);
}) as (tile: TslNode, local: TslNode) => TslNode;

/** GLSL pickRingTone: 8 % dry, then 20 % dark, 60 % base, 20 % light (the tufts' odds). */
const pickRingTone = (roll: TslNode, jitter: TslNode): TslNode => {
  const lightOrBase = roll.lessThan(0.816).select(vec3(...FIELD_GREENS.base), vec3(...FIELD_GREENS.light));
  const notDry = roll.lessThan(0.264).select(vec3(...FIELD_GREENS.dark), lightOrBase);
  const tone = roll.lessThan(0.08).select(vec3(...FIELD_GREENS.dry), notDry);
  return tone.mul(float(0.94).add(jitter.mul(0.12)));
};

/**
 * TSL twin of the T07 possessed grass ring (`grass-ring-material.ts` + GRASS_RING_*_GLSL): the
 * instanced blade patch, ring ground texture, ring share/blade keep, meadow density and roadside,
 * wind and the shared prop light/fog/colour tail. The per-tile frustum test is omitted (the ring
 * share already hides most blades; recorded as a performance gap in the receipt).
 */
const createGrassRingNodes = (bindings: UniformBindings, source: Material) => {
  const uniforms = (source as unknown as GrassRingSource).uniforms;
  const noiseTexture = uniforms.uNoiseTexture?.value as Texture | undefined;
  if (!noiseTexture || !uniforms.uCoverField || !uniforms.uRingGround) return null;
  const { fbm3, valueNoise } = createNoiseNodes(noiseTexture);
  const liveFog = createLiveFogSampler(bindings);
  const wind = createWindNodes(valueNoise);
  const { ringShare } = createGrassKeepNodes(valueNoise);
  const biome = bindVector(bindings, "uRingBiome", 4) as TslNode;
  const eye = bindVector(bindings, "uRingEye", 4) as TslNode;
  const shape = bindVector(bindings, "uRingShape", 4) as TslNode;
  const sway = bindScalar(bindings, "uRingSway") as TslNode;
  const ringGround = bindTexture(bindings, "uRingGround") as TslNode;
  const coverField = bindTexture(bindings, "uCoverField") as TslNode;
  const traffic = uniforms.uTrafficWear ? bindTexture(bindings, "uTrafficWear") as TslNode : null;
  const worldSize = bindVector(bindings, "uWorldSize", 2) as TslNode;
  const time = bindScalar(bindings, "uTime") as TslNode;
  const windVector = bindVector(bindings, "uWind", 2) as TslNode;
  const windPhase = bindVector(bindings, "uWindPhase", 2) as TslNode;
  const rain = bindScalar(bindings, "uRain") as TslNode;
  // The season (C1/T1): the ring follows the tufts' meadow tint and thins out while the global snow builds.
  const seasonCover = (bindings.source.uSeasonCover ? bindVector(bindings, "uSeasonCover", 4) : vec4(0)) as TslNode;
  const sunDirection = bindVector(bindings, "uSunDirection", 3) as TslNode;
  const sunColor = bindVector(bindings, "uSunColor", 3) as TslNode;
  const viewDirection = bindVector(bindings, "uViewDirection", 3) as TslNode;
  const explorationFog = bindScalar(bindings, "uExplorationFog") as TslNode;
  const fogOfWarLit = bindScalar(bindings, "uFogOfWarLit") as TslNode;
  const fogColor = bindVector(bindings, "uFogColor", 3) as TslNode;
  const trafficKeep = traffic === null ? () => float(1) : createTrafficGrassKeep(bindings);
  const groundImage = (uniforms.uRingGround.value as Texture).image as { width: number; height: number };
  const groundSize = uniform(new Vector2(groundImage.width, groundImage.height));

  const fetchGround = (sampleIndex: TslNode): TslNode => textureLoad(ringGround,
    ivec2(int(sampleIndex.x.mod(groundSize.x)), int(sampleIndex.y.mod(groundSize.y)))) as TslNode;

  const unpackTint = (packed: TslNode): TslNode => {
    const value = floor(packed.add(0.5));
    const steps = vec3(floor(value.div(65536)), floor(value.div(256)).mod(256), value.mod(256));
    return steps.mul(RING_TINT_RANGE / 255);
  };

  const sampleGround = (xz: TslNode): TslNode => {
    const grid = xz.div(RING_SPACING);
    const base = floor(grid);
    const blend = grid.sub(base);
    const a = fetchGround(base);
    const b = fetchGround(base.add(vec2(1, 0)));
    const c = fetchGround(base.add(vec2(0, 1)));
    const d = fetchGround(base.add(vec2(1, 1)));
    const scalars = mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
    const tint = mix(mix(unpackTint(a.g), unpackTint(b.g), blend.x),
      mix(unpackTint(c.g), unpackTint(d.g), blend.x), blend.y);
    return { height: (scalars as TslNode).r, roadside: (scalars as TslNode).b, tint, zoneKeep: (scalars as TslNode).a };
  };

  const groundDensity = (root: TslNode): TslNode => {
    const safeSize = max(worldSize, vec2(1));
    // The GLSL ramp (TSL-1a had widened it to 0.01..0.12; Ultra must match WebGL).
    const cover = smoothstep(GRASS_RING_COVER_RAMP.start, GRASS_RING_COVER_RAMP.end,
      texture(coverField, root.div(safeSize)).r);
    return cover.mul(trafficKeep(root));
  };

  const roadsideFactors = (roadside: TslNode): TslNode => {
    const verge = clamp(roadside, 0, 1);
    const corridor = smoothstep(-0.08, 0, roadside);
    const kept = mix(VERGE_COVER_KEPT, 1, verge);
    return vec2(corridor.mul(kept), mix(VERGE_COVER_HEIGHT, 1, verge));
  };

  const bladeKeep = (rank: TslNode, threshold: TslNode): TslNode =>
    threshold.lessThanEqual(0).select(float(0),
      clamp(threshold.sub(rank).div(max(threshold.mul(0.35), 1 / RING_PATCH_BLADES)), 0, 1));

  const vertex = (() => {
    const position = attribute("position", "vec3") as TslNode;
    const blade = attribute("blade", "vec2") as TslNode;
    const tile = attribute("tile", "vec2") as TslNode;
    const rank = blade.x as TslNode;
    const root = getRingRoot(tile, position.xz) as TslNode;
    const toEye = eye.xy.sub(root) as TslNode;
    const eyeDistance = length(toEye) as TslNode;
    const threshold = ringShare(shape, eyeDistance, root) as TslNode;
    const ground = sampleGround(root) as { height: TslNode; roadside: TslNode; tint: TslNode; zoneKeep: TslNode };
    const roadside = roadsideFactors(ground.roadside) as TslNode;
    const density = (groundDensity(root) as TslNode).mul(roadside.x).mul(ground.zoneKeep)
      .mul(float(1).sub(smoothstep(0.05, 0.45, seasonCover.w))) as TslNode;
    const keep = (bladeKeep(rank, threshold.mul(density)) as TslNode).mul(eye.z) as TslNode;
    const random = hashBlade(tile, rank.mul(RING_PATCH_BLADES)) as TslNode;
    const height = mix(0.1, 0.26, random.x).mul(mix(0.75, 1.15, density)).mul(roadside.y).mul(keep)
      .mul(biome.x) as TslNode;
    const width = max(mix(0.02, 0.032, random.y), eye.w.mul(eyeDistance).mul(0.9)).mul(keep) as TslNode;
    const angle = random.z.mul(6.2831853) as TslNode;
    const facing0 = vec2(cos(angle), sin(angle)) as TslNode;
    const eyeDirection = toEye.div(max(eyeDistance, 1e-3)) as TslNode;
    const edgeOn = float(1).sub(abs(dot(facing0, eyeDirection))) as TslNode;
    const facing = normalize(mix(facing0 as TslNode,
      eyeDirection.mul(dot(facing0, eyeDirection).add(1e-4).sign()) as TslNode,
      edgeOn.mul(0.35) as TslNode) as TslNode) as TslNode;
    const across = vec2(facing.y.negate(), facing.x) as TslNode;
    const phase = random.w.mul(6.2831853) as TslNode;
    const lean = mix(0.15, 0.6, fract(random.x.mul(7.13).add(random.w))) as TslNode;
    const bend = (facing.mul(height).mul(lean) as TslNode)
      .add((wind.windDisplacement(root, phase, time, windVector, windPhase) as TslNode)
        .mul(height.div(0.2)).mul(sway)) as TslNode;
    const bendLength = length(bend) as TslNode;
    const limited = bend.mul(height.mul(0.9).div(max(bendLength, 1e-5))) as TslNode;
    const finalBend = bendLength.greaterThan(height.mul(0.9)).select(limited, bend) as TslNode;
    const rise = (max(height.mul(height).sub(dot(finalBend, finalBend)), height.mul(height).mul(0.19))
      .sqrt()) as TslNode;
    const base = vec3(root.x, ground.height, root.y) as TslNode;
    const control = base.add(vec3(finalBend.x.mul(0.2), rise.mul(0.62), finalBend.y.mul(0.2))) as TslNode;
    const tip = base.add(vec3(finalBend.x, rise, finalBend.y)) as TslNode;
    const t = position.y as TslNode;
    const spine = mix(mix(base, control, t), mix(control, tip, t), t) as TslNode;
    const tangent = normalize(mix(control.sub(base), tip.sub(control), t) as TslNode) as TslNode;
    const side = vec3(across.x, 0, across.y) as TslNode;
    const flutter = sin(time.mul(6.1).add(phase.mul(3))).mul(0.004).mul(t).mul(t)
      .mul(float(0.4).add(length(windVector))) as TslNode;
    const world = spine.add(side.mul(blade.y.mul(width).mul(0.5)
      .mul(pow(float(1).sub(t), 0.8)).add(flutter))) as TslNode;
    const normal = normalize(cross(side, tangent)) as TslNode;
    const vNormal = normalize(normal.add(side.mul(blade.y).mul(0.45))) as TslNode;
    const tone = pickRingTone(fract(random.z.mul(0.37).add(random.y.mul(0.63))),
      fract(random.w.mul(13.7))) as TslNode;
    const rootShade = mix(0.5, 1, clamp((world.y.sub(base.y)).div(0.1), 0, 1)) as TslNode;
    const tipLight = mix(0.9, 1.06, t) as TslNode;
    const color = ground.tint.mul(vec3(biome.y, biome.z, biome.w)).mul(tone).mul(rootShade).mul(tipLight)
      .mul(mix(vec3(1), vec3(...RAIN_LUSH_TINT), rain)).mul(getTslSeasonTuftTint(bindings, t)) as TslNode;
    const hidden = eye.z.lessThanEqual(0).or(keep.lessThanEqual(0))
      .or(createPropFogHiding(liveFog, valueNoise)(float(1), root)) as TslNode;
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1)) as TslNode;
    return {
      clip: hidden.select(HIDDEN_CLIP, clip) as TslNode,
      color: varying(color, "vRingColor") as TslNode,
      normal: varying(vNormal, "vRingNormal") as TslNode,
      world: varying(world, "vRingWorld") as TslNode
    };
  })();

  const lighting = createTerrainLighting(bindings, source, fbm3,
    { rain, sun: sunDirection, sunColor });
  const backLightWeight = mix(0.3, 1, smoothstep(0.15, 0.5, sunDirection.y)) as TslNode;
  const fog = createFogNodes({ fbm3, liveFog, noiseTexture });
  const colorTail = createSurfaceColorTail(bindings);
  const fragment = (() => {
    const world = vertex.world as TslNode;
    const normal = normalize((vertex.normal as TslNode).mul(faceDirection)) as TslNode;
    const softened = normalize(mix(normal, vec3(0, 1, 0), 0.4)) as TslNode;
    const albedo = vertex.color as TslNode;
    const back = max(softened.negate().dot(sunDirection), 0).mul(0.18)
      .mul(backLightWeight) as TslNode;
    const lit = lighting.lightSurface(albedo, softened, sunShadowAt(bindings.source, world), 1, world.xz)
      .add(albedo.mul(sunColor).mul(back)) as TslNode;
    const fogged = fog.applyFogOfWar(lit, 1, world.xz, worldSize, time, explorationFog, fogOfWarLit,
      fogColor, rain, viewDirection, sunDirection, sunColor) as TslNode;
    return vec4(colorTail(fogged), 1);
  })();

  return { clip: vertex.clip, fragment };
};

/** TSL twin of the possessed grass ring; null when the shared uniforms/textures are absent. */
export const createTslGrassRingMaterial = (sourceMaterial: Material): Material | null => {
  if (!isGrassRingMaterial(sourceMaterial)) return null;
  const source = sourceMaterial as unknown as GrassRingSource;
  if (!source.uniforms.uNoiseTexture || !source.uniforms.uRingGround) return null;
  const bindings = createUniformBindings("grass-ring", source.uniforms);
  const nodes = createGrassRingNodes(bindings, sourceMaterial);
  if (nodes === null) return null;
  const material = new NodeMaterial();
  material.side = DoubleSide;
  material.name = "wg:grass-ring";
  material.toneMapped = false;
  material.vertexNode = nodes.clip;
  material.fragmentNode = nodes.fragment;
  material.userData.syncUniforms = () => syncUniformBindings(bindings);
  return material;
};

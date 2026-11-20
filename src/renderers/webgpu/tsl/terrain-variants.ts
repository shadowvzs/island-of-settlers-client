import {
  clamp, cos, dot, float, int, max, min, mix, normalize, sin, smoothstep, texture, vec2, vec3, vec4
} from "three/tsl";
import type { Texture } from "three/webgpu";

import {
  GROUND_DETAIL_LAYERS,
  GROUND_LITTER_LAYERS,
  GROUND_VARIANT_LAYERS,
  GROUND_VARIANT_TUNING
} from "../../../render-common/shaders/ground-variant-layers-glsl";
import { MATERIAL } from "../../../shared/world/world-data";
import type { GroundContextNodes } from "./terrain-nodes";
import { getTslSeasonLeafLitter, getTslSeasonMud } from "./terrain-season";

type TslNode = any; // TSL's generated types do not model the proxied node methods;

const tuning = GROUND_VARIANT_TUNING;

/** `getVariantNoise` of ground-variant-layers-glsl.ts (analytic, no fetch). */
export const getVariantNoise = (xz: TslNode) => {
  const a = sin(dot(xz, vec2(0.73, -0.41)).add(sin(dot(xz, vec2(-0.29, 0.61)).mul(1.7)).mul(1.3))) as TslNode;
  const b = sin(dot(xz, vec2(2.3, 1.7)).add(a.mul(1.9))) as TslNode;
  return clamp(float(0.5).add(a.mul(0.3)).add(b.mul(0.2)), 0, 1) as TslNode;
};

interface VariantInputs {
  canopy: TslNode;
  context: GroundContextNodes;
  /** Crown litter attribute (pine needles, leaf litter, mountain foot, dune zone). */
  litter: TslNode;
  /** Basalt tile share (the basalt rock palette's gentler rock). */
  basalt: TslNode;
  normal: TslNode;
  paint: TslNode;
  /** Ground season uniforms (season-ground.ts): x wetness, y mud, w snow; litter rgb tint - 1, a gain. */
  seasonCover: TslNode;
  seasonLitter: TslNode;
  /** Tilled soil: the painted garden (theme.w) or a crop plot; fieldRows the crop plot share (axis furrows). */
  tilled: TslNode;
  fieldRows: TslNode;
  signedDepth: TslNode;
  splats: TslNode[];
  surface: TslNode;
  themeWeights: TslNode;
  world: TslNode;
}

/** `getAlpineZone`: x alpine meadow, y lichen grass, by height and by the mountain foot. */
const getAlpineZone = (world: TslNode, foot: TslNode) => {
  const wobble = getVariantNoise(world.xz.mul(0.21).add(3)).sub(0.5) as TslNode;
  const height = world.y.add(wobble.mul(1.4)) as TslNode;
  const near = foot.add(wobble.mul(0.3)).mul(smoothstep(tuning.footHeight[0], tuning.footHeight[1], world.y)) as TslNode;
  return vec2(
    max(smoothstep(tuning.alpineHeight[0], tuning.alpineHeight[1], height),
      smoothstep(tuning.alpineFoot[0], tuning.alpineFoot[1], near)),
    max(smoothstep(tuning.lichenHeight[0], tuning.lichenHeight[1], height),
      smoothstep(tuning.lichenFoot[0], tuning.lichenFoot[1], near))) as TslNode;
};

/** `getAlpineStones`: scattered stones in the alpine meadow, denser in the lichen grass. */
const getAlpineStones = (grass: TslNode, zone: TslNode, xz: TslNode) => {
  const from = mix(tuning.alpineStonePatch[0], tuning.lichenStonePatch[0], zone.y) as TslNode;
  const to = mix(tuning.alpineStonePatch[1], tuning.lichenStonePatch[1], zone.y) as TslNode;
  return grass.mul(zone.x).mul(smoothstep(from, to, getVariantNoise(xz.mul(0.8).add(9))))
    .mul(tuning.alpineStoneShare) as TslNode;
};

/** `applyAlpineGrass`: cooler-yellow alpine grass, then grey-olive lichen grass higher up. */
export const applyTslAlpineGrass = (albedo: TslNode, splats: TslNode[], world: TslNode, foot: TslNode) => {
  const zone = getAlpineZone(world, foot);
  const grass = clamp(splats[0]!.x.add(splats[0]!.y), 0, 1) as TslNode;
  const lichen = mix(albedo, vec3(dot(albedo, vec3(0.333))), tuning.lichenGrey).mul(vec3(...tuning.lichenTint));
  const alpine = mix(albedo.mul(vec3(...tuning.alpineTint)), lichen, zone.y) as TslNode;
  return mix(albedo, alpine, grass.mul(zone.x)) as TslNode;
};

/** `getScreeMask`: the talus band broken into fans and tongues by a lobe noise smeared downslope. */
const getScreeMask = (talus: TslNode, mountainGround: TslNode, normal: TslNode, xz: TslNode) => {
  const [lobeScale, smear, lobeShare] = tuning.screeLobes;
  const down = normalize(normal.xz.add(vec2(1e-4, 0))) as TslNode;
  const lobes = getVariantNoise(xz.mul(lobeScale).add(down.mul(talus).mul(smear)).add(17)) as TslNode;
  const scree = talus.mul(mountainGround).mul(tuning.screeGain) as TslNode;
  return smoothstep(tuning.screeRange[0], tuning.screeRange[1], scree.add(lobes.sub(0.5).mul(lobeShare)))
    .mul(talus.greaterThan(0.01).select(1, 0)) as TslNode;
};

/** `getMossMask`: the forest floor under canopy and scattered cushions on wet, upward-facing lowland rock. */
const getMossMask = ({ canopy, normal, splats, surface, themeWeights, world }: VariantInputs) => {
  const [a, b] = splats as [TslNode, TslNode];
  const damp = float(1).sub(smoothstep(tuning.mossDry[0], tuning.mossDry[1], surface.w)) as TslNode;
  const forestMoss = a.z.mul(smoothstep(tuning.mossCanopy[0], tuning.mossCanopy[1], canopy))
    .mul(float(1).sub(themeWeights.w)) as TslNode;
  const patches = smoothstep(tuning.rockMossPatch[0], tuning.rockMossPatch[1],
    getVariantNoise(world.xz.mul(0.9).add(5))) as TslNode;
  const lowland = float(1).sub(smoothstep(tuning.rockMossHeight[0], tuning.rockMossHeight[1], world.y)) as TslNode;
  const onRock = b.y.mul(smoothstep(tuning.rockMossNormal[0], tuning.rockMossNormal[1], normal.y)).mul(patches)
    .mul(lowland).mul(float(1).sub(themeWeights.y).sub(themeWeights.w)).mul(tuning.rockMossShare) as TslNode;
  return max(forestMoss, onRock).mul(damp) as TslNode;
};

/** `getRiverPebbles`: the whole river bed under the water, thinning out in patches on the exposed bank. */
const getRiverPebbles = (bank: TslNode, height: TslNode, xz: TslNode) => {
  const patches = getVariantNoise(xz.mul(0.4).add(23)) as TslNode;
  const band = smoothstep(tuning.pebbleBank[0], tuning.pebbleBank[1], bank.add(patches.sub(0.5).mul(0.16))) as TslNode;
  const exposed = smoothstep(-0.02, 0.05, height) as TslNode;
  return band.mul(mix(1, smoothstep(tuning.pebblePatch[0], tuning.pebblePatch[1], patches), exposed)) as TslNode;
};

/**
 * `getGroundDetail`: x scree stones, y moss, z swamp mud, w cracked earth; the scree share of the stones,
 * the rounded pebbles (shore and river) and the shore's share of them.
 */
const getVariantMasks = (inputs: VariantInputs) => {
  const { context, normal, paint, signedDepth, splats, surface, themeWeights, world } = inputs;
  const [a, b, c] = splats as [TslNode, TslNode, TslNode];
  const height = signedDepth.negate() as TslNode;
  const shore = surface.y.mul(float(1).sub(smoothstep(tuning.shoreHeight[0], tuning.shoreHeight[1], height)))
    .mul(smoothstep(-0.3, 0, height)).mul(b.x.add(b.w)).mul(tuning.shoreGain) as TslNode;
  const river = getRiverPebbles(surface.x, height, world.xz);
  const scree = max(getScreeMask(surface.z, clamp(b.w.add(b.y).add(c.x).add(a.w), 0, 1), normal, world.xz),
    getAlpineStones(clamp(a.x.add(a.y), 0, 1), getAlpineZone(world, inputs.litter.z), world.xz)) as TslNode;
  const moss = getMossMask(inputs);
  const mud = getTslSeasonMud(a.w.mul(max(surface.x.mul(tuning.mudWetGain), context.swamp)), a.w, themeWeights.y,
    getVariantNoise(world.xz.mul(0.3).add(41)), inputs.seasonCover) as TslNode;
  const cracked = a.w.mul(themeWeights.y).mul(smoothstep(tuning.crackedDry[0], tuning.crackedDry[1], surface.w)) as TslNode;
  const masks = max(clamp(vec4(scree, moss, mud, cracked), 0, 1), paint) as TslNode;
  const screeShare = clamp(scree.div(max(max(scree, paint.x.mul(b.x.add(b.w))), 1e-3)), 0, 1) as TslNode;
  return {
    masks, pebbleShore: shore.div(max(shore.add(river), 1e-3)) as TslNode,
    pebbles: clamp(max(shore, river), 0, 1) as TslNode, screeShare
  };
};

/** `getGroundLitterMasks`: pine needles and leaf litter on the loose ground (no leaf litter in the desert). */
const getLitterMasks = ({ litter, seasonLitter, splats, themeWeights, world }: VariantInputs) => {
  const [a, b] = splats as [TslNode, TslNode];
  const thin = mix(tuning.litterThin, 1, getVariantNoise(world.xz.mul(0.45).add(31))) as TslNode;
  const loose = clamp(dot(a, vec4(1)), 0, 1).mul(float(1).sub(b.z)).mul(thin) as TslNode;
  const [from, to] = tuning.litterRange;
  return [
    smoothstep(from, to, litter.x).mul(loose),
    getTslSeasonLeafLitter(smoothstep(from, to, litter.y).mul(loose), seasonLitter).mul(float(1).sub(themeWeights.y))
  ] as TslNode[];
};

/** `applyTilledSoil`'s furrow shading (the TSL twin keeps the blended normal: no furrow tilt). */
const getTilledFurrows = (xz: TslNode, rows: TslNode) => {
  const angle = getVariantNoise(xz.mul(0.07).add(29)).sub(0.5).mul(1.4).mul(float(1).sub(rows)) as TslNode;
  const phase = xz.x.mul(cos(angle)).add(xz.y.mul(sin(angle))).div(tuning.tilledSpacing)
    .add(getVariantNoise(xz.mul(0.8).add(3)).sub(0.5).mul(0.35)) as TslNode;
  const profile = smoothstep(-0.7, 0.85, sin(phase.mul(6.2832))) as TslNode;
  return mix(tuning.tilledShade[0], tuning.tilledShade[1], profile) as TslNode;
};

interface DetailLayer { channel: TslNode; layer: number; noise?: boolean; tint: TslNode; units: number; }

/** The detail layers in the GLSL `applyGroundVariants` order. */
const listDetailLayers = (inputs: VariantInputs): DetailLayer[] => {
  const { masks, pebbleShore, pebbles, screeShare } = getVariantMasks(inputs);
  const [pine, leaf] = getLitterMasks(inputs);
  const [basaltLayer, pebbleLayer] = GROUND_DETAIL_LAYERS;
  const [stonesLayer, mossLayer, mudLayer, crackedLayer] = GROUND_VARIANT_LAYERS;
  const height = inputs.signedDepth.negate() as TslNode;
  const salt = smoothstep(tuning.saltHeight[0], tuning.saltHeight[1], height) as TslNode;
  const wet = mix(vec3(1), vec3(...tuning.pebbleWet), smoothstep(-0.02, 0.05, height)) as TslNode;
  return [
    { channel: pine, layer: GROUND_LITTER_LAYERS[0]!, tint: vec3(1), units: tuning.litterTileUnits[0] },
    { channel: leaf, layer: GROUND_LITTER_LAYERS[1]!, noise: true,
      tint: vec3(...tuning.leafLitterTint).mul(inputs.seasonLitter.xyz.add(1)), units: tuning.litterTileUnits[1] },
    { channel: inputs.basalt, layer: basaltLayer!, tint: vec3(1), units: tuning.basaltTileUnits },
    { channel: masks.x, layer: stonesLayer!, tint: mix(inputs.context.sand, vec3(...tuning.screeTint).mul(inputs.context.rock), screeShare),
      units: tuning.tileUnits[0] },
    { channel: masks.y, layer: mossLayer!, tint: vec3(...tuning.mossTint), units: tuning.tileUnits[1] },
    { channel: masks.z, layer: mudLayer!, tint: vec3(1), units: tuning.tileUnits[2] },
    { channel: pebbles, layer: pebbleLayer!, noise: true, tint: mix(wet, inputs.context.sand, pebbleShore),
      units: tuning.pebbleTileUnits },
    { channel: masks.w, layer: crackedLayer!, tint: mix(mix(vec3(...tuning.crackedTint), inputs.context.soil,
      tuning.crackedSoilShare), vec3(...tuning.saltTint), salt), units: tuning.tileUnits[3] },
    { channel: inputs.tilled, layer: MATERIAL.dirt, tint: inputs.context.soil.mul(vec3(...tuning.tilledSoil))
      .mul(getTilledFurrows(inputs.world.xz, inputs.fieldRows)), units: tuning.tileUnits[3] }
  ];
};

/**
 * The variant tiles over the blended albedo (GLSL `applyGroundVariants`; the TSL twin, like Minimal, keeps the
 * blended normal and lays the albedo only).
 */
export const applyTslGroundVariants = (albedo: TslNode, albedoTexture: Texture, xz: TslNode, inputs: VariantInputs) => {
  const noise = getVariantNoise(xz);
  const turned = vec2(xz.x.mul(0.8).sub(xz.y.mul(0.6)), xz.x.mul(0.6).add(xz.y.mul(0.8))) as TslNode;
  let result: TslNode = albedo;
  for (const { channel, layer, noise: flipped, tint, units } of listDetailLayers(inputs)) {
    const uv = turned.mul(1 / units).add(layer * 0.37) as TslNode;
    const texel = texture(albedoTexture, uv).depth(int(layer)) as TslNode;
    const breakup = (flipped ? float(1).sub(noise) : noise) as TslNode;
    const edge = channel.add(texel.a.sub(0.5).mul(tuning.heightShare))
      .add(breakup.sub(0.5).mul(tuning.noiseShare)) as TslNode;
    const share = smoothstep(tuning.edge[0], tuning.edge[1], edge).mul(channel.greaterThan(0.02).select(1, 0)) as TslNode;
    result = mix(result, min(texel.rgb.mul(tint), vec3(1)), share) as TslNode;
  }
  return result;
};

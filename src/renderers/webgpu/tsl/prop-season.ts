import { clamp, dot, float, fract, max, mix, smoothstep, step, vec2, vec3, vec4 } from "three/tsl";

import {
  AUTUMN_LEAF_LUMA,
  AUTUMN_LUMA_RANGE,
  AUTUMN_PALETTES,
  BARE_CROWN_TONE,
  DORMANT_KEEP,
  DORMANT_SPRITE_HAZE,
  DORMANT_SPRITE_KEEP,
  DORMANT_TONES,
  MONSOON_DEEPEN,
  MONSOON_SATURATION,
  SEASON_CLASS,
  SEASON_CLASS_COUNT,
  type SeasonClass,
  SPRING_PALETTES
} from "../../../render-common/seasonal-appearance/season-palettes";
import { SEASONAL_LEAF_U_RANGE } from "../../../render-common/props/mesh-builder";
import { EVERGREEN_REGIONS, SEASON_SPECIES_REGIONS } from "../../../render-common/trees/foliage-atlas";
import { bindVector, type UniformBindings } from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;
type Rgb = readonly [number, number, number];

const toVec3 = ([red, green, blue]: Rgb): TslNode => vec3(red, green, blue);

/**
 * SEASON_PICK_VERTEX_GLSL: x the tree (instance phase), y the leaf cluster (prop-space noise), zw the
 * leaf-scale prop-space spot of the spring bud noise.
 */
export const createSeasonPick = (position: TslNode, phase: TslNode, valueNoise: NoiseNode): TslNode => {
  const tree = fract(phase.mul(0.6180339).add(0.37));
  const cluster = valueNoise(position.xz.mul(2.3).add(position.y.mul(1.7)).add(tree.mul(41)));
  const spot = position.xz.mul(9).add(position.y.mul(6.3)).add(tree.mul(17));
  return vec4(tree, cluster, spot.x, spot.y);
};

/**
 * getFoliageKind == broadleaf (the hardwood-leaf sentinel or an atlas leaf outside needles and palms), or a
 * plain seasonal shrub leaf (SEASONAL_LEAF_UV).
 */
const isBroadleaf = (uv: TslNode): TslNode => {
  const { needles, palms } = EVERGREEN_REGIONS;
  const plainLeaf = uv.x.greaterThan(SEASONAL_LEAF_U_RANGE[0]).and(uv.x.lessThan(SEASONAL_LEAF_U_RANGE[1]));
  const sentinel = uv.x.greaterThan(-1.4).and(uv.x.lessThan(-1.1)).or(plainLeaf);
  const inNeedles = uv.x.lessThan(needles.u1).and(uv.y.greaterThanEqual(needles.v0))
    .and(uv.y.lessThan(needles.v1));
  const inPalms = uv.y.greaterThanEqual(palms.v0).and(uv.y.lessThan(palms.v1));
  return sentinel.or(uv.x.greaterThan(-0.5).and(inNeedles.or(inPalms).not()));
};

const autumnToneOf = (seasonClass: SeasonClass, pick: TslNode): TslNode => {
  const [base, hot, pale] = AUTUMN_PALETTES[seasonClass].map(toVec3);
  const lean = pick.x.sub(0.5).mul(0.35);
  const tone = mix(base, hot, step(lean.add(0.62), pick.y));
  return mix(tone, pale, step(lean.mul(0.5).add(0.88), pick.y));
};

const springToneOf = (seasonClass: SeasonClass, pick: TslNode): TslNode => {
  const [base, flush] = SPRING_PALETTES[seasonClass].map(toVec3);
  return mix(base, flush, step(pick.x.sub(0.5).mul(0.3).add(0.7), pick.y));
};

/** GLSL getLeafLight: the leaf luminance relative to an ordinary summer leaf. */
const leafLightOf = (albedo: TslNode): TslNode =>
  clamp(dot(albedo, vec3(0.3, 0.59, 0.11)).div(AUTUMN_LEAF_LUMA), ...AUTUMN_LUMA_RANGE);

/** The per-uv species: the birch strip and cherry sprays name their own class, else the material's. */
const createSpeciesPicker = (uv: TslNode, seasonClass: SeasonClass) => {
  const { birch, cherry } = SEASON_SPECIES_REGIONS;
  const inBirch = uv.x.greaterThanEqual(0).and(uv.y.greaterThanEqual(birch.v0));
  const inCherry = uv.x.greaterThanEqual(cherry.u0).and(uv.x.lessThan(cherry.u1))
    .and(uv.y.greaterThanEqual(cherry.v0)).and(uv.y.lessThan(cherry.v1));
  const select = (of: (species: SeasonClass) => TslNode): TslNode =>
    inBirch.select(of(SEASON_CLASS.birch), inCherry.select(of(SEASON_CLASS.cherry), of(seasonClass)));
  const isCherry = seasonClass === SEASON_CLASS.cherry ? float(1) : inCherry.select(1, 0);
  return { isCherry, select };
};

/** GLSL turnMonsoon: more saturation, then a deep wet green (the caller skips cherry blossom). */
const monsoonToneOf = (albedo: TslNode): TslNode => {
  const grey = vec3(dot(albedo, vec3(0.3, 0.59, 0.11)));
  return max(mix(grey, albedo, 1 + MONSOON_SATURATION), 0).mul(toVec3(MONSOON_DEEPEN));
};

/** GLSL getDormantKeep: leaf fall drops whole clusters, the bud-out regrows the crown leaf by leaf. */
const createDormantKeep = (season: TslNode, budMode: TslNode) =>
  (kept: TslNode, cluster: TslNode, bud: TslNode): TslNode => {
    const drop = season.y.mul(kept.oneMinus());
    const fall = smoothstep(drop.sub(0.03), drop.add(0.03), cluster);
    const grow = smoothstep(season.y.sub(0.08), season.y.add(0.02), bud.mul(0.7).add(cluster.mul(0.3)));
    return season.y.greaterThan(0).select(mix(fall, grow, budMode), float(1));
  };

/**
 * TSL twin of SEASON_FOLIAGE_GLSL `applySeasonFoliage` for one material class (its uSeasonClass is
 * fixed per material, so the palettes are constants here): the season albedo and the dormant leaf keep.
 */
export const createSeasonFoliage = (bindings: UniformBindings, seasonClass: SeasonClass,
  valueNoise: NoiseNode) => {
  const season = bindVector(bindings, "uSeason", 4);
  const budMode = smoothstep(0, 0.3, season.z);
  const dormantKeep = createDormantKeep(season, budMode);
  const [dry, tan] = DORMANT_TONES.map(toVec3);
  return (albedo: TslNode, uv: TslNode, pick: TslNode): { albedo: TslNode; keep: TslNode } => {
    const species = createSpeciesPicker(uv, seasonClass);
    const light = leafLightOf(albedo);
    const start = pick.y.mul(0.55).add(pick.x.mul(0.15));
    const autumnTone = species.select(of => autumnToneOf(of, pick)).mul(light);
    const autumn = mix(albedo, autumnTone, smoothstep(start, start.add(0.3), season.x));
    const dryTone = mix(dry, tan, step(0.6, fract(pick.y.mul(7).add(pick.x.mul(3))))).mul(light);
    const dormant = mix(autumn, dryTone, season.y.mul(budMode.oneMinus()));
    const young = species.select(of => springToneOf(of, pick)).mul(light.min(1));
    const spring = mix(dormant, young, season.z.mul(species.isCherry.oneMinus()));
    const monsoon = mix(spring, monsoonToneOf(spring), season.w.mul(species.isCherry.oneMinus()));
    const kept = species.select(of => float(DORMANT_KEEP[of]));
    const keep = dormantKeep(kept, pick.y, valueNoise(pick.zw));
    const broadleaf = isBroadleaf(uv);
    return {
      albedo: broadleaf.select(monsoon, albedo),
      keep: broadleaf.select(keep, float(1))
    };
  };
};

const SEASON_CLASSES = Array.from({ length: SEASON_CLASS_COUNT }, (_, index) => index as SeasonClass);

/** A per-class value for a class read at run time (sprite instances carry their own class). */
const selectByClass = (seasonClass: TslNode, of: (species: SeasonClass) => TslNode): TslNode =>
  SEASON_CLASSES.slice(1).reduce((chosen: TslNode, species) =>
    seasonClass.equal(species).select(of(species), chosen), of(SEASON_CLASSES[0]!));

/** SEASON_TONES_GLSL `turnSeason` for a run-time class: autumn, dormant, spring, monsoon. */
const createSeasonTurn = (season: TslNode, budMode: TslNode, [dry, tan]: TslNode[]) =>
  (albedo: TslNode, seasonClass: TslNode, pick: TslNode): TslNode => {
    const light = leafLightOf(albedo);
    const start = pick.y.mul(0.55).add(pick.x.mul(0.15));
    const autumnTone = selectByClass(seasonClass, of => autumnToneOf(of, pick)).mul(light);
    const autumn = mix(albedo, autumnTone, smoothstep(start, start.add(0.3), season.x));
    const dryTone = mix(dry, tan, step(0.6, fract(pick.y.mul(7).add(pick.x.mul(3))))).mul(light);
    const dormant = mix(autumn, dryTone, season.y.mul(budMode.oneMinus()));
    const notCherry = seasonClass.equal(SEASON_CLASS.cherry).select(0, 1);
    const young = selectByClass(seasonClass, of => springToneOf(of, pick)).mul(light.min(1));
    const spring = mix(dormant, young, season.z.mul(notCherry));
    return mix(spring, monsoonToneOf(spring), season.w.mul(notCherry));
  };

/**
 * TSL twin of SEASON_SPRITE_GLSL `applySeasonSprite`: the season look of a baked impostor texel
 * (rgb) and its keep (a; a dormant crown opens into a twig haze). Without its early returns: in
 * summer, for class none or for wood every term leaves the albedo and a keep of 1.
 */
export const createSeasonSprite = (bindings: UniformBindings, valueNoise: NoiseNode) => {
  const season = bindVector(bindings, "uSeason", 4);
  const budMode = smoothstep(0, 0.3, season.z);
  const dormantKeep = createDormantKeep(season, budMode);
  const turn = createSeasonTurn(season, budMode, DORMANT_TONES.map(toVec3));
  return (albedo: TslNode, seasonClass: TslNode, leafClass: TslNode, phase: TslNode, texel: TslNode):
  TslNode => {
    const green = smoothstep(0.01, 0.06, albedo.g.sub(max(albedo.r, albedo.b)));
    const leaf = max(step(0.75, leafClass), green).mul(seasonClass.greaterThan(0.5).select(1, 0));
    const pick = vec2(fract(phase.mul(0.6180339).add(0.37)), valueNoise(texel.mul(0.09)));
    const turned = turn(albedo, seasonClass, pick);
    const clinging = dormantKeep(float(DORMANT_SPRITE_KEEP), pick.y, valueNoise(texel.mul(0.6)));
    const haze = toVec3(BARE_CROWN_TONE).mul(clamp(leafLightOf(albedo), 0.6, 1));
    const open = step(valueNoise(texel.mul(0.35)), season.y.mul(DORMANT_SPRITE_HAZE)).mul(clinging.oneMinus());
    const crown = mix(haze, turned, clinging);
    const keep: TslNode = float(1).sub(open.mul(step(0.5, leaf)));
    return vec4(mix(albedo, crown, leaf), keep);
  };
};

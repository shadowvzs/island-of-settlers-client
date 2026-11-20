import { dot, float, max, mix, smoothstep, step, texture, vec2, vec3, vec4 } from "three/tsl";
import type { Texture } from "three/webgpu";

import { FOLIAGE_KIND, WINTER_TREE } from "../../../render-common/shaders/winter-glsl";
import { SNOW_PALETTE } from "../../../render-common/snow-palette";
import { EVERGREEN_REGIONS } from "../../../render-common/trees/foliage-atlas";
import { isLeafAtlasUv } from "./prop-surface";
import { getTslSeasonSnowCover } from "./terrain-season";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;

const FOLIAGE_WOOD = FOLIAGE_KIND.wood;
const FOLIAGE_EVERGREEN = FOLIAGE_KIND.evergreen;
const FOLIAGE_BROADLEAF = FOLIAGE_KIND.broadleaf;
const DRY_LEAF = vec3(...WINTER_TREE.dryLeaf);
const WINTER_NEEDLES = vec3(...WINTER_TREE.needles);
const TREE_SNOW = vec3(...SNOW_PALETTE.treeSnow);
const { dryLeafLuma, keepSpot, snowSpot } = WINTER_TREE;

/**
 * TSL twin of WINTER_TREE_GLSL (the 3D prop path; the sprite bake keeps its own GLSL): foliage
 * kind from the leaf-atlas uv, snow load on upward faces in noise clumps, broadleaf leaf fall and
 * the winter needle/broadleaf colours.
 */

/** GLSL getFoliageKind: 0 wood, 0.5 evergreen (needles/palms), 1 broadleaf. */
export const foliageKindOf = (uv: TslNode): TslNode => {
  const { needles, palms } = EVERGREEN_REGIONS;
  const sentinel = uv.x.greaterThan(-1.4).and(uv.x.lessThan(-1.1));
  const inNeedles = uv.x.lessThan(needles.u1).and(uv.y.greaterThanEqual(needles.v0))
    .and(uv.y.lessThan(needles.v1));
  const inPalms = uv.y.greaterThanEqual(palms.v0).and(uv.y.lessThan(palms.v1));
  const atlas = isLeafAtlasUv(uv);
  const evergreen = atlas.and(inNeedles.or(inPalms));
  const broadleaf = sentinel.or(atlas.and(inNeedles.or(inPalms).not()));
  return evergreen.select(float(FOLIAGE_EVERGREEN), broadleaf.select(float(FOLIAGE_BROADLEAF),
    float(FOLIAGE_WOOD)));
};

const getTreeSnow = (winter: TslNode, normal: TslNode, spot: TslNode, valueNoise: NoiseNode) => {
  const clumps = valueNoise(spot).sub(0.5);
  const load = winter.mul(smoothstep(0.2, 0.6, normal.y.add(clumps.mul(0.6))));
  return winter.lessThanEqual(0).select(float(0), load);
};

const getWinterLeafKeep = (winter: TslNode, spot: TslNode, kept: number, valueNoise: NoiseNode) => {
  const keep = step(winter.mul(1 - kept), valueNoise(spot));
  return winter.lessThanEqual(0).select(float(1), keep);
};

/** Needles cool with the snow load (theme or global season); broadleaf leaves dry with the theme winter only. */
const getWinterFoliage = (albedo: TslNode, kind: TslNode, winter: TslNode, load: TslNode): TslNode => {
  const evergreen = mix(albedo, albedo.mul(WINTER_NEEDLES), load);
  const luma = dot(albedo, vec3(...dryLeafLuma.weights));
  const dry = DRY_LEAF.mul(luma.mul(dryLeafLuma.gain).add(dryLeafLuma.base));
  const broadleaf = mix(albedo, dry, winter);
  const foliage = kind.lessThan(FOLIAGE_BROADLEAF).select(evergreen, broadleaf);
  return kind.lessThanEqual(FOLIAGE_WOOD).or(max(winter, load).lessThanEqual(0)).select(albedo, foliage);
};

export interface WinterNodes {
  /** Winter albedo with the snow load (3D crowns and branches); `load` defaults to the theme winter. */
  apply: (albedo: TslNode, kind: TslNode, winter: TslNode, normal: TslNode, world: TslNode, load?: TslNode) => TslNode;
  /** 1 keeps a broadleaf clump, 0 drops it (fragment discard uses < 0.5). */
  keep: (kind: TslNode, winter: TslNode, world: TslNode) => TslNode;
  /** The global season's GPU snow load (T1, SEASON_SNOW_GLSL getSeasonPropSnow) over the theme winter. */
  seasonLoadAt: (world: TslNode, winter: TslNode, cover: TslNode) => TslNode;
  /** Snow map red channel at a world position. */
  snowAt: (xz: TslNode) => TslNode;
  /**
   * GLSL getSpriteWinterSnow (far impostors): rgb the winter albedo of a baked sprite pixel (kind from
   * the bake's wind map), a 0 where a broadleaf clump has fallen; `spot` is the pixel in atlas texels.
   */
  sprite: (albedo: TslNode, normal: TslNode, bakedKind: TslNode, winter: TslNode, load: TslNode,
    spot: TslNode) => TslNode;
}

/** GLSL snapFoliageKind: a baked (filtered) map value to wood, evergreen or broadleaf. */
const snapFoliageKind = (value: TslNode): TslNode => step(0.25, value).add(step(0.75, value)).mul(0.5);

export const createWinterNodes = (snowMap: Texture, valueNoise: NoiseNode): WinterNodes => {
  const snowNode = texture(snowMap) as TslNode;
  const texels = vec2(snowNode.size(0)) as TslNode;
  const snowAt = (xz: TslNode): TslNode => snowNode.sample(xz.add(0.5).div(texels)).r as TslNode;

  const keep = (kind: TslNode, winter: TslNode, world: TslNode): TslNode => {
    const spot = world.xz.mul(keepSpot.xz).add(world.y.mul(keepSpot.y)) as TslNode;
    const broadleaf = getWinterLeafKeep(winter, spot, WINTER_TREE.keptBroadleaf, valueNoise);
    return kind.lessThan(FOLIAGE_BROADLEAF).select(float(1), broadleaf);
  };

  const apply = (albedo: TslNode, kind: TslNode, winter: TslNode, normal: TslNode,
    world: TslNode, load: TslNode = winter): TslNode => {
    const foliage = getWinterFoliage(albedo, kind, winter, load);
    const spot = world.xz.mul(snowSpot.xz).add(world.y.mul(snowSpot.y)) as TslNode;
    const leafLoad = max(winter, load.mul(WINTER_TREE.seasonLeafSnow)) as TslNode;
    const foliageLoad = kind.lessThan(FOLIAGE_BROADLEAF).select(load, leafLoad) as TslNode;
    const snow = getTreeSnow(foliageLoad, normal, spot, valueNoise);
    return mix(foliage, TREE_SNOW, snow);
  };

  const seasonLoadAt = (world: TslNode, winter: TslNode, cover: TslNode): TslNode => {
    const xz = world.xz as TslNode;
    const keep = snowNode.sample(xz.add(0.5).div(texels)).g as TslNode;
    const dry = smoothstep(-0.02, 0.06, world.y) as TslNode;
    return max(winter, getTslSeasonSnowCover(xz, keep, cover, valueNoise).mul(dry)) as TslNode;
  };

  const sprite = (albedo: TslNode, normal: TslNode, bakedKind: TslNode, winter: TslNode, load: TslNode,
    spot: TslNode): TslNode => {
    const kind = snapFoliageKind(bakedKind);
    const kept = kind.greaterThanEqual(FOLIAGE_BROADLEAF)
      .select(getWinterLeafKeep(winter, spot.mul(0.3), 0.5, valueNoise), float(1));
    const foliage = getWinterFoliage(albedo, kind, winter, load);
    return vec4(mix(foliage, TREE_SNOW, getTreeSnow(load, normal, spot.mul(0.2), valueNoise)), kept);
  };

  return { apply, keep, seasonLoadAt, snowAt, sprite };
};

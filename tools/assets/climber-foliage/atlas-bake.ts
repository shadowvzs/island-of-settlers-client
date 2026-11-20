import { type AtlasMip, type AtlasRegion, buildAtlasMips } from "../../../src/render-common/baker/atlas-mips";
import { CLIMBER_FOLIAGE_TILES } from "../../../src/render-common/plants/climber-foliage-atlas-layout";
import { FOLIAGE_ATLAS_ALPHA_CUTOFF, FOLIAGE_ATLAS_GRID, type FoliageAtlasTile,
  foliageAtlasUvRect } from "../../../src/render-common/plants/foliage-atlas-layout";
import { convexHull, type OutlinePoint, polygonEncloses, reduceConvexPolygon } from "./atlas-outline";
import { createFoliageCanvas, finishFoliageCanvas, type FoliageTileRecipe, tilePainter } from "./foliage-canvas";
import { FOLIAGE_TILE_RECIPES } from "./foliage-tiles";

export const HIGH_ATLAS_SIZE = 1024;
/** 1024 down to 8 px (2 px per tile); region-aware mips never mix neighbouring tiles. */
export const HIGH_MIP_LEVELS = 8;
const OUTLINE_VERTICES = 8;
const VISIBLE_ALPHA = 2;
const BORDER_PIXELS = 2;

export interface BakedFoliageAtlas {
  albedo: AtlasMip[];
  /** Per level, covered texels (alpha >= cutoff) relative to level 0, area-normalized. */
  levelCoverage: number[];
  material: AtlasMip[];
  normal: AtlasMip[];
  /** Tiles whose art reaches the tile border (would be clipped); the bake must not ship then. */
  problems: string[];
  tiles: FoliageAtlasTile[];
}

const tileRegions = (size: number, count: number): AtlasRegion[] => {
  const tile = size / FOLIAGE_ATLAS_GRID;
  return Array.from({ length: count }, (_, index) => ({ height: tile, width: tile,
    x: (index % FOLIAGE_ATLAS_GRID) * tile, y: Math.floor(index / FOLIAGE_ATLAS_GRID) * tile }));
};

/** Transparent texels take a covered neighbour's RGB, so filtering at any level shows no dark fringe. */
const dilateTransparentRgb = (level: AtlasMip, passes: number) => {
  const { data, height, width } = level;
  const filled = new Uint8Array(width * height);
  for (let index = 0; index < filled.length; index += 1) filled[index] = data[index * 4 + 3]! > 0 ? 1 : 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const grown: [number, number][] = [];
    for (let index = 0; index < filled.length; index += 1) {
      if (filled[index]) continue;
      const x = index % width, y = Math.floor(index / width);
      const source = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1].find(neighbour => neighbour >= 0 && filled[neighbour]);
      if (source !== undefined) grown.push([index, source]);
    }
    for (const [index, source] of grown) {
      data.copyWithin(index * 4, source * 4, source * 4 + 3);
      filled[index] = 1;
    }
  }
};

const setOpaque = (levels: AtlasMip[], background: readonly [number, number, number]) => {
  for (const { data } of levels) for (let offset = 0; offset < data.length; offset += 4) {
    const empty = data[offset + 3] === 0 && (data[offset]! + data[offset + 1]! + data[offset + 2]!) === 0;
    if (empty) data.set(background, offset);
    data[offset + 3] = 255;
  }
};

const coveredTexels = (level: AtlasMip) => {
  let covered = 0;
  for (let offset = 3; offset < level.data.length; offset += 4) {
    if (level.data[offset]! >= FOLIAGE_ATLAS_ALPHA_CUTOFF * 255) covered += 1;
  }
  return covered;
};

/** Texel-corner points of every visible texel of a tile, in tile UV; reports art touching the tile border. */
const tileVisiblePoints = (albedo: AtlasMip, region: AtlasRegion, id: string, problems: string[]) => {
  const points: OutlinePoint[] = [];
  for (let y = 0; y < region.height; y += 1) for (let x = 0; x < region.width; x += 1) {
    if (albedo.data[((region.y + y) * albedo.width + region.x + x) * 4 + 3]! < VISIBLE_ALPHA) continue;
    const border = Math.min(x, y, region.width - 1 - x, region.height - 1 - y) < BORDER_PIXELS;
    if (border && !problems.some(problem => problem.startsWith(id))) {
      problems.push(`${id} touches its border at ${x},${y}`);
    }
    points.push([x / region.width, y / region.height], [(x + 1) / region.width, y / region.height],
      [x / region.width, (y + 1) / region.height], [(x + 1) / region.width, (y + 1) / region.height]);
  }
  return points;
};

const tileOutline = (points: OutlinePoint[], id: string, problems: string[]) => {
  if (points.length === 0) return Array.from({ length: OUTLINE_VERTICES }, (): [number, number] => [0.5, 0.5]);
  const outline = reduceConvexPolygon(convexHull(points), OUTLINE_VERTICES);
  if (!polygonEncloses(outline, points, 1e-4)) problems.push(`${id} outline does not enclose its texels`);
  return outline.map(([u, v]): [number, number] => [Number(u.toFixed(5)), Number(v.toFixed(5))]);
};

const describeTiles = <Id extends string>(albedo: AtlasMip, set: FoliageTileSet<Id>, problems: string[]) =>
  tileRegions(albedo.width, set.ids.length).map((region, index): FoliageAtlasTile<Id> => {
  const id = set.ids[index]!;
  const points = tileVisiblePoints(albedo, region, id, problems);
  let covered = 0;
  for (let y = 0; y < region.height; y += 1) for (let x = 0; x < region.width; x += 1) {
    if (albedo.data[((region.y + y) * albedo.width + region.x + x) * 4 + 3]! >= FOLIAGE_ATLAS_ALPHA_CUTOFF * 255) {
      covered += 1;
    }
  }
  return { coverage: Number((covered / (region.width * region.height)).toFixed(5)), id, index,
    outline: tileOutline(points, id, problems), pivot: set.recipes[id].pivot,
    uvRect: foliageAtlasUvRect(index) };
});

/** One atlas: its tile ids in grid order and the painter of each tile. */
export interface FoliageTileSet<Id extends string> {
  ids: readonly Id[];
  recipes: Record<Id, FoliageTileRecipe>;
}

/** Paints every tile at High resolution and derives coverage-preserving mip chains of all maps. */
export const bakeFoliageAtlas = <Id extends string>(set: FoliageTileSet<Id>): BakedFoliageAtlas => {
  const canvas = createFoliageCanvas(HIGH_ATLAS_SIZE, FOLIAGE_ATLAS_GRID);
  set.ids.forEach((id, index) => set.recipes[id].paint(tilePainter(canvas, index, FOLIAGE_ATLAS_GRID)));
  const maps = finishFoliageCanvas(canvas), regions = tileRegions(HIGH_ATLAS_SIZE, set.ids.length);
  const options = { maxLevels: HIGH_MIP_LEVELS - 1 };
  const albedo = buildAtlasMips(maps.albedo, HIGH_ATLAS_SIZE, HIGH_ATLAS_SIZE, regions,
    { ...options, alphaThreshold: FOLIAGE_ATLAS_ALPHA_CUTOFF, mode: "alpha-test" });
  const normal = buildAtlasMips(maps.normal, HIGH_ATLAS_SIZE, HIGH_ATLAS_SIZE, regions, { ...options, mode: "normal" });
  const material = buildAtlasMips(maps.material, HIGH_ATLAS_SIZE, HIGH_ATLAS_SIZE, regions,
    { ...options, mode: "coverage" });
  for (const level of [...albedo.slice(1), ...normal, ...material.slice(1)]) dilateTransparentRgb(level, 3);
  setOpaque(normal, [128, 128, 255]);
  setOpaque(material, [128, 153, 255]);
  const base = coveredTexels(albedo[0]!);
  const levelCoverage = albedo.map((level, index) => Number((coveredTexels(level) * 4 ** index / base).toFixed(4)));
  const problems: string[] = [];
  const tiles = describeTiles(albedo[0]!, set, problems);
  return { albedo, levelCoverage, material, normal, problems, tiles };
};

export const bakeClimberFoliageAtlas = () =>
  bakeFoliageAtlas({ ids: CLIMBER_FOLIAGE_TILES, recipes: FOLIAGE_TILE_RECIPES });

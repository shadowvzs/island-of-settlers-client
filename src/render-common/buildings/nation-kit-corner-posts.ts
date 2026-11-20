import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { WallRun } from "./nation-kit-classify";
import { type KitContext,MASONRY_SURFACES } from "./nation-kit-parts";

type TimberNation = "japanese" | "viking";

/** Roman rusticated quoin blocks (Guardhouse, Quarry): chunky masonry, stacked at a wall corner. */
const QUOIN_SIZE = { maxHeight: .3, maxWidth: .35, minHeight: .12, minWidth: .15 } as const;
const MIN_QUOIN_COURSES = 3;
/** Largest vertical step between two courses of one stack (Minimal spaces fewer courses wider). */
const MAX_COURSE_PITCH = .45;
/** Walls this close (plan) to a quoin column frame the corner it dresses. */
const CORNER_REACH = .15;

/** One corner column of quoins and where the nation post replacing it stands. */
export interface QuoinStack {
  blocks: readonly BuildingPart[];
  /** Where the outer faces of the two walls meeting at the column cross. */
  corner: Point3;
  /** Outward direction on x and z (±1). */
  outward: Point3;
}

const isQuoin = (part: BuildingPart) => part.shape === "box" && !part.stock && !part.rotation &&
  MASONRY_SURFACES.has(part.surface) && part.stage === 2 &&
  part.size[1] >= QUOIN_SIZE.minHeight && part.size[1] <= QUOIN_SIZE.maxHeight &&
  [0, 2].every(axis => part.size[axis]! >= QUOIN_SIZE.minWidth && part.size[axis]! <= QUOIN_SIZE.maxWidth);

const isStacked = (blocks: readonly BuildingPart[]) => {
  const heights = blocks.map(block => block.position[1]).sort((a, b) => a - b);
  return heights.every((y, index) => !index || y - heights[index - 1]! <= MAX_COURSE_PITCH);
};

const isNearColumn = (wall: WallRun, block: BuildingPart) => [0, 2].every(axis =>
  block.position[axis]! >= wall.min[axis]! - CORNER_REACH && block.position[axis]! <= wall.max[axis]! + CORNER_REACH);

/** Outer wall face on one plan axis (walls running across that axis), else the quoins' own face. */
const outerFace = (blocks: readonly BuildingPart[], walls: readonly WallRun[], axis: 0 | 2, sign: number) => {
  const faces = walls.filter(wall => wall.along !== axis && isNearColumn(wall, blocks[0]!))
    .map(wall => sign > 0 ? wall.max[axis]! : wall.min[axis]!);
  if (faces.length) return sign > 0 ? Math.max(...faces) : Math.min(...faces);
  return blocks[0]!.position[axis]! + sign * Math.min(...blocks.map(block => block.size[axis]!)) / 2;
};

const stackCorner = (blocks: readonly BuildingPart[], center: Point3, walls: readonly WallRun[]) => {
  const corner: Point3 = [0, 0, 0], outward: Point3 = [0, 0, 0];
  for (const axis of [0, 2] as const) {
    const sign = blocks[0]!.position[axis]! >= center[axis]! ? 1 : -1;
    outward[axis] = sign;
    corner[axis] = outerFace(blocks, walls, axis, sign);
  }
  return { corner, outward };
};

/** Columns of three or more quoin blocks sharing one plan position. */
export const findQuoinStacks = (parts: readonly BuildingPart[], center: Point3,
  walls: readonly WallRun[]): QuoinStack[] => {
  const columns = new Map<string, BuildingPart[]>();
  for (const part of parts.filter(isQuoin)) {
    const key = `${part.position[0].toFixed(3)},${part.position[2].toFixed(3)}`;
    columns.set(key, [...columns.get(key) ?? [], part]);
  }
  return [...columns.values()]
    .filter(blocks => blocks.length >= MIN_QUOIN_COURSES && isStacked(blocks))
    .map(blocks => ({ blocks, ...stackCorner(blocks, center, walls) }));
};

interface CornerPostStyle {
  /** Footing plan width and height. */
  base: number; baseHeight: number; baseShape: BuildingPart["shape"]; baseSurface: BuildingPart["surface"];
  baseTaper?: Point3;
  post: number; postShape: BuildingPart["shape"];
  /** How far the post's outer faces stand beyond the wall faces. */
  proud: number;
}

/**
 * Viking: one tall squared post on a field-stone footing. Japanese: one round pillar on a dressed
 * foundation stone (soseki).
 */
const CORNER_POST: Readonly<Record<TimberNation, CornerPostStyle>> = {
  japanese: { base: .2, baseHeight: .1, baseShape: "cylinder", baseSurface: "cut-stone", baseTaper: [.85, 1, .85],
    post: .14, postShape: "cylinder", proud: .06 },
  viking: { base: .22, baseHeight: .1, baseShape: "bevel-box", baseSurface: "stone", post: .15,
    postShape: "bevel-box", proud: .06 }
};

/** Plan centre of the post at height `y`: its outer faces stand `proud` beyond the wall faces. */
const postCentre = (stack: QuoinStack, style: CornerPostStyle, y: number): Point3 => {
  const inset = style.post / 2 - style.proud;
  return [stack.corner[0] - stack.outward[0] * inset, y, stack.corner[2] - stack.outward[2] * inset];
};

/** High only: a carved cap (Viking) or a dark metal foot band, nemaki (Japanese). */
const addPostDetail = (context: KitContext, nation: TimberNation, stack: QuoinStack, top: number) => {
  const style = CORNER_POST[nation];
  if (nation === "viking") {
    context.add({ position: postCentre(stack, style, top - .035), shape: "bevel-box",
      size: [style.post + .03, .07, style.post + .03], stage: 2, surface: "wood" });
    return;
  }
  context.add({ position: postCentre(stack, style, style.baseHeight + .03), shape: "cylinder",
    size: [style.post + .012, .05, style.post + .012], stage: 2, surface: "dark" });
};

/**
 * Timber nations do not stack masonry quoins: each Roman quoin column becomes a single corner
 * post (Viking) or round pillar on a stone base (Japanese), as tall as the kept courses.
 */
export const addTimberCornerPost = (context: KitContext, nation: TimberNation, stack: QuoinStack,
  kept: readonly BuildingPart[]) => {
  if (!kept.length) return;
  const style = CORNER_POST[nation], top = Math.max(...kept.map(block => getRomanPartBounds(block).max[1]));
  context.add({ position: postCentre(stack, style, style.baseHeight / 2), shape: style.baseShape,
    size: [style.base, style.baseHeight, style.base], stage: 1, surface: style.baseSurface,
    topScale: style.baseTaper });
  const height = top - style.baseHeight;
  context.add({ position: postCentre(stack, style, style.baseHeight + height / 2), shape: style.postShape,
    size: [style.post, height, style.post], stage: 2, surface: "wood" });
  if (context.detailed) addPostDetail(context, nation, stack, top);
};

import { DMath } from "../../shared/math/deterministic-math";
import { SHIP_DECK, shipDeckHalfWidth } from "./ship-deck-layout";
import type { DeckPoint } from "./ship-deck-people";

/** A rectangle on the deck in ship units (a horse's place, the hatch). */
export interface DeckRect { maxX: number; maxZ: number; minX: number; minZ: number }

/**
 * People on deck keep this far (ship units, about a quarter tile: a body's half width) from the hatch,
 * the mast and horses, less where they start or end closer than that.
 */
const DECK_BLOCK_MARGIN = .07;
/** The hatch and the mast foot just ahead of it: one block that people on deck walk round. */
const HATCH_AND_MAST: DeckRect = {
  maxX: SHIP_DECK.hatch.maxX,
  maxZ: SHIP_DECK.mast.z + SHIP_DECK.mast.radius,
  minX: SHIP_DECK.hatch.minX,
  minZ: SHIP_DECK.hatch.minZ
};
const EDGE = 1e-6;
/** Detours inside detours: enough for the hatch and two horses abreast. */
const DETOUR_DEPTH = 2;

const widen = (rect: DeckRect, margin: number): DeckRect => ({ maxX: rect.maxX + margin, maxZ: rect.maxZ + margin,
  minX: rect.minX - margin, minZ: rect.minZ - margin });

/** Distance from `point` to the rectangle (0 inside). */
const gapTo = (rect: DeckRect, point: DeckPoint) => DMath.hypot(Math.max(rect.minX - point.x, 0, point.x - rect.maxX),
  Math.max(rect.minZ - point.z, 0, point.z - rect.maxZ));

/** Whether the straight walk passes through the block (touching a corner or following a side does not). */
const crosses = (block: DeckRect, from: DeckPoint, to: DeckPoint) => {
  let enter = 0, exit = 1;
  for (const [start, delta, min, max] of [[from.x, to.x - from.x, block.minX, block.maxX],
    [from.z, to.z - from.z, block.minZ, block.maxZ]] as const) {
    if (Math.abs(delta) < EDGE) {
      if (start <= min + EDGE || start >= max - EDGE) return false;
      continue;
    }
    const first = (min - start) / delta, second = (max - start) / delta;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  return exit - enter > EDGE;
};

const isInside = (block: DeckRect, point: DeckPoint) => point.x > block.minX + EDGE && point.x < block.maxX - EDGE &&
  point.z > block.minZ + EDGE && point.z < block.maxZ - EDGE;

/** A turning point people can stand on: on the deck and outside every block. */
const isOpen = (point: DeckPoint, blocks: readonly DeckRect[]) =>
  Math.abs(point.x) <= shipDeckHalfWidth(point.z) && !blocks.some(block => isInside(block, point));

/** Round a block by one corner, or along one of its sides (two corners, either way). */
const detoursOf = (block: DeckRect): DeckPoint[][] => {
  const corners = [{ x: block.minX, z: block.minZ }, { x: block.maxX, z: block.minZ },
    { x: block.maxX, z: block.maxZ }, { x: block.minX, z: block.maxZ }];
  return corners.flatMap((corner, index) => {
    const next = corners[(index + 1) % 4]!;
    return [[corner], [corner, next], [next, corner]];
  });
};

/** Length of the walk from `from` through `way` (any units). */
export const wayLength = (from: DeckPoint, way: readonly DeckPoint[]) => way.reduce((sum, point, index) => {
  const previous = index ? way[index - 1]! : from;
  return sum + DMath.hypot(point.x - previous.x, point.z - previous.z);
}, 0);

const isClearWay = (from: DeckPoint, way: readonly DeckPoint[], blocks: readonly DeckRect[]) =>
  way.every((point, index) => !blocks.some(block => crosses(block, index ? way[index - 1]! : from, point)));

const wayRound = (from: DeckPoint, to: DeckPoint, blocks: readonly DeckRect[], depth: number): DeckPoint[] => {
  const block = blocks.find(candidate => crosses(candidate, from, to));
  if (!block || depth < 0) return [to];
  let best: DeckPoint[] = [to], shortest = Infinity;
  for (const detour of detoursOf(block)) {
    if (!detour.every(point => isOpen(point, blocks))) continue;
    const way: DeckPoint[] = [];
    let at = from;
    for (const point of [...detour, to]) {
      way.push(...wayRound(at, point, blocks, depth - 1));
      at = point;
    }
    const length = wayLength(from, way);
    if (length >= shortest || !isClearWay(from, way, blocks)) continue;
    best = way; shortest = length;
  }
  return best;
};

/** Someone standing closer to a block than its margin first steps straight out of it (nearest side). */
const stepOut = (from: DeckPoint, blocks: readonly DeckRect[]) => {
  const block = blocks.find(candidate => isInside(candidate, from));
  if (!block) return undefined;
  const out = EDGE * 10;
  return [{ x: block.minX - out, z: from.z }, { x: block.maxX + out, z: from.z }, { x: from.x, z: block.minZ - out },
    { x: from.x, z: block.maxZ + out }].filter(point => isOpen(point, blocks))
    .sort((a, b) => DMath.hypot(a.x - from.x, a.z - from.z) - DMath.hypot(b.x - from.x, b.z - from.z))[0];
};

/**
 * Ship-unit walk from `from` to `to` round the hatch, the mast and `obstacles` (horses standing on
 * deck with their holders), a body's half width to spare: the turning points, then `to`. Whoever
 * starts within that margin steps out first; a block holding either end (a rider getting on his
 * horse) is not walked round.
 */
export const deckWay = (from: DeckPoint, to: DeckPoint, obstacles: readonly DeckRect[] = []): DeckPoint[] => {
  const blocks = [HATCH_AND_MAST, ...obstacles].filter(rect => gapTo(rect, from) > 0 && gapTo(rect, to) > 0)
    .map(rect => widen(rect, DECK_BLOCK_MARGIN));
  const exit = stepOut(from, blocks);
  if (!exit) return wayRound(from, to, blocks, DETOUR_DEPTH);
  return [exit, ...wayRound(exit, to, blocks, DETOUR_DEPTH)];
};

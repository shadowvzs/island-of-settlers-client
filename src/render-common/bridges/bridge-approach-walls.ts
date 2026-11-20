import {
  BRIDGE_MAX_RAMP_LENGTH,
  type BridgeApproachPiece,
  bridgeFlareWidth
} from "../../shared/settlement/bridge-approaches";
import type { RoadPoint } from "../../shared/settlement/road-types";
import { type AddBridgePart, stoneTint } from "./bridge-recipe";

/**
 * Wing walls under a raised shore ramp: where a bank is lower than the deck, the ramp the shore
 * road climbs is retained by coursed stone walls along both road edges, from below the ground up
 * to the ramp, so the road never hangs in the air beside the bridge mouth.
 */
export interface ApproachWallInput {
  detailed: boolean;
  /** Deck frame of the bridge model: world point of local (0, 0) and the unit span direction. */
  origin: RoadPoint;
  pieces: readonly BridgeApproachPiece[];
  /** Shared deck/ramp surface (undefined off the bridge and its ramps). */
  rampHeight: (x: number, z: number) => number | undefined;
  terrainHeight: (x: number, z: number) => number;
  unit: RoadPoint;
}

const WALL_THICKNESS = 0.2;
/** Ramps closer to the ground than this need no wall. */
const MIN_EXPOSED = 0.04;
/** Footing depth below the ground at the wall face. */
const FOOTING = 0.2;
/** Wall top stays this far under the drawn ramp so the road surface covers its edge. */
const TOP_SINK = 0.02;

const toLocal = (input: ApproachWallInput, point: RoadPoint) => {
  const dx = point.x - input.origin.x, dz = point.z - input.origin.z;
  return { across: dz * input.unit.x - dx * input.unit.z, along: dx * input.unit.x + dz * input.unit.z };
};

interface WallStone {
  /** Distances along the piece of the stone's two ends. */
  from: number;
  to: number;
}

/** One wall stone whose top follows the ramp between its ends (no stair steps), footed below ground. */
const addWallStone = (
  input: ApproachWallInput, add: AddBridgePart, piece: BridgeApproachPiece, stone: WallStone,
  side: -1 | 1, tint: number
) => {
  const dx = piece.to.x - piece.from.x, dz = piece.to.z - piece.from.z, length = Math.hypot(dx, dz);
  const direction = { x: dx / length, z: dz / length }, normal = { x: -direction.z, z: direction.x };
  const middle = (stone.from + stone.to) / 2;
  const reach = bridgeFlareWidth(piece.segment, piece.startDistance + middle) / 2 + WALL_THICKNESS / 2;
  const end = (offset: number) => {
    const centre = { x: piece.from.x + direction.x * offset, z: piece.from.z + direction.z * offset };
    const face = { x: centre.x + normal.x * side * reach, z: centre.z + normal.z * side * reach };
    const ramp = input.rampHeight(centre.x, centre.z);
    return { face, ground: input.terrainHeight(face.x, face.z), top: ramp === undefined ? undefined : ramp - TOP_SINK };
  };
  const first = end(stone.from), last = end(stone.to);
  const firstTop = first.top ?? last.top, lastTop = last.top ?? first.top;
  if (firstTop === undefined || lastTop === undefined) return;
  const exposed = Math.max(firstTop - first.ground, lastTop - last.ground);
  if (exposed < MIN_EXPOSED) return;
  const run = stone.to - stone.from, height = exposed + FOOTING;
  const face = { x: (first.face.x + last.face.x) / 2, z: (first.face.z + last.face.z) / 2 };
  const local = toLocal(input, { x: input.origin.x + direction.x, z: input.origin.z + direction.z });
  const { across, along } = toLocal(input, face);
  add({
    position: [along, (firstTop + lastTop) / 2 - height / 2, across],
    rotation: [0, Math.atan2(-local.across, local.along), Math.atan2(lastTop - firstTop, run)],
    shape: "stone-block",
    size: [Math.hypot(run, lastTop - firstTop) + 0.01, height, WALL_THICKNESS],
    surface: "stone",
    tint: stoneTint(tint)
  });
};

const addPieceWalls = (input: ApproachWallInput, add: AddBridgePart, piece: BridgeApproachPiece, index: number) => {
  const length = Math.hypot(piece.to.x - piece.from.x, piece.to.z - piece.from.z);
  if (length < 1e-6) return;
  const step = input.detailed ? 0.3 : 0.5, stones = Math.max(1, Math.round(length / step));
  for (let stone = 0; stone < stones; stone += 1) {
    const from = stone * length / stones, to = from + length / stones;
    if (piece.startDistance + from >= BRIDGE_MAX_RAMP_LENGTH) return;
    for (const side of [-1, 1] as const)
      addWallStone(input, add, piece, { from, to }, side, stone * 3 + index + (side < 0 ? 0 : 5));
  }
};

/** Wing walls for every shore ramp piece of one bridge, in the bridge model's deck frame. */
export const addApproachWalls = (input: ApproachWallInput, add: AddBridgePart) => {
  input.pieces.forEach((piece, index) => addPieceWalls(input, add, piece, index));
};

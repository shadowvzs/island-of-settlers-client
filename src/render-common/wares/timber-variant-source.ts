import { DMath } from "../../shared/math/deterministic-math";
import type { MaterialWoodWare } from "./advanced-material-variants";

interface TimberChunk {
  material: number;
  position: number[];
  uv: number[];
  minimalPosition?: number[];
  minimalUv?: number[];
}

type TimberPiece = [x: number, y: number, z: number, width: number, height: number, length: number, yaw: number];

/** Species-specific loose cuts, assembled from the original textured trunk and board. */
const PIECES: Partial<Record<MaterialWoodWare, TimberPiece[]>> = {
  hardwoodLogs: [[-.13, 0, -.06, .24, .24, 2.9, 0], [.13, 0, .09, .23, .24, 2.7, 0]],
  cedarLogs: [[-.18, 0, 0, .16, .16, 2.9, 0], [0, 0, .07, .16, .16, 2.75, 0],
    [.18, 0, -.04, .16, .16, 2.85, 0]],
  walnutLogs: [[-.13, 0, 0, .29, .30, 2.5, -.035], [.16, -.035, .22, .22, .23, 1.9, .045]],
  mahoganyLogs: [[-.06, 0, 0, .40, .40, 2.8, 0], [.23, -.10, .38, .16, .18, 1.65, -.04]],
  cedarPlanks: Array.from({ length: 5 }, (_, i) =>
    [(i - 2) * .009, i * .055, (i % 2) * .12, .16, .045, 2.9 - i * .07, (i - 2) * .018]),
  walnutPlanks: [[0, 0, 0, .40, .075, 2.1, -.018], [.025, .085, .12, .36, .075, 1.95, .018]],
  mahoganyPlanks: [[-.025, 0, -.12, .38, .055, 2.65, 0], [0, .065, 0, .35, .055, 2.42, 0],
    [.035, .13, .16, .31, .055, 2.15, 0]]
};

const reshapeChunk = (chunk: TimberChunk, bounds: { min: number[]; max: number[] },
  piece: TimberPiece, liveEdge: boolean): TimberChunk => {
  const [x, y, z, width, height, length, yaw] = piece;
  const cosine = DMath.cos(yaw), sine = DMath.sin(yaw);
  const transform = (values: number[]) => values.map((_value, index) => {
    const axis = index % 3, at = index - axis;
    const local = [0, 1, 2].map(a =>
      (values[at + a]! - (bounds.min[a]! + bounds.max[a]!) / 2) /
      (bounds.max[a]! - bounds.min[a]!));
    let px = local[0]! * width;
    const pz = local[2]! * length;
    if (liveEdge) px *= .94 + .06 * DMath.sin(local[2]! * 17 + (px > 0 ? 1.2 : 0));
    if (axis === 0) return x + px * cosine + pz * sine;
    if (axis === 1) return y + local[1]! * height;
    return z - px * sine + pz * cosine;
  });
  return { ...chunk, position: transform(chunk.position),
    minimalPosition: chunk.minimalPosition ? transform(chunk.minimalPosition) : undefined };
};

export const timberVariantChunks = (ware: MaterialWoodWare, chunks: readonly TimberChunk[]) => {
  const pieces = PIECES[ware];
  if (!pieces) return chunks;
  const logs = ware.endsWith("Logs"), template = chunks.slice(0, logs ? 3 : 1);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const chunk of template) chunk.position.forEach((value, index) => {
    const axis = index % 3;
    bounds.min[axis] = Math.min(bounds.min[axis]!, value);
    bounds.max[axis] = Math.max(bounds.max[axis]!, value);
  });
  return pieces.flatMap(piece => template.map(chunk => reshapeChunk(chunk, bounds, piece, ware === "walnutPlanks")));
};

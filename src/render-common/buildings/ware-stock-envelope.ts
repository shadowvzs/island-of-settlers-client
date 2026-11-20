import { DMath } from "../../shared/math/deterministic-math";
import { createWareRecipe } from "../wares/ware-recipe";
import { WATER_WARE_SCALE } from "../wares/water-bucket-dimensions";
import { WORKER_SCALE } from "../workers/worker-dimensions";
import type { Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

interface WareEnvelope { min: Point3; max: Point3; yaw: number }
const envelopes = new Map<string, WareEnvelope>();
/** Cached canonical High envelope; rendering LOD never changes cargo size or stock contacts. */
export const stockWareEnvelope = (ware: string) => {
  const previous = envelopes.get(ware);
  if (previous) return previous;
  const parts = createWareRecipe(ware, true).parts, bounds = parts.map(part => getRomanPartBounds(part));
  const largest = parts.reduce((best, part) => part.size.reduce((a, b) => a * b, 1) >
    best.size.reduce((a, b) => a * b, 1) ? part : best);
  const envelope = { min: [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]!))) as Point3,
    max: [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!))) as Point3,
    yaw: largest.rotation?.[1] ?? 0 };
  envelopes.set(ware, envelope);
  return envelope;
};

/** The original placement orientation, including horizontal timber and the authored water scale. */
export const stockWareDimensions = (ware: string, scale: number, authoredYaw: number,
  horizontalSpan: readonly [number, number]) => {
  const envelope = stockWareEnvelope(ware);
  let yaw = authoredYaw - envelope.yaw;
  const canonicalX = envelope.max[0] - envelope.min[0], canonicalZ = envelope.max[2] - envelope.min[2];
  const orientedX = Math.abs(canonicalX * DMath.cos(yaw)) + Math.abs(canonicalZ * DMath.sin(yaw));
  const orientedZ = Math.abs(canonicalX * DMath.sin(yaw)) + Math.abs(canonicalZ * DMath.cos(yaw));
  const directional = Math.abs(horizontalSpan[0] - horizontalSpan[1]) > Math.max(...horizontalSpan) * .1;
  if (ware !== "water" && directional && (horizontalSpan[0] > horizontalSpan[1]) !== (orientedX > orientedZ))
    yaw += Math.PI / 2;
  const ratio = WORKER_SCALE / scale;
  const dimensions: Point3 = ware === "water"
    ? [WATER_WARE_SCALE.x / scale, WATER_WARE_SCALE.y / scale, WATER_WARE_SCALE.z / scale] : [ratio, ratio, ratio];
  const size = dimensions.map((value, axis) => (envelope.max[axis]! - envelope.min[axis]!) * value) as Point3;
  const cosine = Math.abs(DMath.cos(yaw)), sine = Math.abs(DMath.sin(yaw));
  return { envelope, dimensions, ratio, yaw,
    size: [size[0] * cosine + size[2] * sine, size[1], size[0] * sine + size[2] * cosine] as Point3 };
};

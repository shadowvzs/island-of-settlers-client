import type { SculpturePoint } from "./sculpture-recipe";

export interface AnatomyLobe {
  position: SculpturePoint;
  radii: SculpturePoint;
  pitch?: number;
  roll?: number;
}
export interface SculptureAnatomy {
  kind: "anatomy";
  blend: number;
  bounds: { min: SculpturePoint; max: SculpturePoint };
  lobes: readonly AnatomyLobe[];
  resolution: number;
}

/** Smooth union distance field, shared by native sculpt meshing and attached scale/plumage fitting. */
export const sculptureAnatomyDistance = (shape: SculptureAnatomy, x: number, y: number, z: number) => {
  let result = 100;
  for (const lobe of shape.lobes) {
    const dx = x - lobe.position[0], dy = y - lobe.position[1], dz = z - lobe.position[2];
    const rollCosine = Math.cos(lobe.roll ?? 0), rollSine = Math.sin(lobe.roll ?? 0);
    const px = dx * rollCosine + dy * rollSine, rolledY = dy * rollCosine - dx * rollSine;
    const cosine = Math.cos(lobe.pitch ?? 0), sine = Math.sin(lobe.pitch ?? 0);
    const py = rolledY * cosine + dz * sine, pz = dz * cosine - rolledY * sine;
    const [rx, ry, rz] = lobe.radii;
    const first = Math.hypot(px / rx, py / ry, pz / rz);
    const second = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
    const distance = second > .000001 ? first * (first - 1) / second : -Math.min(rx, ry, rz);
    const blend = Math.max(0, shape.blend - Math.abs(result - distance)) / shape.blend;
    result = Math.min(result, distance) - blend * blend * shape.blend * .25;
  }
  return result;
};

/** Outside surface on a positive axis: scales and small feathers grow from the fused body. */
export const anatomySurface = (shape: SculptureAnatomy, point: SculpturePoint, axis: 0 | 1 | 2) => {
  const limit = shape.bounds.max[axis] + shape.blend * 2;
  let outside = limit, inside = -1;
  // A long snout/head need not contain coordinate zero. Search inward from clear air first,
  // then refine the outermost crossing, so attached details cannot jump to the centre plane.
  for (let sample = 1; sample <= 128; sample++) {
    const candidate: [number, number, number] = [...point];
    candidate[axis] = limit * (1 - sample / 128);
    if (sculptureAnatomyDistance(shape, ...candidate) < 0) {
      inside = candidate[axis]; break;
    }
    outside = candidate[axis];
  }
  if (inside < 0) return 0;
  for (let step = 0; step < 15; step++) {
    const middle = (inside + outside) / 2, candidate: [number, number, number] = [...point];
    candidate[axis] = middle;
    if (sculptureAnatomyDistance(shape, ...candidate) < 0) inside = middle;
    else outside = middle;
  }
  return (inside + outside) / 2;
};

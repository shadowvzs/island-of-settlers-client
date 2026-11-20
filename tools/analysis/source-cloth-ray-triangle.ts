import { Triangle, Vector3 } from "three";

import { intersect } from "../../../island-of-settlers-worker-generation/src/retarget/cloth-cover";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Closest pair on two finite segments, including parallel and degenerate endpoints. */
const segmentPair = (p0: Vector3, p1: Vector3, q0: Vector3, q1: Vector3) => {
  const d1 = p1.clone().sub(p0), d2 = q1.clone().sub(q0), r = p0.clone().sub(q0);
  const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-24) t = e > 1e-24 ? clamp(f / e) : 0;
  else {
    const c = d1.dot(r);
    if (e <= 1e-24) s = clamp(-c / a);
    else {
      const b = d1.dot(d2), denominator = a * e - b * b;
      s = denominator > 1e-24 ? clamp((b * f - c * e) / denominator) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    }
  }
  return { bary: t, line: p0.clone().addScaledVector(d1, s), surface: q0.clone().addScaledVector(d2, t) };
};

/** Exact finite-ray/triangle distance. Barycentric envelope gradients allow the contact point
 * to move on the original triangle; no frozen contact-plane assumption or geometry edit. */
export const closestClothRayTriangle = (origin: Vector3, direction: Vector3, length: number,
  vertices: readonly Vector3[], inset = .0001) => {
  const points = vertices.map((vertex, at) => vertex.clone().multiplyScalar(1 - 2 * inset)
    .addScaledVector(vertices[(at + 1) % 3]!, inset).addScaledVector(vertices[(at + 2) % 3]!, inset));
  const endpoint = origin.clone().addScaledVector(direction, length), triangle = new Triangle(...points as [Vector3, Vector3, Vector3]);
  const hit = intersect(origin, direction, ...points as [Vector3, Vector3, Vector3]);
  const originalBary = (bary: readonly number[]) => bary.map(value => inset + (1 - 3 * inset) * value);
  if (hit && hit.distance >= 0 && hit.distance <= length) return {
    bary: originalBary(hit.bary), distanceSquared: 0, residual: new Vector3() };
  const options: { bary: number[]; line: Vector3; surface: Vector3 }[] = (triangle.getArea() > 1e-18 ? [origin, endpoint] : []).map(line => {
    const surface = triangle.closestPointToPoint(line, new Vector3()), bary = new Vector3();
    triangle.getBarycoord(surface, bary);
    return { bary: bary.toArray(), line, surface };
  });
  for (let edge = 0; edge < 3; edge++) {
    const pair = segmentPair(origin, endpoint, points[edge]!, points[(edge + 1) % 3]!);
    const bary = [0, 0, 0]; bary[edge] = 1 - pair.bary; bary[(edge + 1) % 3] = pair.bary;
    options.push({ ...pair, bary });
  }
  const closest = options.reduce((best, value) => value.surface.distanceToSquared(value.line)
    < best.surface.distanceToSquared(best.line) ? value : best);
  const residual = closest.surface.clone().sub(closest.line);
  return { bary: originalBary(closest.bary), distanceSquared: residual.lengthSq(), residual };
};

export interface ClothRayObjective { gradient: number[]; maximumDistance: number; objective: number }

/** One bounded geometric solve over the same source trust hulls. Every step follows exact
 * closest-surface gradients and an Armijo decrease; the independent native gate is separate. */
export const solveConnectedClothRays = (corners: readonly number[][][], start: readonly number[],
  evaluate: (weights: readonly number[]) => ClothRayObjective, limit = 800) => {
  let weights = [...start], value = evaluate(weights), iterations = 0;
  for (; iterations < limit && value.maximumDistance > 3e-8; iterations++) {
    let offset = 0;
    const support = corners.flatMap(group => {
      const gradient = value.gradient.slice(offset, offset + group[0]!.length); offset += gradient.length;
      const dot = (corner: number[]) => corner.reduce((sum, value, slot) => sum + value * gradient[slot]!, 0);
      return group.reduce((best, corner) => dot(corner) < dot(best) ? corner : best);
    });
    const direction = support.map((value, at) => value - weights[at]!);
    const derivative = direction.reduce((sum, direction, at) => sum + direction * value.gradient[at]!, 0);
    if (derivative >= -1e-24) break;
    let accepted = false;
    for (let step = 0, fraction = 1; step < 25; step++, fraction /= 2) {
      const nextWeights = weights.map((weight, at) => weight + fraction * direction[at]!);
      const next = evaluate(nextWeights);
      if (next.objective <= value.objective + .05 * fraction * derivative) {
        weights = nextWeights; value = next; accepted = true; break;
      }
    }
    if (!accepted) break;
  }
  return { weights, iterations, objective: value.objective, maximumDistance: value.maximumDistance,
    targetRaysCovered: value.maximumDistance <= 3e-8 };
};

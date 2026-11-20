import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import type { WisteriaWoodPoint } from "./wisteria-woody-geometry";

/** Millimetre-scale attachment: a closed-sided tapered stalk ends inside the actual leaf/calyx. */
export const createWisteriaPetioleGeometry = (start: WisteriaWoodPoint, end: WisteriaWoodPoint, radius: number) => {
  const base = new Vector3(...start), tip = new Vector3(...end), axis = tip.clone().sub(base);
  const length = axis.length();
  if (length < 1e-8 || radius <= 0) throw new Error("Invalid Wisteria petiole dimensions");
  axis.normalize();
  const right = new Vector3().crossVectors(axis, new Vector3(0, 1, 0));
  if (right.lengthSq() < .0001) right.set(1, 0, 0); else right.normalize();
  const across = new Vector3().crossVectors(right, axis).normalize();
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
  const normal = new Vector3(), point = new Vector3();
  for (let side = 0; side < 3; side++) {
    for (const [angle, atTip] of [[side / 3 * Math.PI * 2, false],
      [(side + 1) / 3 * Math.PI * 2, false], [(side + .5) / 3 * Math.PI * 2, true]] as const) {
      normal.copy(right).multiplyScalar(Math.cos(angle)).addScaledVector(across, Math.sin(angle));
      point.copy(atTip ? tip : base);
      if (!atTip) point.addScaledVector(normal, radius);
      positions.push(point.x, point.y, point.z);
      normal.addScaledVector(axis, radius / length).normalize(); normals.push(normal.x, normal.y, normal.z);
      uv.push(angle / (Math.PI * 2), atTip ? length * 1.7 : 0);
    }
    const first = side * 3; indices.push(first, first + 2, first + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(positions.length).fill(1), 3));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
};

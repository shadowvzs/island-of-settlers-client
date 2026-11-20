import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, LatheGeometry, Shape, Vector2 } from "three";

import {
  PERSIAN_BARREL_INNER_HEIGHT_SCALE, PERSIAN_BARREL_INNER_WIDTH_SCALE,
  PERSIAN_INNER_HEIGHT_SCALE, PERSIAN_INNER_RADIUS_SCALE,
  persianBarrelSegments, persianDomeProfilePoint, persianDomeSegments
} from "../../../render-common/buildings/persian-vault-profile";

/** Solid plastered masonry dome with a separate inner intrados and a real crown oculus. */
export const createPersianDome = (detailed: boolean) => {
  const { radial, rows } = persianDomeSegments(detailed);
  const outer = Array.from({ length: rows + 1 }, (_, index) => persianDomeProfilePoint(index / rows));
  const profile = outer.map(([radius, height]) => new Vector2(radius, height));
  // The inside springs on a narrower ring and joins the outer crown with an exposed lip.
  for (const [radius, height] of [...outer].reverse())
    profile.push(new Vector2(radius * PERSIAN_INNER_RADIUS_SCALE,
      (height + .5) * PERSIAN_INNER_HEIGHT_SCALE - .5));
  profile.push(profile[0]!.clone());
  const geometry = new LatheGeometry(profile, radial);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** Thick elliptical pitched vault. Front/back reveal surfaces expose genuine wall depth. */
export const createPersianBarrel = (detailed: boolean) => {
  const segments = persianBarrelSegments(detailed), shape = new Shape();
  shape.moveTo(.5, -.5);
  for (let index = 1; index <= segments; index++) {
    const angle = Math.PI * index / segments;
    shape.lineTo(.5 * Math.cos(angle), -.5 + Math.sin(angle));
  }
  shape.lineTo(-.5 * PERSIAN_BARREL_INNER_WIDTH_SCALE, -.5);
  for (let index = segments - 1; index >= 0; index--) {
    const angle = Math.PI * index / segments;
    shape.lineTo(.5 * PERSIAN_BARREL_INNER_WIDTH_SCALE * Math.cos(angle),
      -.5 + PERSIAN_BARREL_INNER_HEIGHT_SCALE * Math.sin(angle));
  }
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -.5);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** Solid elliptical tympanum closes a vault above a lower wall, retaining the exact vault segment contacts. */
export const createPersianBarrelEnd = (detailed: boolean) => {
  const segments = persianBarrelSegments(detailed), shape = new Shape();
  shape.moveTo(-.5, -.5); shape.lineTo(.5, -.5);
  for (let index = 1; index <= segments; index++) {
    const angle = Math.PI * index / segments;
    shape.lineTo(.5 * Math.cos(angle), -.5 + Math.sin(angle));
  }
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -.5);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** Bonded square-to-octagon squinch collar: closed corner shoulders and actual sloping inner masonry. */
export const createPersianTransition = () => {
  const positions: number[] = [], uvs: number[] = [];
  const square = [[.5, .5], [0, .5], [-.5, .5], [-.5, 0], [-.5, -.5], [0, -.5], [.5, -.5], [.5, 0]];
  const quad = (points: number[][]) => {
    for (const index of [0, 2, 1, 0, 3, 2]) {
      const point = points[index]!; positions.push(...point); uvs.push(point[0]!, point[2]!);
    }
  };
  const outer = (index: number, y: number) => [square[index % 8]![0]!, y, square[index % 8]![1]!];
  const lower = (index: number) => [square[index % 8]![0]! * .86, -.5, square[index % 8]![1]! * .86];
  const upper = (index: number) => {
    const angle = Math.PI / 4 + index * Math.PI / 4;
    const radius = PERSIAN_INNER_RADIUS_SCALE / 2;
    return [Math.cos(angle) * radius, .5, Math.sin(angle) * radius];
  };
  for (let index = 0; index < 8; index++) {
    const next = index + 1;
    quad([outer(index, .5), outer(next, .5), upper(next), upper(index)]);
    quad([outer(index, -.5), lower(index), lower(next), outer(next, -.5)]);
    quad([outer(index, -.5), outer(next, -.5), outer(next, .5), outer(index, .5)]);
    quad([lower(index), upper(index), upper(next), lower(next)]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

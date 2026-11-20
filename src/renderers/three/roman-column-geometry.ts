import { BufferGeometry, CatmullRomCurve3, CylinderGeometry, Float32BufferAttribute,
  LatheGeometry, SphereGeometry, TubeGeometry, Vector2, Vector3 } from "three";

export type RomanColumnDetail = "high" | "minimal" | "far";
export type RomanColumnOrder = 0 | 1;

const detailSegments = (detail: RomanColumnDetail) => {
  if (detail === "high") return { around: 80, fluteCount: 20, rings: 8, profile: 48, spiral: 28, tube: 6 };
  if (detail === "minimal") return { around: 40, fluteCount: 20, rings: 4, profile: 18, spiral: 12, tube: 4 };
  return { around: 16, fluteCount: 8, rings: 2, profile: 8, spiral: 7, tube: 3 };
};

/** Entasis and concave flutes are in the silhouette, rather than painted dark stripes. */
export const createRomanFlutedShaft = (detail: RomanColumnDetail, ionic: boolean) => {
  const { around, fluteCount, rings } = detailSegments(detail);
  const bottom = ionic ? .36 : .25, height = ionic ? 2.49 : 2.48;
  const geometry = new CylinderGeometry(.175, .213, height, around, rings);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), z = positions.getZ(index), y = positions.getY(index);
    const t = (y + height / 2) / height, angle = Math.atan2(x, z);
    const flute = Math.pow(.5 + .5 * Math.cos(angle * fluteCount), .8);
    const radius = Math.hypot(x, z);
    if (radius > .01) {
      const entasis = .010 * Math.sin(Math.PI * t);
      const groove = .018 * flute * Math.max(0, Math.min(1, t * 12, (1 - t) * 12)) ** .25;
      const scale = (radius + entasis - groove) / radius;
      positions.setXYZ(index, x * scale, y + bottom + height / 2, z * scale);
    } else positions.setY(index, y + bottom + height / 2);
  }
  geometry.computeVertexNormals();
  return geometry;
};

export const createRomanColumnMoulding = (profile: readonly (readonly [number, number])[],
  detail: RomanColumnDetail) => new LatheGeometry(profile.map(([radius, y]) => new Vector2(radius, y)),
  detailSegments(detail).profile);

/** A carved spiral rests on a solid scroll cushion; the rolls connect front and rear capital faces. */
export const createRomanVolute = (side: number, front: number, detail: RomanColumnDetail) => {
  const { spiral, tube } = detailSegments(detail), points: Vector3[] = [];
  for (let index = 0; index <= spiral; index++) {
    const t = index / spiral, angle = Math.PI * .4 + t * Math.PI * 3.55;
    const radius = .109 * (1 - t) + .013 * t;
    points.push(new Vector3(side * .266 + Math.cos(angle) * radius,
      3.05 + Math.sin(angle) * radius, front * .192));
  }
  return new TubeGeometry(new CatmullRomCurve3(points), spiral, .013, tube, false);
};

export const createRomanScrollDrum = (side: number, detail: RomanColumnDetail) => {
  const geometry = new CylinderGeometry(.115, .115, .356, detailSegments(detail).profile / 2, 1);
  geometry.rotateX(Math.PI / 2); geometry.translate(side * .266, 3.05, 0);
  return geometry;
};

export const createRomanEggCarving = (index: number, detail: RomanColumnDetail) => {
  const geometry = new SphereGeometry(1, detail === "high" ? 8 : 4, detail === "high" ? 6 : 2);
  const angle = (index - 3) * .22;
  geometry.scale(.025, .027, .016); geometry.rotateY(angle);
  geometry.translate(Math.sin(angle) * .244, 2.961, Math.cos(angle) * .244);
  return geometry;
};

/** Deterministic vertex patina follows height and stone courses without hiding the actual texture. */
export const colourRomanStone = (geometry: BufferGeometry, tint: readonly number[] = [1, 1, 1]) => {
  const positions = geometry.getAttribute("position"), colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index++) {
    const y = positions.getY(index), shade = .95 + .05 * Math.min(1, y / .4);
    colors[index * 3] = tint[0]! * shade;
    colors[index * 3 + 1] = tint[1]! * shade;
    colors[index * 3 + 2] = tint[2]! * shade;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
};

import { BufferGeometry, DoubleSide, Float32BufferAttribute, MeshStandardMaterial } from "three";

import { catapultWindowBars, catapultWindowContour, type CatapultWindowStyle, type WindowPoint }
  from "../../../render-common/buildings/catapult-window-profiles";

type Point = readonly [number, number, number];
const meshBuilder = () => {
  const positions: number[] = [], uvs: number[] = [], colours: number[] = [];
  const triangle = (a: Point, b: Point, c: Point, colour: readonly number[] = [1, 1, 1]) => {
    const u = b.map((value, axis) => value - a[axis]!), v = c.map((value, axis) => value - a[axis]!);
    if (Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!) < 1e-10) return;
    for (const point of [a, b, c]) {
      positions.push(...point); uvs.push(point[0] + .5, point[1] + .5); colours.push(...colour);
    }
  };
  const quad = (a: Point, b: Point, c: Point, d: Point, colour?: readonly number[]) => {
    triangle(a, b, c, colour); triangle(a, c, d, colour);
  };
  const finish = () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
    geometry.computeVertexNormals(); return geometry;
  };
  return { finish, quad };
};
const at = (point: WindowPoint, depth: number): Point => [point[0], point[1], depth];

/** Joined opaque timber, modeled through its thickness; the hidden back is seated in the wall. */
export const createCatapultWindowFrame = (style: CatapultWindowStyle, detailed: boolean) => {
  const mesh = meshBuilder(), inner = catapultWindowContour(style, detailed);
  let horizontalScale=.40625;
  if(style==="chinese-round")horizontalScale=.4266667;
  const outer = inner.map(([x, y]): WindowPoint => [x / horizontalScale * .5, y / .4266667 * .5]);
  for (let index = 0; index < inner.length; index++) {
    const next = (index + 1) % inner.length;
    const a = inner[index]!, b = inner[next]!, c = outer[index]!, d = outer[next]!;
    mesh.quad(at(c, .5), at(d, .5), at(b, .5), at(a, .5));
    mesh.quad(at(a, .5), at(b, .5), at(b, -.5), at(a, -.5));
    mesh.quad(at(c, -.5), at(d, -.5), at(d, .5), at(c, .5));
  }
  for (const { from, to, width } of catapultWindowBars(style,detailed)) {
    const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
    const x = -dy / length * width / 2, y = dx / length * width / 2;
    const a: WindowPoint = [from[0] - x, from[1] - y], b: WindowPoint = [to[0] - x, to[1] - y];
    const c: WindowPoint = [to[0] + x, to[1] + y], d: WindowPoint = [from[0] + x, from[1] + y];
    mesh.quad(at(a, .5), at(b, .5), at(c, .5), at(d, .5));
    mesh.quad(at(a, -.5), at(b, -.5), at(b, .5), at(a, .5));
    mesh.quad(at(c, -.5), at(d, -.5), at(d, .5), at(c, .5));
    if(style==="chinese-round") {
      mesh.quad(at(d,-.5),at(a,-.5),at(a,.5),at(d,.5));
      mesh.quad(at(b,-.5),at(c,-.5),at(c,.5),at(b,.5));
    }
  }
  return mesh.finish();
};

/** Real wall-depth spandrels convert the conserved rectangular wall void into a fitted arch. */
export const createCatapultWindowReveal = (style: CatapultWindowStyle, detailed: boolean) => {
  const mesh = meshBuilder();
  if (style === "japanese-shoji" || style === "chinese-round") return mesh.finish();
  const arch = catapultWindowContour(style, detailed).slice(2), top = .4266667;
  for (let index = 0; index < arch.length - 1; index++) {
    const a = arch[index]!, b = arch[index + 1]!;
    const c: WindowPoint = [a[0], top], d: WindowPoint = [b[0], top];
    mesh.quad(at(b, .5), at(a, .5), at(c, .5), at(d, .5));
    mesh.quad(at(a, -.5), at(b, -.5), at(d, -.5), at(c, -.5));
    mesh.quad(at(a, .5), at(b, .5), at(b, -.5), at(a, -.5));
  }
  return mesh.finish();
};

/** Four separate coloured panes behind the Persian woodwork; never opaque coloured timber. */
export const createCatapultWindowGlass = () => {
  const mesh = meshBuilder(), palette = [[.68, .075, .045], [.05, .36, .14], [.06, .20, .64], [.83, .56, .06]];
  let index = 0;
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const left = x < 0 ? -.38 : .035, right = x < 0 ? -.035 : .38;
    const bottom = y < 0 ? -.40 : -.075, top = y < 0 ? -.125 : .12;
    mesh.quad([left, bottom, 0], [right, bottom, 0], [right, top, 0], [left, top, 0], palette[index++]);
  }
  return mesh.finish();
};

export const createCatapultWindowGlassMaterial = () => new MeshStandardMaterial({
  color: 0xffffff, depthWrite: false, metalness: .02, opacity: .5, roughness: .22,
  side: DoubleSide, transparent: true, vertexColors: true
});

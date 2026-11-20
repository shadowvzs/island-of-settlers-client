import {
  BufferGeometry, CylinderGeometry, Float32BufferAttribute, RingGeometry
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const colourLinen = (geometry: BufferGeometry, shade = 1) => {
  const colours = new Float32Array(geometry.getAttribute("position").count * 3).fill(shade);
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
};

/** Exposed wound layers are visible at either end, rather than a featureless solid cylinder. */
const linenSpiral = (side: number, detailed: boolean) => {
  const segments = detailed ? 120 : 24;
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let step = 0; step <= segments; step++) {
    const t = step / segments, angle = t * Math.PI * 5;
    const radius = .13 + t * .34;
    for (const edge of [-1, 1]) {
      const r = radius + edge * .005;
      positions.push(side * .451, Math.sin(angle) * r + .005, Math.cos(angle) * r * .5 - .23);
      uv.push(t * 3, edge < 0 ? 0 : 1);
    }
  }
  for (let step = 0; step < segments; step++) {
    const a = step * 2;
    if (side > 0) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return colourLinen(geometry, .48);
};

/** A loose length of linen with shallow wrinkles and woven selvages along its two long edges. */
const unfurledLinen = (detailed: boolean) => {
  const across = detailed ? 18 : 6;
  const profile = [[-.23, -.465], [-.08, -.465], [.10, -.43], [.25, -.37], [.39, -.45], [.49, -.44]];
  const rows = profile.length, sideVertices = (across + 1) * rows;
  const positions: number[] = [], uv: number[] = [], colours: number[] = [], indices: number[] = [];
  for (const side of [-1, 1]) for (let row = 0; row < rows; row++) {
    const [z, y] = profile[row]!;
    for (let column = 0; column <= across; column++) {
      const u = column / across, x = u - .5;
      const progress = row / (rows - 1);
      const ripple = Math.sin(u * 9 + row * 1.1) * .045 * progress;
      const corner = Math.max(0, (u - .55) / .45) * progress * progress;
      positions.push(x * (.94 - .018 * Math.sin(row)), y! + ripple + corner * .20 + side * .012,
        z! + .014 * Math.sin(u * 7 + row) - corner * .13);
      uv.push(u * 1.5, row / (rows - 1) * 1.2);
      const shade = column === 0 || column === across ? .70 : 1;
      colours.push(shade, shade, shade);
    }
  }
  for (let row = 0; row < rows - 1; row++) for (let column = 0; column < across; column++) {
    const a = row * (across + 1) + column, b = a + across + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
    const c = a + sideVertices, d = b + sideVertices;
    indices.push(c, c + 1, d, c + 1, d + 1, d);
  }
  const border: number[] = [];
  for (let column = 0; column <= across; column++) border.push(column);
  for (let row = 1; row < rows; row++) border.push(row * (across + 1) + across);
  for (let column = across - 1; column >= 0; column--) border.push((rows - 1) * (across + 1) + column);
  for (let row = rows - 2; row > 0; row--) border.push(row * (across + 1));
  for (let edge = 0; edge < border.length; edge++) {
    const a = border[edge]!, b = border[(edge + 1) % border.length]!;
    indices.push(a, a + sideVertices, b, b, a + sideVertices, b + sideVertices);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

/** A woven cloth bolt, open around a wooden core, with an unrolled length lying in front. */
export const createLinenBoltGeometry = (detailed: boolean) => {
  const radial = detailed ? 36 : 12;
  const roll = new CylinderGeometry(.48, .48, .9, radial, detailed ? 6 : 1, true);
  roll.rotateZ(Math.PI / 2); roll.scale(1, 1, .5); roll.translate(0, .005, -.23);
  const pieces: BufferGeometry[] = [colourLinen(roll), unfurledLinen(detailed)];
  for (const side of [-1, 1]) {
    const end = new RingGeometry(.12, .48, radial);
    end.rotateY(side * Math.PI / 2); end.scale(1, 1, .5); end.translate(side * .45, .005, -.23);
    pieces.push(colourLinen(end, .90), linenSpiral(side, detailed));
  }
  const merged = mergeGeometries(pieces)!;
  pieces.forEach(geometry => geometry.dispose());
  return merged;
};

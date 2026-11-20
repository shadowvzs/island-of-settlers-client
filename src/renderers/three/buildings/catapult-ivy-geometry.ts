import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { CATAPULT_SHAFT_HEIGHT } from "../../../render-common/buildings/catapult-dimensions";
import { catapultIvyGrowth } from "../../../render-common/buildings/catapult-wall-details";

/** Raised leaf centre and gently recurved margins, independently posed on a real petiole. */
export const createCatapultIvyGeometry = (detailed: boolean) => {
  const growth = catapultIvyGrowth(detailed), pieces: BufferGeometry[] = [];
  for (const stem of growth.stems) {
    const from = new Vector3(...stem.from), to = new Vector3(...stem.to), delta = to.clone().sub(from);
    if (!detailed && stem.radius < .004) {
      const normal = from.clone().add(to); normal.y = 0; normal.normalize();
      const across = delta.clone().cross(normal).normalize().multiplyScalar(stem.radius);
      const points = [from.clone().sub(across), to.clone().sub(across), to.clone().add(across), from.clone().add(across)];
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(points.flatMap(point => point.toArray()), 3));
      geometry.setAttribute("uv", new Float32BufferAttribute([.02, 0, .02, 1, .085, 1, .085, 0], 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
      pieces.push(geometry.toNonIndexed()); geometry.dispose();
      continue;
    }
    const geometry = new CylinderGeometry(stem.radius * .67, stem.radius, delta.length(), 3, 1, true);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()));
    geometry.translate(...from.add(to).multiplyScalar(.5).toArray());
    const uv = geometry.getAttribute("uv");
    for (let index = 0; index < uv.count; index++) uv.setX(index, .02 + uv.getX(index) * .065);
    pieces.push(geometry.toNonIndexed()); geometry.dispose();
  }
  for (const leaf of growth.leaves) {
    // Opaque, lobed physical silhouette. Each fan facet slopes from a raised midrib;
    // the basal sinus is the actual petiole attachment, never a transparent rectangle.
    const outline = detailed ? [[0, -.29], [-.27, -.35], [-.30, -.13], [-.47, .09],
      [-.23, .19], [0, .49], [.23, .19], [.47, .09], [.30, -.13], [.27, -.35]]
      : [[0, -.29], [-.29, -.33], [-.47, .09], [-.22, .19], [0, .49],
        [.22, .19], [.47, .09], [.29, -.33]];
    const vertices = [[0, .02, .14], ...outline.map(([x, y]) =>
      [x!, y!, .018 + Math.abs(x!) * .035 + (y! > .3 ? -.04 : 0)])];
    const positions = vertices.flatMap(([x, y, z]) => [x! * leaf.length, y! * leaf.length, z! * leaf.length]);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(vertices.flatMap(([x, y]) =>
      [.15 + (x! + .5) * .85, y! + .5]), 2));
    const indices: number[] = [];
    for (let edge = 0; edge < outline.length; edge++) indices.push(0, edge + 1, (edge + 1) % outline.length + 1);
    if (detailed) {
      // A narrow sculpted midrib bridges the petiole sinus, folded centre and terminal lobe.
      // Its four faces catch real light independently of the normal-map secondary veins.
      const ridge = [[0, -.29, .018], [-.008, .02, .14], [0, .02, .163],
        [.008, .02, .14], [0, .49, -.022]];
      const first = vertices.length;
      const augmented = [...vertices, ...ridge];
      geometry.setAttribute("position", new Float32BufferAttribute(augmented.flatMap(([x, y, z]) =>
        [x! * leaf.length, y! * leaf.length, z! * leaf.length]), 3));
      geometry.setAttribute("uv", new Float32BufferAttribute(augmented.flatMap(([x, y]) =>
        [.15 + (x! + .5) * .85, y! + .5]), 2));
      for (const triangle of [[0, 1, 2], [0, 2, 3], [4, 2, 1], [4, 3, 2]])
        indices.push(...triangle.map(index => first + index));
    }
    geometry.setIndex(indices);
    geometry.rotateZ(leaf.roll); geometry.rotateY(leaf.angle);
    geometry.translate(...leaf.center); geometry.computeVertexNormals();
    pieces.push(geometry.toNonIndexed()); geometry.dispose();
  }
  const merged = mergeGeometries(pieces, false)!;
  for (const geometry of pieces) geometry.dispose();
  // The renderer applies the declared physical part box; keep exact authored metre positions.
  merged.translate(0, -CATAPULT_SHAFT_HEIGHT / 2, 0);
  merged.scale(1 / 1.7, 1 / CATAPULT_SHAFT_HEIGHT, 1 / 1.7);
  return merged;
};

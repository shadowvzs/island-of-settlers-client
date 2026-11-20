import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from "three";

import { ornamentalNoise, type OrnamentalTreeGraph } from "../../../render-common/plants/ornamental-tree-graph";

/** Closed three-dimensional needles radiate from real twig-bound fascicles in shared batches. */
export const createBonsaiNeedleGeometry = (graph: OrnamentalTreeGraph, detailed = true) => {
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], uvs: number[] = [], indices: number[] = [];
  const up = new Vector3(0, 1, 0);
  const attachmentCurves = new Map<number, CatmullRomCurve3>();
  const attachedStart = (limbIndex: number, tip: number[]) => {
    const limb = graph.limbs[limbIndex]!;
    let curve = attachmentCurves.get(limbIndex);
    if (!curve) {
      curve = new CatmullRomCurve3(limb.path.map(point => new Vector3(...point)));
      attachmentCurves.set(limbIndex, curve);
    }
    const from = new Vector3(...limb.path.at(-2)!), to = new Vector3(...limb.path.at(-1)!);
    const span = to.sub(from), relative = new Vector3(...tip).sub(from);
    const fraction = Math.max(0, Math.min(1, relative.dot(span) / span.lengthSq()));
    return curve.getPoint((limb.path.length - 2 + fraction) / (limb.path.length - 1));
  };
  for (const spray of graph.needles) for (let needle = 0; needle < (detailed ? 8 : 4); needle++) {
    const offset = positions.length / 3;
    const angle = needle * 2.399963 + spray.seed * .31;
    const direction = new Vector3(...spray.direction).normalize().multiplyScalar(.65)
      .add(new Vector3(Math.cos(angle) * .75, .30 + ornamentalNoise(spray.seed + needle) * .45,
        Math.sin(angle) * .75)).normalize();
    const across = direction.clone().cross(up).normalize(), normal = direction.clone().cross(across).normalize();
    const start = attachedStart(spray.limb, spray.tip), length = spray.length;
    const shade = .78 + ornamentalNoise(spray.seed * 3 + needle) * .34;
    const side = needle % 2 === 0 ? -1 : 1;
    for (let corner = 0; corner < 3; corner++) {
      const angle = corner / 3 * Math.PI * 2;
      const radial = across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(normal, Math.sin(angle));
      positions.push(...start.clone().addScaledVector(radial, .00085).toArray());
      normals.push(...radial.toArray()); colours.push(shade, shade, shade); uvs.push(corner / 3, 0);
    }
    const tip = start.clone().addScaledVector(direction, length).addScaledVector(across, side * length * .27);
    positions.push(...tip.toArray()); normals.push(...direction.toArray());
    colours.push(shade, shade, shade); uvs.push(.5, 1);
    indices.push(offset, offset + 1, offset + 3, offset + 1, offset + 2, offset + 3,
      offset + 2, offset, offset + 3);
    const cap = positions.length / 3;
    for (let corner = 0; corner < 3; corner++) {
      const source = (offset + corner) * 3;
      positions.push(positions[source]!, positions[source + 1]!, positions[source + 2]!);
      normals.push(...direction.clone().negate().toArray()); colours.push(shade, shade, shade); uvs.push(.5, .5);
    }
    indices.push(cap, cap + 2, cap + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

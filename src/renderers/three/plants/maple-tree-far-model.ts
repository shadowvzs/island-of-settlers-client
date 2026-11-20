import { BufferGeometry, CatmullRomCurve3, Euler, Float32BufferAttribute, Matrix4, Vector3 } from "three";

import type { OrnamentalTreeGraph } from "../../../render-common/plants/ornamental-tree-graph";

interface Surface {
  colours: number[];
  indices: number[];
  normals: number[];
  positions: number[];
  uvs: number[];
}
const surface = (): Surface => ({ colours: [], indices: [], normals: [], positions: [], uvs: [] });
const geometryOf = (source: Surface) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(source.positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(source.normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(source.colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(source.uvs, 2));
  geometry.setIndex(source.indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** Retain every main bearing, control-node position and root; omit only subpixel twig topology. */
const woodySurface = (graph: OrnamentalTreeGraph, includeSecondary = false) => {
  const output = surface();
  for (const limb of graph.limbs) {
    if (limb.role === "twig") continue;
    if (!includeSecondary && limb.role === "branch" && limb.parent !== 0 &&
      graph.limbs[limb.parent!]!.parent !== 0) continue;
    let sides = 4;
    if (limb.role === "trunk") sides = 6;
    if (limb.role === "root" || limb.radius < .04) sides = 3;
    const curve = new CatmullRomCurve3(limb.path.map(point => new Vector3(...point)));
    const last = limb.path.length - 1, frames = curve.computeFrenetFrames(last, false);
    const lengths = curve.getLengths(last * 20), length = lengths.at(-1)!;
    const offset = output.positions.length / 3;
    for (let node = 0; node <= last; node++) {
      const t = lengths[node * 20]! / length, centre = new Vector3(...limb.path[node]!);
      const radius = limb.radius * (1 - t) ** .95 + limb.tipRadius * t;
      for (let side = 0; side <= sides; side++) {
        const angle = side / sides * Math.PI * 2;
        const normal = frames.normals[node]!.clone().multiplyScalar(Math.cos(angle))
          .addScaledVector(frames.binormals[node]!, Math.sin(angle));
        output.positions.push(...centre.clone().addScaledVector(normal, radius).toArray());
        output.normals.push(...normal.toArray());
        const shade = .86 + .09 * Math.cos(angle * 3 + t * 4);
        output.colours.push(shade, shade, shade); output.uvs.push(side / sides, t * length * 4);
        if (node === last || side === sides) continue;
        const a = offset + node * (sides + 1) + side, b = a + sides + 1;
        output.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    // Connected start caps remain buried in the parent; root tips are below the terrain.
    if (limb.role === "root") continue;
    const centre = output.positions.length / 3;
    output.positions.push(...limb.path[last]!); output.normals.push(...frames.tangents[last]!.toArray());
    output.colours.push(.7, .65, .56); output.uvs.push(.5, .5);
    const end = offset + last * (sides + 1);
    for (let side = 0; side < sides; side++) output.indices.push(centre, end + side, end + side + 1);
  }
  return geometryOf(output);
};

/** All764 leaf poses/sizes remain; only their folded outline moves into the canonical alpha mask. */
const leafSurface = (graph: OrnamentalTreeGraph) => {
  const output = surface();
  const pose = new Matrix4(), point = new Vector3(), normal = new Vector3();
  for (const leaf of graph.leaves) {
    const offset = output.positions.length / 3;
    pose.makeRotationFromEuler(new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ"));
    normal.set(0, 1, 0).transformDirection(pose);
    for (const [x, z] of [[-.5, 0], [.5, 0], [.5, 1], [-.5, 1]]) {
      point.set(x! * leaf.width, 0, z! * leaf.length).applyMatrix4(pose);
      output.positions.push(point.x + leaf.position[0], point.y + leaf.position[1], point.z + leaf.position[2]);
      output.normals.push(...normal.toArray());
      const shade = .90 + Math.sin(leaf.seed * 2.17) * .035;
      output.colours.push(shade, shade, shade); output.uvs.push(x! + .5, z!);
    }
    output.indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
  }
  return geometryOf(output);
};

export const createMapleFarSurfaces = (graph: OrnamentalTreeGraph) =>
  ({ bark: woodySurface(graph), foliage: leafSurface(graph) });

/** Minimal retains every true control-point bearing, including secondary branches, with cheap radial sections. */
export const createMapleMinimalWood = (graph: OrnamentalTreeGraph) => woodySurface(graph, true);

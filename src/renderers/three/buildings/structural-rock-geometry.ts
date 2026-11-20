import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, OctahedronGeometry, Vector3 } from "three";

/** Lean natural boulder: exposed fracture planes, chipped silhouette and a grounded base in both LODs. */
export const createStructuralRockGeometry = (detailed: boolean, variant = 0, facets?: 8 | 20 | 80, buriedBack = false) => {
  const subdivisions = (facets ?? (detailed ? 80 : 20)) === 80 ? 1 : 0;
  let geometry: BufferGeometry = facets === 8 ? new OctahedronGeometry(.5, 0) :
    new IcosahedronGeometry(.5, subdivisions);
  if (buriedBack) {
    // A broad fractured hexagonal bearing face avoids diamond spikes in coarse masonry.
    // Its back is fully bonded into the opaque mortar rather than wasting hidden triangles.
    const outline = [[-.50,-.30,.04],[-.30,-.50,0],[.41,-.41,.035],
      [.50,.25,.01],[.24,.50,.025],[-.45,.36,.07]];
    const points: number[] = [], uvs: number[] = [];
    for(let triangle=1;triangle<outline.length-1;triangle++)for(const at of [0,triangle,triangle+1]) {
      const point=outline[at]!;points.push(...point);uvs.push(point[0]!+.5,point[1]!+.5);
    }
    geometry.dispose(); geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  }
  const positions = geometry.getAttribute("position"), colours = new Float32Array(positions.count * 3);
  const phase = variant * 1.317;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const bulge = 1 + .19 * Math.sin(x * 8 + z * 5 + phase) + .09 * Math.cos(y * 9 - x * 4 - phase);
    let px = x * bulge, py = y * bulge, pz = z * bulge;
    const chip = px + py * .6 - pz * .35 - .36;
    if (chip > 0) { px -= chip / 1.4825; py -= chip * .6 / 1.4825; pz += chip * .35 / 1.4825; }
    py = Math.max(-.34 + px * .08, py);
    pz = Math.max(-.37 - px * .15, pz);
    positions.setXYZ(index, px, py, pz);
    const shade = .79 + .15 * (.5 + .5 * Math.sin(x * 79 + y * 91 + z * 67 + phase));
    colours.set([shade * 1.015, shade, shade * .96], index * 3);
  }
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new Vector3()), center = geometry.boundingBox!.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z); geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

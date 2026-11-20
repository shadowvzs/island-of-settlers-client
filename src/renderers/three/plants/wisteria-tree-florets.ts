import { BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh,
  type MeshStandardMaterial, Object3D, SRGBColorSpace, TetrahedronGeometry, Vector3 } from "three";

import type { WisteriaTreeGraph } from "../../../render-common/plants/wisteria-tree-graph";
import type { WisteriaFlowerInstance } from "../../../render-common/wisteria-hero-graph";
import { mapWisteriaAtlasVertices } from "../wisteria-botanical-atlas";
import { mapWisteriaBudAtlas } from "../wisteria-botanical-atlas-geometry";
import { WISTERIA_BANNER_CENTER, WISTERIA_BANNER_OUTLINE } from "../wisteria-petal-sheets";

type Point = readonly [number, number, number];
export const WISTERIA_TREE_FLORET_BEARING = [0, .06, .10] as const;

/** Ten triangles retain a cupped banner, two separate wings and the folded keel. */
export const createWisteriaTreeFloretGeometry = () => {
  // Keep both broad upper lobes. Only the inward notch vertex is omitted; actual alpha retains the cleft.
  const outline = WISTERIA_BANNER_OUTLINE.filter((_, index) => index !== 4);
  const points: Point[] = [WISTERIA_BANNER_CENTER, ...outline];
  const indices = outline.flatMap((_, index) => [0, index + 1, (index + 1) % outline.length + 1]);
  for (const side of [-1, 1]) {
    const offset = points.length;
    points.push([side * .08, .035, .09], [side * .34, -.10, .27], [side * .035, -.29, .34]);
    indices.push(offset, offset + 1, offset + 2);
  }
  points.push([0, -.36, .46], [-.10, -.03, .18], [.10, -.03, .18]);
  indices.push(14, 15, 16);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(points.length * 2), 2));
  const colours = points.flatMap((_, index) => {
    let shade = .88;
    if (index < 8) shade = .97;
    if (index >= 14) shade = .84;
    return [shade, shade, shade];
  });
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  mapWisteriaAtlasVertices(geometry, "banner", 0, 8, vertex =>
    [(points[vertex]![0] + .48) / .96, (points[vertex]![1] - .06) / .59]);
  for (const [first, sign] of [[8, -1], [11, 1]] as const)
    mapWisteriaAtlasVertices(geometry, "wing", first, 3, vertex =>
      [(points[vertex]![0] * sign - .035) / .305, (points[vertex]![1] + .29) / .325]);
  mapWisteriaAtlasVertices(geometry, "keel", 14, 3, vertex =>
    [(points[vertex]![0] + .10) / .20, (points[vertex]![1] + .36) / .33]);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** All128 supported clusters stay in the crown; reduced clusters retain eleven florets and a terminal bud. */
export const reducedWisteriaTreeFlowers = (graph: WisteriaTreeGraph, fullRacemes: ReadonlySet<number>) => {
  const selected = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 19, 24]);
  return graph.flowers.filter((flower, index) => !fullRacemes.has(flower.cluster!) && selected.has(index % 25));
};

/** Ends on the actual lower banner vertex, rather than leaving an absent calyx gap. */
export const wisteriaTreeFloretBearing = (flower: WisteriaFlowerInstance) => {
  if (flower.bud) return new Vector3(...flower.position);
  const transform = new Object3D();
  transform.position.set(...flower.position); transform.rotation.set(flower.tilt ?? .8, flower.yaw, 0);
  transform.scale.setScalar(flower.scale); transform.updateMatrix();
  return new Vector3(...WISTERIA_TREE_FLORET_BEARING).applyMatrix4(transform.matrix);
};

/** A submillimetre pedicel joins the dimensional spine to the real flower tissue with one two-sided face. */
export const createWisteriaTreePedicel = (first: Point, last: Point, radius: number) => {
  const base = new Vector3(...first), tip = new Vector3(...last), axis = tip.clone().sub(base);
  if (axis.lengthSq() < 1e-12) return null;
  const right = new Vector3().crossVectors(axis, new Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
  right.normalize().multiplyScalar(radius);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([
    base.x - right.x, base.y - right.y, base.z - right.z,
    tip.x, tip.y, tip.z, base.x + right.x, base.y + right.y, base.z + right.z
  ], 3));
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, .5, 1, 1, 0], 2));
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(9).fill(1), 3));
  geometry.setIndex([0, 1, 2]); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** Fully dimensional nearby racemes; this helper never instantiates a whole-raceme card. */
export const addWisteriaTreeFlorets = (root: Group, flowers: readonly WisteriaFlowerInstance[],
  materials: { petal: MeshStandardMaterial },
  palette: readonly [number, number, number], owned: BufferGeometry[]) => {
  if (!flowers.length) return () => undefined;
  const petals = createWisteriaTreeFloretGeometry();
  const bud = new TetrahedronGeometry(Math.sqrt(3), 0);
  bud.scale(.13, .31, .13); bud.translate(0, -.10, .02);
  bud.setAttribute("color", new Float32BufferAttribute(new Float32Array(bud.getAttribute("position").count * 3).fill(1), 3));
  mapWisteriaBudAtlas(bud);
  owned.push(petals, bud);
  const open = flowers.filter(flower => !flower.bud), closed = flowers.filter(flower => flower.bud);
  const meshes = [new InstancedMesh(petals, materials.petal, open.length),
    new InstancedMesh(bud, materials.petal, closed.length)];
  meshes[0]!.name = "wisteria_tree_reduced_individual_florets";
  meshes[1]!.name = "wisteria_tree_reduced_terminal_buds";
  const transform = new Object3D(), colour = new Color();
  for (const [mesh, instances] of [[meshes[0]!, open], [meshes[1]!, closed]] as const)
    instances.forEach((flower, index) => {
      transform.position.set(...flower.position); transform.rotation.set(flower.tilt ?? .8, flower.yaw, 0);
      transform.scale.setScalar(flower.scale); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
      const variation = .95 + index % 5 * .012;
      colour.setRGB(palette[0] * variation, palette[1] * variation, palette[2] * variation, SRGBColorSpace);
      mesh.setColorAt(index, colour);
    });
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); root.add(mesh);
  }
  return () => meshes.forEach(mesh => mesh.dispose());
};

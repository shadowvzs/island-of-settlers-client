import {
  BufferGeometry, DataTexture, DoubleSide, Euler, Float32BufferAttribute, Group, LinearFilter,
  LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector3
} from "three";

import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";
import { createRoadsideShrubGraph, ROAD_SHRUB_FAR_CLUSTER_HALF_SIZE } from "../../../render-common/plants/roadside-shrub-graph";
import { createBonsaiPotGeometries } from "./bonsai-pot-geometry";
import { createOrnamentalShootGeometry } from "./ornamental-shoot-geometry";
import { createShrubFlowerGeometry } from "./roadside-shrub-foliage";
import type { createRoadsideShrubMaterials } from "./roadside-shrub-materials";
import { mergeShrubGeometry } from "./roadside-shrub-model";
import { createShrubSoilGeometry, fitShrubPotUvs } from "./roadside-shrub-pot";

type Materials = ReturnType<typeof createRoadsideShrubMaterials>["materials"];

/** Overlapping small oval leaves reuse the actual near texture, never a solid canopy proxy. */
const createClusterAtlas = (leafMap: DataTexture) => {
  const size = 256, pixels = new Uint8Array(size * size * 4), source = leafMap.image.data as Uint8Array;
  for (let leaf = 0; leaf < 18; leaf++) {
    const seed = leaf * 47 + 109, angle = leaf * 2.399963;
    const cx = 128 + Math.cos(angle) * (30 + ornamentalNoise(seed) * 58);
    const cy = 128 + Math.sin(angle) * (30 + ornamentalNoise(seed + 3) * 58);
    const length = 110 + ornamentalNoise(seed + 11) * 13, width = length * .58;
    const cosine = Math.cos(angle + .4), sine = Math.sin(angle + .4);
    for (let y = Math.max(0, Math.floor(cy - length)); y < Math.min(size, cy + length); y++)
      for (let x = Math.max(0, Math.floor(cx - length)); x < Math.min(size, cx + length); x++) {
        const dx = x - cx, dy = y - cy;
        const u = (dx * cosine + dy * sine) / width + .5;
        const v = (-dx * sine + dy * cosine) / length + .5;
        if (v <= 0 || v >= 1) continue;
        const edge = Math.sqrt(Math.max(0, 1 - (1 - 2 * v) ** 2)) * .5 * (1.08 - .16 * v);
        if (Math.abs(u - .5) > edge) continue;
        const from = (Math.min(255, Math.floor(v * 256)) * 256 + Math.min(255, Math.floor(u * 256))) * 4;
        const to = (y * size + x) * 4, shade = .73 + ornamentalNoise(seed + 23) * .21;
        pixels[to] = source[from]! * shade; pixels[to + 1] = source[from + 1]! * shade;
        pixels[to + 2] = source[from + 2]! * shade; pixels[to + 3] = 255;
      }
  }
  const atlas = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  atlas.colorSpace = SRGBColorSpace; atlas.magFilter = LinearFilter;
  atlas.minFilter = LinearMipmapLinearFilter; atlas.generateMipmaps = true; atlas.needsUpdate = true;
  return atlas;
};

/** Borrows near surfaces. Only the far leaf material and optionally its shared atlas are owned. */
export const createRoadsideShrubFarMaterials = (near: Materials, borrowedAtlas?: DataTexture) => {
  const atlas = borrowedAtlas ?? createClusterAtlas(near.foliage.map as DataTexture);
  const foliage = new MeshStandardMaterial({ map: atlas, alphaTest: .40, side: DoubleSide,
    color: near.foliage.color, emissive: near.foliage.emissive, emissiveIntensity: near.foliage.emissiveIntensity,
    roughness: near.foliage.roughness, vertexColors: true });
  let disposed = false;
  return { atlas, materials: { ...near, foliage }, dispose: () => {
    if (disposed) return;
    disposed = true; foliage.dispose();
    if (!borrowedAtlas) { atlas.dispose(); atlas.image.data = null; }
  } };
};

const clusterGeometry = (graph: ReturnType<typeof createRoadsideShrubGraph>) => {
  const positions: number[] = [], uv: number[] = [], colours: number[] = [], indices: number[] = [];
  for (let shoot = 0; shoot < 64; shoot++) {
    const leaf = graph.leaves[shoot * 10 + 5]!, rotation = new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ");
    const centre = new Vector3(...leaf.position), up = new Vector3(0, 0, 1).applyEuler(rotation);
    const right = new Vector3(1, 0, 0).applyEuler(rotation), normal = new Vector3(0, 1, 0).applyEuler(rotation);
    for (const side of [right, normal]) {
      const offset = positions.length / 3;
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const point = centre.clone().addScaledVector(side, x! * ROAD_SHRUB_FAR_CLUSTER_HALF_SIZE)
          .addScaledVector(up, y! * ROAD_SHRUB_FAR_CLUSTER_HALF_SIZE);
        positions.push(...point.toArray()); uv.push((x! + 1) / 2, (y! + 1) / 2); colours.push(.94, 1, .91);
      }
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
};

/** Far foliage preserves actual oval leaf clusters, branch bearings, pot profile and palette. */
export const createRoadsideShrubFarModel = (materials: Materials, variant = 0, potted = false) => {
  const graph = createRoadsideShrubGraph(variant, false, potted), root = new Group();
  root.name = `roadside-shrub-far-${variant}`;
  const surfaces: Record<keyof Materials, BufferGeometry[]> = { bark: [], ceramic: [], flowers: [],
    foliage: [clusterGeometry(graph)], soil: [] };
  surfaces.bark = graph.limbs.filter(limb => limb.role !== "twig").map(limb =>
    createOrnamentalShootGeometry({ ...limb, path: [limb.path[0]!, limb.path[Math.floor(limb.path.length / 2)]!, limb.path.at(-1)!] }));
  surfaces.flowers = graph.blossoms.filter((_, index) => index % 8 === 0).map(flower => createShrubFlowerGeometry(flower, false));
  if (graph.pot) {
    const pot = createBonsaiPotGeometries(graph.pot, false); pot.soil.dispose();
    for (const part of pot.ceramic) fitShrubPotUvs(part, graph.pot);
    surfaces.ceramic = pot.ceramic; surfaces.soil = [createShrubSoilGeometry(graph.pot, false)];
  }
  const owned: BufferGeometry[] = [], counts = { bark: 0, ceramic: 0, flowers: 0, foliage: 0, soil: 0 };
  for (const surface of Object.keys(surfaces) as (keyof Materials)[]) {
    if (!surfaces[surface].length) continue;
    const geometry = mergeShrubGeometry(surfaces[surface]); owned.push(geometry);
    counts[surface] = geometry.getAttribute("position").count / 3;
    const mesh = new Mesh(geometry, materials[surface]); mesh.name = surface; root.add(mesh);
  }
  let disposed = false;
  return { root, graph, counts, triangles: Object.values(counts).reduce((a, b) => a + b, 0), dispose: () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear(); owned.forEach(geometry => geometry.dispose());
  } };
};

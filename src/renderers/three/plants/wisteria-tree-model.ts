import { type BufferGeometry, ClampToEdgeWrapping,   Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4,
Mesh, type MeshStandardMaterial, Object3D, PlaneGeometry, SRGBColorSpace, type Texture, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createWisteriaTreeGraph, type WisteriaTreeGraph } from "../../../render-common/plants/wisteria-tree-graph";
import { mapWisteriaBudAtlas, mapWisteriaFlowerAtlas, mapWisteriaLeafAtlas } from "../wisteria-botanical-atlas-geometry";
import { createWisteriaBotanicalTemplates } from "../wisteria-botanical-templates";
import type { WisteriaLodAtlasMetadata } from "../wisteria-lod-atlas";
import { createWisteriaMinimalTemplates } from "../wisteria-minimal-templates";
import { createWisteriaPetioleGeometry } from "../wisteria-petiole-geometry";
import { createWisteriaPopulationTemplates } from "../wisteria-population-templates";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";
import { createWisteriaTreeBark } from "./wisteria-tree-bark";
import { addWisteriaTreeFlorets, createWisteriaTreePedicel, reducedWisteriaTreeFlowers,
  wisteriaTreeFloretBearing } from "./wisteria-tree-florets";

export type WisteriaTreeTier = "near" | "far";
/** Tree-only High quality exception; the selector still enforces the shared60knear/100ktotal ceiling. */
export const WISTERIA_TREE_BUDGET = Object.freeze({ high: 30000, minimal: 6000, far: 2400 });

/** The map/quality owner transfers one independently owned atlas texture to this shared pack. */
export const createWisteriaTreeMaterials = (detailed: boolean, atlas: Texture,
  metadata: WisteriaLodAtlasMetadata, tissue: Texture) => {
  const real = createWisteriaBotanicalTemplates({ lean: !detailed });
  const distant = createWisteriaMinimalTemplates(atlas, metadata);
  const bark = createWisteriaTreeBark(detailed);
  packCanonicalTissue(real, tissue);
  real.materials.bark.map = bark.map; real.materials.bark.normalMap = bark.normalMap;
  real.materials.bark.color.set("#b8b0a3");
  real.materials.calyx.side = DoubleSide;
  const materials = new Map<string, MeshStandardMaterial>();
  let disposed = false;
  const flattened = (material: MeshStandardMaterial) => {
    if (disposed) throw new Error("Wisteria tree materials are disposed");
    let cached = materials.get(material.uuid);
    if (!cached) {
      cached = material.clone(); cached.vertexColors = true; materials.set(material.uuid, cached);
    }
    return cached;
  };
  return { real, distant, flattened, dispose: () => {
    if (disposed) return;
    disposed = true;
    for (const material of materials.values()) material.dispose();
    materials.clear(); real.dispose(); distant.dispose(); bark.dispose(); tissue.dispose(); tissue.image = null;
  } };
};
export type WisteriaTreeMaterials = ReturnType<typeof createWisteriaTreeMaterials>;

/** Map existing neutral tissue to the original surfaces without changing shared arch templates. */
const packCanonicalTissue = (real: ReturnType<typeof createWisteriaBotanicalTemplates>, tissue: Texture) => {
  tissue.colorSpace = SRGBColorSpace; tissue.wrapS = tissue.wrapT = ClampToEdgeWrapping;
  tissue.magFilter = LinearFilter; tissue.minFilter = LinearMipmapLinearFilter;
  tissue.generateMipmaps = true; tissue.needsUpdate = true;
  const guide = real.instantiate([], []);
  guide.root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    if (node.name === "wisteria_open_petals") mapWisteriaFlowerAtlas(node.geometry);
    if (node.name === "wisteria_pinnate_leaflets") mapWisteriaLeafAtlas(node.geometry);
    if (node.name === "wisteria_closed_buds") mapWisteriaBudAtlas(node.geometry);
  });
  guide.dispose();
  for (const material of [real.materials.petal, real.materials.leaf]) {
    material.map = tissue; material.normalMap = null; material.bumpMap = tissue;
    material.bumpScale = .002; material.alphaTest = .22;
  }
};

const woodTopology = (role: WisteriaTreeGraph["limbs"][number]["role"],
  detailed: boolean, tier: WisteriaTreeTier) => {
  if (tier === "far") {
    if (role === "trunk") return { rings: 7, sides: 5 };
    if (role === "root") return { rings: 2, sides: 3 };
    return { rings: 3, sides: 3 };
  }
  if (role === "trunk") return { rings: detailed ? 12 : 8, sides: detailed ? 7 : 6 };
  if (role === "root") return { rings: detailed ? 5 : 3, sides: detailed ? 5 : 3 };
  if (role === "branch") return { rings: detailed ? 8 : 4, sides: detailed ? 6 : 4 };
  return { rings: detailed ? 4 : 2, sides: detailed ? 4 : 3 };
};

const addWood = (root: Group, graph: WisteriaTreeGraph, pack: WisteriaTreeMaterials,
  detailed: boolean, tier: WisteriaTreeTier, owned: BufferGeometry[]) => {
  const pieces: BufferGeometry[] = [];
  graph.limbs.forEach((limb, index) => {
    if (tier === "far" && limb.role === "twig") return;
    const geometry = createOrnamentalWoodGeometry(limb, detailed, index, woodTopology(limb.role, detailed, tier));
    if (limb.role === "root" || limb.role === "trunk") {
      const position = geometry.getAttribute("position");
      for (let vertex = 0; vertex < position.count; vertex++)
        position.setY(vertex, Math.max(0, position.getY(vertex)));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    }
    pieces.push(geometry);
  });
  const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose());
  if (!geometry) throw new Error("Wisteria tree wood could not merge");
  owned.push(geometry);
  const mesh = new Mesh(geometry, pack.real.materials.bark); mesh.name = "wisteria_tree_twined_wood";
  root.add(mesh);
};

const selectedRacemes = (detailed: boolean, tier: WisteriaTreeTier, graph: WisteriaTreeGraph) => {
  if (tier === "far") return new Set<number>();
  const amount = detailed ? 2 : 3, selected = new Set<number>();
  const directions = [[2, 1], [0, -1], [0, 1], [2, -1]] as const;
  for (const [axis, sign] of directions.slice(0, amount)) {
    const outer = graph.flowers.reduce((best, flower) =>
      flower.position[axis] * sign > best.position[axis] * sign ? flower : best);
    selected.add(outer.cluster!);
  }
  for (let index = 0; selected.size < amount; index++) selected.add(index);
  return selected;
};
const selectedSprays = (detailed: boolean, tier: WisteriaTreeTier, graph: WisteriaTreeGraph) => {
  if (tier === "far") return new Set<number>();
  const count = graph.sprayBearings.length;
  if (detailed) return new Set(Array.from({ length: count }, (_, index) => index));
  // Put scarce true Minimal leaflets at the actual outer crown, where close inspection can see them.
  const selected = new Set<number>();
  for (const [axis, sign] of [[0, -1], [0, 1], [2, -1], [2, 1]] as const) {
    const outer = graph.leaves.reduce((best, leaf) =>
      leaf.position[axis] * sign > best.position[axis] * sign ? leaf : best);
    selected.add(outer.spray!);
  }
  for (let index = 0; selected.size < 4; index++) selected.add(index);
  return selected;
};

/** Individual tissue-mapped leaflets retain true compound-leaf proportions in every tree tier. */
const addFoliage = (root: Group, graph: WisteriaTreeGraph, pack: WisteriaTreeMaterials,
  sprays: ReadonlySet<number>, owned: BufferGeometry[]) => {
  const geometry = new PlaneGeometry(.42, 1); geometry.translate(0, .5, 0);
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(12).fill(1), 3));
  mapWisteriaLeafAtlas(geometry); owned.push(geometry);
  const leaves = graph.leaves.filter(leaf => sprays.has(leaf.spray!));
  const mesh = new InstancedMesh(geometry, pack.real.materials.leaf, leaves.length);
  mesh.name = "wisteria_tree_individual_veined_leaflets";
  const transform = new Object3D(), direction = new Vector3(), right = new Vector3(), normal = new Vector3();
  const up = new Vector3(0, 1, 0), basis = new Matrix4(), colour = new Color();
  leaves.forEach((leaf, index) => {
    direction.set(...leaf.direction).normalize(); right.crossVectors(direction, up).normalize();
    normal.crossVectors(right, direction).normalize(); basis.makeBasis(right, direction, normal);
    transform.position.set(...leaf.position); transform.quaternion.setFromRotationMatrix(basis);
    transform.rotateY(leaf.roll ?? 0); transform.scale.setScalar(leaf.length * 1.12); transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    colour.setRGB(.57 * leaf.shade, .75 * leaf.shade, .36 * leaf.shade, SRGBColorSpace);
    mesh.setColorAt(index, colour);
  });
  root.add(mesh);
  const rachises: BufferGeometry[] = [];
  for (const spray of sprays) {
    const compound = graph.leaves.filter(leaf => leaf.spray === spray);
    rachises.push(createWisteriaPetioleGeometry(compound[0]!.sprayOrigin!, compound.at(-1)!.position, .0018));
  }
  const rachis = rachises.length ? mergeGeometries(rachises) : null; rachises.forEach(piece => piece.dispose());
  if (rachis) { owned.push(rachis); root.add(new Mesh(rachis, pack.real.materials.calyx)); }
  return () => mesh.dispose();
};

const addFineBearings = (root: Group, graph: WisteriaTreeGraph, pack: WisteriaTreeMaterials,
  racemes: ReadonlySet<number>, owned: BufferGeometry[],
  reduced: ReadonlyArray<WisteriaTreeGraph["flowers"][number]> = []) => {
  const pieces: BufferGeometry[] = [];
  const petiole = (first: readonly [number, number, number], last: readonly [number, number, number], radius: number) => {
    if (new Vector3(...first).distanceToSquared(new Vector3(...last)) > 1e-12)
      pieces.push(createWisteriaPetioleGeometry(first, last, radius));
  };
  graph.racemeBearings.forEach(bearing => {
    petiole(graph.limbs[bearing.limb]!.path[bearing.point]!, bearing.origin, .0018);
  });
  const represented = [...graph.flowers.filter(flower => racemes.has(flower.cluster!)), ...reduced];
  const clusters = new Set(represented.map(flower => flower.cluster!));
  for (const cluster of clusters) {
    const flowers = represented.filter(flower => flower.cluster === cluster);
    const first = flowers[0]!, last = flowers.at(-1)!;
    const start = new Vector3(...first.position), end = new Vector3(...last.position);
    const spineStart = first.clusterOrigin!;
    petiole(spineStart, [end.x, end.y, end.z], .0018);
    for (const [index, flower] of flowers.entries()) {
      let fraction = index / (flowers.length - 1);
      if (!racemes.has(cluster)) fraction = (flower.position[1] - start.y) / (end.y - start.y);
      const axis = start.clone().lerp(end, fraction);
      if (racemes.has(cluster)) petiole([axis.x, axis.y, axis.z], flower.position, .00065);
      else {
        const tip = wisteriaTreeFloretBearing(flower);
        const geometry = createWisteriaTreePedicel([axis.x, axis.y, axis.z], [tip.x, tip.y, tip.z], .00065);
        if (geometry) pieces.push(geometry);
      }
    }
  }
  if (!pieces.length) return;
  const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose());
  if (!geometry) throw new Error("Wisteria tree fine bearings could not merge");
  owned.push(geometry);
  const mesh = new Mesh(geometry, pack.real.materials.calyx); mesh.name = "wisteria_tree_actual_botanical_bearings";
  root.add(mesh);
};

/** High nearby racemes are all dimensional; Minimal and far retain inexpensive original botanical captures. */
export const createWisteriaTreeModel = (pack: WisteriaTreeMaterials, detailed: boolean, variant = 0,
  tier: WisteriaTreeTier = "near", palette: readonly [number, number, number] = [.93, .80, 1]) => {
  const graph = createWisteriaTreeGraph(variant), source = new Group(), owned: BufferGeometry[] = [];
  const racemes = selectedRacemes(detailed, tier, graph);
  const sprays = selectedSprays(detailed, tier, graph);
  const allDimensional = detailed && tier === "near";
  const reduced = allDimensional ? reducedWisteriaTreeFlowers(graph, racemes) : [];
  const real = pack.real.instantiate(graph.flowers.filter(flower => racemes.has(flower.cluster!)),
    [], palette);
  const distant = pack.distant.instantiate(allDimensional ? [] : graph.flowers.filter(flower => !racemes.has(flower.cluster!)),
    detailed && tier === "near" ? [] : graph.leaves.filter(leaf => !sprays.has(leaf.spray!) &&
      (tier !== "far" || leaf.spray! % 2 === 0)), palette);
  source.add(real.root, distant.root);
  const releaseFlorets = addWisteriaTreeFlorets(source, reduced, pack.real.materials, palette, owned);
  const releaseFoliage = addFoliage(source, graph, pack, sprays, owned);
  addWood(source, graph, pack, detailed, tier, owned);
  if (tier === "near") addFineBearings(source, graph, pack, racemes, owned, reduced);
  source.traverse(node => {
    if (!(node instanceof Mesh) || Array.isArray(node.material)) return;
    node.material = pack.flattened(node.material as MeshStandardMaterial);
  });
  const population = createWisteriaPopulationTemplates({ root: source, dispose: () => {
    real.dispose(); distant.dispose(); releaseFlorets(); releaseFoliage();
    owned.forEach(geometry => geometry.dispose()); source.clear();
  } }, () => false);
  const instance = population.create(1); instance.set(0, new Matrix4()); instance.commit();
  instance.root.name = `wisteria_tree_${graph.variant}_${tier}`;
  for (const child of instance.root.children) {
    if (!(child instanceof Mesh)) continue;
    child.castShadow = tier === "near"; child.receiveShadow = true;
  }
  let disposed = false;
  const visibleFlowers = graph.flowers.filter(flower => !flower.bud && racemes.has(flower.cluster!));
  const visibleLeaves = graph.leaves.filter(leaf => sprays.has(leaf.spray!));
  visibleFlowers.sort((first, last) => last.position[2] - first.position[2]);
  const frontCluster = visibleFlowers[0]?.cluster;
  const frontFlowers = graph.flowers.filter(flower => !flower.bud && flower.cluster === frontCluster);
  visibleLeaves.sort((first, last) => last.position[2] - first.position[2]);
  return { root: instance.root, triangles: population.triangles,
    inspection: { flower: (frontFlowers.at(-1) ?? graph.flowers[0])!.position,
      leaf: (visibleLeaves[3] ?? graph.leaves[0])!.position },
    counts: { racemes: graph.racemeBearings.length, compoundLeaves: graph.sprayBearings.length,
      fullRacemes: racemes.size, realRacemes: allDimensional ? graph.racemeBearings.length : racemes.size,
      reducedFlorets: reduced.filter(flower => !flower.bud).length,
      realCompoundLeaves: sprays.size },
    dispose: () => {
      if (disposed) return;
      disposed = true; instance.dispose(); population.dispose();
    } };
};

/** Actual tree botany before flattening, solely for the original albedo/alpha LOD bake. */
export const createWisteriaTreeBakeSource = (pack: WisteriaTreeMaterials) => {
  const graph = createWisteriaTreeGraph(0), cluster = 0, sprayId = 0;
  // Match the representative eleven-floret High cluster across the atlas transition.
  // The two full-anatomy close inspection heroes remain exclusive to the near tier.
  const flowers = reducedWisteriaTreeFlowers(graph, new Set()).filter(flower => flower.cluster === cluster);
  const leaves = graph.leaves.filter(leaf => leaf.spray === sprayId);
  const raceme = new Group(), spray = new Group(), owned: BufferGeometry[] = [];
  const releaseFlowers = addWisteriaTreeFlorets(raceme, flowers, pack.real.materials, [1, 1, 1], owned);
  const releaseFoliage = addFoliage(spray, graph, pack, new Set([sprayId]), owned);
  const flowerSpine = createWisteriaPetioleGeometry(flowers[0]!.clusterOrigin!, flowers.at(-1)!.position, .0018);
  owned.push(flowerSpine); raceme.add(new Mesh(flowerSpine, pack.real.materials.calyx));
  const start = new Vector3(...flowers[0]!.position), end = new Vector3(...flowers.at(-1)!.position);
  for (const flower of flowers) {
    const fraction = (flower.position[1] - start.y) / (end.y - start.y);
    const base = start.clone().lerp(end, fraction), tip = wisteriaTreeFloretBearing(flower);
    const pedicel = createWisteriaTreePedicel([base.x, base.y, base.z], [tip.x, tip.y, tip.z], .00065);
    if (pedicel) { owned.push(pedicel); raceme.add(new Mesh(pedicel, pack.real.materials.calyx)); }
  }
  return { flowers, leaves, raceme, spray,
    dispose: () => { releaseFlowers(); releaseFoliage(); owned.forEach(geometry => geometry.dispose());
      raceme.clear(); spray.clear(); } };
};

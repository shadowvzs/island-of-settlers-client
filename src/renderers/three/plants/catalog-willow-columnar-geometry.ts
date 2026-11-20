import {
  BackSide, BufferGeometry, DoubleSide, Euler, Float32BufferAttribute, FrontSide,
  Group, Matrix4, Mesh, MeshStandardMaterial, Vector2
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { RoadPlantId } from "../../../../../island-of-settlers-shared/src/road-plant-catalog";
import type { CatalogConiferSpray } from "../../../render-common/plants/catalog-columnar-graph";
import type { OrnamentalLimb } from "../../../render-common/plants/ornamental-tree-graph";
import type { GardenTreeLeaf } from "../../../render-common/plants/roman-garden-tree-graph";
import { createBonsaiPotGeometries } from "./bonsai-pot-geometry";
import { createCatalogColumnarPotTextures } from "./catalog-columnar-pot-textures";
import { createCatalogColumnarSpray } from "./catalog-columnar-spray";
import { createCatalogColumnarTextures } from "./catalog-columnar-textures";
import { createOrnamentalLeafTextures } from "./ornamental-leaf-textures";
import { createOrnamentalTreeMaterials } from "./ornamental-tree-materials";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";
import type { PlantCompletionTier } from "./plant-completion-contract";
import { createWillowPetioleGeometry, willowWoodTopology } from "./willow-tree-geometry";

const colours: Partial<Record<RoadPlantId, string>> = {
  "compact-willow": "#9fce46", "silver-willow": "#78bd49", "golden-willow": "#c5d348",
  "narrow-willow": "#83bd46", "italian-poplar": "#91c547", "juniper-spire": "#55a78e",
  "columnar-cypress": "#429946"
};

export const createCatalogWillowColumnarMaterials = (species: RoadPlantId, detailed: boolean, potted = false) => {
  const owner = createOrnamentalTreeMaterials({ bark: species === "golden-willow" ? "#bb995b" : "#b49065",
    ceramic: "#427c86", foliage: colours[species], soil: "#68513a" });
  const conifer = species === "columnar-cypress" || species === "juniper-spire";
  const textures = conifer ? createCatalogColumnarTextures(species === "juniper-spire")
    : createOrnamentalLeafTextures();
  const foliage = owner.materials.foliage;
  foliage.map = textures.map; foliage.normalMap = detailed ? textures.normalMap : null;
  foliage.normalScale = new Vector2(.40, .40);
  foliage.side = species === "silver-willow" ? FrontSide : DoubleSide;
  foliage.roughness = .76;
  const underside = new MeshStandardMaterial({ color: "#bdceb1", map: textures.map,
    normalMap: detailed ? textures.normalMap : null, normalScale: new Vector2(.25, .25),
    roughness: .91, side: BackSide, vertexColors: true });
  const materials = { ...owner.materials, underside };
  const potTextures = potted ? createCatalogColumnarPotTextures() : undefined;
  if (potTextures) {
    materials.ceramic.map = potTextures.ceramic;
    materials.ceramic.bumpMap = detailed ? potTextures.ceramic : null;
    materials.ceramic.bumpScale = .0015;
    materials.soil.map = potTextures.soil;
    materials.soil.bumpMap = detailed ? potTextures.soil : null;
    materials.soil.bumpScale = .006;
  }
  let disposed = false;
  return { materials, dispose: () => {
    if (disposed) return;
    disposed = true; underside.dispose(); textures.dispose(); potTextures?.dispose(); owner.dispose();
  } };
};

export type CatalogWillowColumnarMaterials = ReturnType<typeof createCatalogWillowColumnarMaterials>;

/** Raised keel and sharp lanceolate tip remain real surfaces even at Minimal. Poplar is broad and deltoid. */
const blade = (leaf: GardenTreeLeaf, species: RoadPlantId, detailed: boolean) => {
  const poplar = species === "italian-poplar", needle = species === "juniper-spire";
  let outline = [[0, 0], [-.5, .42], [0, 1], [.5, .42]];
  if (detailed && !needle) outline = [[0, 0], [-.30, .18], [-.50, poplar ? .30 : .43],
    [-.30, .73], [0, 1], [.30, .73], [.50, poplar ? .30 : .43], [.30, .18]];
  const positions: number[] = [], colours: number[] = [], uv: number[] = [], indices: number[] = [];
  const shade = .88 + Math.sin(leaf.seed * 7.13) * .11;
  for (const [x = 0, t = 0] of outline) {
    positions.push(x * leaf.width, Math.sin(t * Math.PI) * leaf.length * .025, t * leaf.length);
    colours.push(shade, shade, shade); uv.push(x + .5, t);
  }
  const middle = positions.length / 3;
  positions.push(0, leaf.length * (needle ? .065 : .085), leaf.length * .48);
  colours.push(1, 1, 1); uv.push(.5, .48);
  for (let i = 0; i < outline.length; i++) indices.push(middle, i, (i + 1) % outline.length);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ"));
  matrix.setPosition(...leaf.position); geometry.applyMatrix4(matrix);
  return geometry;
};

const batch = (pieces: BufferGeometry[]) => {
  const surfaces = pieces.map(piece => {
    if (!piece.getAttribute("color")) piece.setAttribute("color",
      new Float32BufferAttribute(new Float32Array(piece.getAttribute("position").count * 3).fill(1), 3));
    const expanded = piece.index ? piece.toNonIndexed() : piece;
    if (expanded !== piece) piece.dispose();
    return expanded;
  });
  const result = mergeGeometries(surfaces, false);
  surfaces.forEach(surface => surface.dispose());
  if (!result) throw new Error("Unable to batch columnar/willow geometry");
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
};

export const createCatalogWillowColumnarModel = (pack: CatalogWillowColumnarMaterials,
  graph: { limbs: OrnamentalLimb[]; leaves: GardenTreeLeaf[]; sprays?: CatalogConiferSpray[] }, species: RoadPlantId,
  variant: number, potted: boolean, detailed: boolean, tier: PlantCompletionTier) => {
  const far = tier === "far", full = detailed && !far;
  const willow = species.includes("willow");
  const wood = graph.limbs.map((limb, i) => {
    let topology = willowWoodTopology(limb, full, far);
    if (!willow && limb.role !== "trunk") topology = { rings: far ? 1 : 3, sides: full ? 5 : 3 };
    return createOrnamentalWoodGeometry(limb, full, i + variant * 17, topology);
  });
  if (!far && (willow || species === "italian-poplar")) for (const leaf of graph.leaves) {
    const petiole = createWillowPetioleGeometry(leaf);
    if (petiole) wood.push(petiole);
  }
  const root = new Group(); root.name = `${species}-${variant}-${tier}`;
  const owned: BufferGeometry[] = [];
  let triangles = 0;
  const addBatch = (pieces: BufferGeometry[], material: keyof typeof pack.materials, name: string) => {
    const geometry = batch(pieces); owned.push(geometry);
    const mesh = new Mesh(geometry, pack.materials[material]); mesh.name = name;
    mesh.castShadow = detailed; mesh.receiveShadow = detailed; root.add(mesh);
    triangles += geometry.getAttribute("position").count / 3;
    return geometry;
  };
  addBatch(wood, "bark", "continuous-trunk-root-branch-petiole");
  const leafPieces = graph.leaves.map(leaf => blade(leaf, species, full));
  graph.sprays?.forEach((spray, i) => leafPieces.push(createCatalogColumnarSpray(spray, full, i)));
  const foliage = addBatch(leafPieces, "foliage", "folded-live-foliage");
  if (species === "silver-willow") {
    const underside = new Mesh(foliage, pack.materials.underside); underside.name = "silver-leaf-undersides";
    underside.castShadow = detailed; underside.receiveShadow = detailed; root.add(underside);
    triangles += foliage.getAttribute("position").count / 3;
  }
  if (potted) {
    const pot = createBonsaiPotGeometries({ width: .38, depth: .38, height: .30, style: "round" }, full);
    addBatch(pot.ceramic, "ceramic", "hollow-glazed-ceramic-rim-and-bearing-feet");
    addBatch([pot.soil], "soil", "supported-root-bearing-soil");
  }
  let disposed = false;
  return { root, triangles, dispose: () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear(); owned.forEach(geometry => geometry.dispose());
  } };
};

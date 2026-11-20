import { CircleGeometry, Group, LatheGeometry, Mesh, Vector2, Vector3 } from "three";

import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { createCatalogShrubGraph, shrubMix } from "../../../render-common/plants/catalog-shrub-graph";
import { createCatalogFlowerHead } from "./catalog-flower-heads";
import { createCatalogShrubMaterials } from "./catalog-shrub-materials";
import { shrubLeaf, shrubStem,ShrubSurface } from "./catalog-shrub-surfaces";
import { definePlantCompletionFamily, type PlantCompletionTier } from "./plant-completion-contract";

type Pack = ReturnType<typeof createCatalogShrubMaterials>;
const addFoliage = (green: ShrubSurface, stems: ShrubSurface,
  graph: ReturnType<typeof createCatalogShrubGraph>, detailed: boolean) => {
  const species = graph.definition.id;
  const compact = species.includes("boxwood") || species === "round-myrtle";
  const needle = species === "rosemary" || species === "lavender";
  let kind: "oval" | "broad" | "needle" | "lobed" = "oval";
  if (needle) kind = "needle";
  if (["hydrangea", "hibiscus"].includes(species)) kind = "broad";
  if (species === "marigold") kind = "lobed";
  for (const shoot of graph.shoots) {
    shrubStem(shoot.flowering ? green : stems, new Vector3(...shoot.start), new Vector3(...shoot.end),
      shoot.flowering ? .0045 : .007, detailed ? 5 : 4);
    if (compact && shoot.start[1] < graph.base + .001) continue;
    let count = 4;
    if (compact) count = detailed ? 8 : 7;
    if (["myrtle", "azalea"].includes(species)) count = 8;
    if (["lavender", "rosemary", "hydrangea", "hibiscus"].includes(species)) count = 6;
    if (species.endsWith("-rose") || species === "marigold") count = detailed ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const start = new Vector3(...shrubMix(shoot.start, shoot.end, .35 + i / Math.max(1, count - 1) * .65));
      const yaw = shoot.seed + i * 2.399963;
      const petiole = start.clone().add(new Vector3(Math.cos(yaw) * .012, .006, Math.sin(yaw) * .012));
      shrubStem(green, start, petiole, .0018, 3);
      const length = graph.definition.leafLength * (compact ? 1.05 : 1.13);
      const width = graph.definition.leafWidth * (needle ? .42 : .68);
      shrubLeaf(green, petiole, yaw, length, width, kind, shoot.seed + i, detailed, compact);
      if (species === "rosemary") shrubLeaf(green, petiole, yaw + Math.PI,
        length, width, kind, shoot.seed + i, false);
      if (species.endsWith("-rose") || species === "marigold") {
        const rachisTip = petiole.clone().add(new Vector3(Math.cos(yaw) * length,
          .015, Math.sin(yaw) * length));
        shrubStem(green, petiole, rachisTip, .0017, 3);
        for (const sign of [-1, 1]) {
          const bearing = petiole.clone().lerp(rachisTip, .42);
          shrubLeaf(green, bearing, yaw + sign * .9, length * .57, width * .68, kind,
            shoot.seed + i, false);
        }
      }
    }
  }
};
export const createCatalogShrubModel = (pack: Pack, asset: PlantDecorationAsset,
  detailed: boolean, tier: PlantCompletionTier) => {
  if (tier !== "near") throw new Error("Shrub/flower far requires the canonical async overview owner");
  const graph = createCatalogShrubGraph(asset.species, asset.variant, asset.potted, detailed);
  const surfaces = { stems: new ShrubSurface(), green: new ShrubSurface(), petals: new ShrubSurface(),
    pollen: new ShrubSurface() };
  addFoliage(surfaces.green, surfaces.stems, graph, detailed);
  let blossomIndex = 0;
  for (const shoot of graph.shoots) {
    if (!shoot.flowering) continue;
    const index = blossomIndex++;
    if (asset.species === "hydrangea" && index % 3 !== 0) continue;
    if (asset.species === "myrtle" && index % 2 !== 0) continue;
    createCatalogFlowerHead(asset.species, surfaces.petals, surfaces.green, surfaces.green,
      surfaces.pollen, new Vector3(...shoot.end), shoot.seed, detailed);
  }
  const root = new Group(); root.name = `catalog-${asset.species}-${asset.variant}-${tier}`;
  const geometries = Object.entries(surfaces).filter(([, surface]) => surface.indices.length)
    .map(([name, surface]) => ({ name: name as keyof Pack["materials"], geometry: surface.geometry() }));
  if (asset.potted) {
    const potSegments = detailed ? 32 : 16;
    const profile = [[.070, 0], [.077, .012], [.106, .216], [.115, .222], [.115, .238],
      [.103, .238], [.100, .219], [.066, .014], [.070, 0]];
    const pot = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), potSegments);
    geometries.push({ name: "pot", geometry: pot });
    const floor = new CircleGeometry(.072, 8);
    floor.rotateX(-Math.PI / 2); floor.translate(0, .009, 0);
    geometries.push({ name: "pot", geometry: floor });
    const soil = new CircleGeometry(.101, potSegments);
    soil.rotateX(-Math.PI / 2); soil.translate(0, .222, 0); geometries.push({ name: "soil", geometry: soil });
  }
  let triangles = 0;
  for (const { geometry, name } of geometries) {
    triangles += (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
    const mesh = new Mesh(geometry, pack.materials[name]); mesh.name = name;
    mesh.castShadow = detailed; mesh.receiveShadow = detailed; root.add(mesh);
  }
  let disposed = false;
  return { root, triangles, dispose: () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear(); geometries.forEach(({ geometry }) => geometry.dispose());
  } };
};
export const CATALOG_SHRUB_ADAPTER = definePlantCompletionFamily({ id: "catalog-shrub",
  species: ["boxwood", "golden-boxwood", "round-boxwood", "round-myrtle", "myrtle"],
  createMaterials: createCatalogShrubMaterials, createModel: createCatalogShrubModel });

import { Group, Mesh, type Texture, TextureLoader } from "three";

import { getRoadDecorationItem, type RoadDecorationItemId } from "../../../../../island-of-settlers-shared/src/road-decoration-items";
import {
  type PlantDecorationAsset,
  plantDecorationContentId
} from "../../../../../island-of-settlers-shared/src/road-plant-items";
import {
  createOrnamentalOverviewGeometry,
  createOrnamentalOverviewMaterial,
  type OrnamentalOverviewImage
} from "./ornamental-plant-overview-geometry";

export type OrnamentalOverviewManifest = Readonly<Record<string, OrnamentalOverviewImage>>;
interface OverviewDependencies {
  baseUrl?: string;
  loadManifest?: () => Promise<OrnamentalOverviewManifest>;
  loadTexture?: (url: string) => Promise<Texture>;
}
let manifest: Promise<OrnamentalOverviewManifest> | undefined;
const overviewDirectory = (base: string) => {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}icons/road-decorations/`;
};
const loadManifest = (directory: string) => {
  manifest ??= fetch(`${directory}ornamental-overview.json`).then(response => {
    if (!response.ok) throw new Error(`Unable to load canonical plant overview manifest (${response.status})`);
    return response.json() as Promise<OrnamentalOverviewManifest>;
  }).catch(error => { manifest = undefined; throw error; });
  return manifest;
};

const imageFor = (entries: OrnamentalOverviewManifest, id: string, content: string, finish: string) => {
  const image = entries[id];
  if (!image || image.image !== `${content}-${finish}.png` ||
    !Number.isFinite(image.width) || image.width <= 0 || !Number.isFinite(image.height) || image.height <= 0 ||
    !Array.isArray(image.pivot) || image.pivot.length !== 2 ||
    image.pivot.some(value => !Number.isFinite(value) || value < 0 || value > 1))
    throw new Error(`Missing or invalid canonical plant overview: ${id}`);
  return image;
};

/** Each cached template owns one lazy icon; all its instances borrow that texture/material/geometry. */
export const createOrnamentalPlantOverview = async (asset: PlantDecorationAsset | RoadDecorationItemId, active = () => true,
  dependencies: OverviewDependencies = {}) => {
  if (!active()) return undefined;
  const id = typeof asset === "string" ? asset : `roadDecoration:${plantDecorationContentId(asset)}:native`;
  const item = getRoadDecorationItem(id);
  if (!item) throw new Error(`Unknown canonical overview item: ${id}`);
  const content = item.decoration;
  const directory = overviewDirectory(dependencies.baseUrl ?? import.meta.env.BASE_URL);
  const entries = await (dependencies.loadManifest?.() ?? loadManifest(directory));
  if (!active()) return undefined;
  let image: OrnamentalOverviewImage;
  try { image = imageFor(entries, id, content, item.finish); }
  catch (error) {
    // A deployed manifest may predate a newly introduced ID; the controlled retry must re-fetch it.
    if (!dependencies.loadManifest) manifest = undefined;
    throw error;
  }
  const texture = await (dependencies.loadTexture?.(`${directory}${image.image}`) ??
    new TextureLoader().loadAsync(`${directory}${image.image}`));
  if (!active()) { texture.dispose(); return undefined; }
  const geometry = createOrnamentalOverviewGeometry(image), material = createOrnamentalOverviewMaterial(texture);
  const root = new Group(), mesh = new Mesh(geometry, material);
  root.name = `ornamental-overview-${content}`; mesh.name = "canonical-plant-overview";
  // Overview sprites are already lit canonical renders. Tiny objects need neither extra shadow pass nor blending.
  mesh.castShadow = false; mesh.receiveShadow = false; root.add(mesh);
  let disposed = false;
  return { root, triangles: 2, dispose: () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent(); root.clear(); geometry.dispose(); material.dispose(); texture.dispose();
  } };
};

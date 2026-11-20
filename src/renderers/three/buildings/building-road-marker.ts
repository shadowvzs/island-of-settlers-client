import {
  BoxGeometry, type BufferGeometry, Color, CylinderGeometry, DataTexture, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RGBAFormat, RingGeometry, Shape, ShapeGeometry,
  SRGBColorSpace, type Texture, TextureLoader
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import headquartersLaurel from "../../../../assets/building-icons/headquarters-laurel.svg?url";
import { isOpenArcherTower } from "../../../render-common/buildings/bandit-camp-plan";
import type { BuildingFrame } from "../../../render-common/buildings/building-catalog";
import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { createBuildingOccupationSymbolSvg } from "../../../render-common/buildings/building-occupation-symbol";
import { getPlacedBuildingSignpost } from "../../../render-common/buildings/building-road-signpost";
import { productionBuildingIconSource } from "../../../render-common/buildings/production-icon-sources";
import { mineOreIconSource } from "../../../render-common/rocks/ore-icon-sources";
import { sinHash2 } from "../../../shared/world/noise";
import type { ConstructionGround } from "../settlement/construction-site-ground";
import { markStaticBatchMesh } from "./building-static-batch-geometry";
import { createLookoutSpyglassMaterial } from "./lookout-spyglass-material";

const createSignpostWood = () => {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = Math.sin(x * .75 + Math.sin(y * .14) * 1.2);
    const shade = .87 + grain * .11 + sinHash2(x, y) * .13;
    const offset = (y * size + x) * 4;
    pixels[offset] = Math.round(119 * shade);
    pixels[offset + 1] = Math.round(78 * shade);
    pixels[offset + 2] = Math.round(43 * shade);
    pixels[offset + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const tinted = (geometry: BufferGeometry, hex: number) => {
  const { b, g, r } = new Color(hex), count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
};

/**
 * The gold ring and ivory arrow never overlap, so one vertex-coloured draw shows exactly what the
 * two tinted draws did (same blend, depth and polygon offset).
 */
const createConnectionSymbolGeometry = () => {
  const arrow = new Shape();
  arrow.moveTo(-.025, -.07); arrow.lineTo(.025, -.07); arrow.lineTo(.025, .02);
  arrow.lineTo(.065, .02); arrow.lineTo(0, .09); arrow.lineTo(-.065, .02);
  arrow.lineTo(-.025, .02); arrow.closePath();
  const parts = [tinted(new RingGeometry(.14, .165, 20), 0xf4bc53), tinted(new ShapeGeometry(arrow), 0xffebc1)];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Road connection symbol merge failed");
  return geometry;
};

/** Shared low-cost geometry and the same occupation pictogram painted on each building. */
export const createBuildingRoadMarkers = () => {
  const symbolGeometry = createConnectionSymbolGeometry();
  const symbolMaterial = new MeshBasicMaterial({ transparent: true, opacity: .68, vertexColors: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const postGeometry = new CylinderGeometry(.031, .041, .645, 7);
  const boardGeometry = new BoxGeometry(.39, .31, .055);
  const iconGeometry = new PlaneGeometry(.34, .255);
  const woodTexture = createSignpostWood();
  const wood = new MeshStandardMaterial({ map: woodTexture, roughness: .96 });
  const icons = new Map<string, MeshStandardMaterial>();
  const textures = new Set<Texture>();
  const loader = new TextureLoader();
  let disposed = false;
  const iconMaterial = (type: number, nation: BuildingFrame["nation"]) => {
    const key = type === 14 ? "lookout-spyglass" : `${type}:${nation ?? "roman"}`, cached = icons.get(key);
    if (cached) return cached;
    if (type === 14) {
      const material = createLookoutSpyglassMaterial(false); icons.set(key, material); return material;
    }
    const wareSource = productionBuildingIconSource(type,nation) ?? mineOreIconSource(type);
    // The tablet face is painted on opaque parchment. It must take the scene light like the wood,
    // otherwise its cream background keeps glowing after dusk while the rest of the sign darkens.
    // Mine signs use the same transparent ore artwork as inventory and geologist signs.
    const material = new MeshStandardMaterial({ alphaTest: wareSource ? .05 : 0, color: 0xffffff,
      metalness: 0, roughness: .92, transparent: Boolean(wareSource) });
    icons.set(key, material);
    let source: string | undefined;
    if (wareSource) source = wareSource;
    else if (type === 0) source = headquartersLaurel;
    else {
      const svg = createBuildingOccupationSymbolSvg(getBuildingDefinition(type), nation);
      source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }
    if (!source || typeof document === "undefined") return material;
    const texture = loader.load(source, loaded => {
      if (disposed) return;
      loaded.colorSpace = SRGBColorSpace;
      material.map = loaded;
      material.needsUpdate = true;
    });
    textures.add(texture);
    return material;
  };
  return {
    create: () => {
      const root = new Group(); root.name = "building_road_connection";
      const symbol = new Group(); symbol.name = "building_road_connection_symbol";
      symbol.add(new Mesh(symbolGeometry, symbolMaterial));
      symbol.rotation.x = -Math.PI / 2;
      const post = new Group(); post.name = "building_road_signpost";
      const stake = new Mesh(postGeometry, wood); stake.position.y = .3025;
      const board = new Mesh(boardGeometry, wood); board.position.y = .78;
      markStaticBatchMesh(stake, wood, false); markStaticBatchMesh(board, wood, false);
      stake.castShadow = board.castShadow = true;
      stake.receiveShadow = board.receiveShadow = true;
      post.add(stake, board);
      root.add(symbol, post);
      return root;
    },
    update: (marker: Group, frame: BuildingFrame, ground?: ConstructionGround) => {
      marker.visible = !isOpenArcherTower(frame);
      if (!marker.visible) return;
      const { post, road, rotation } = getPlacedBuildingSignpost(frame.type, frame.x, frame.z,
        Math.round(frame.rotation / (Math.PI / 2)));
      const height = ground?.sample(road.x, road.z) ?? frame.y;
      marker.position.set(road.x, height + .028, road.z);
      const symbol = marker.children[0] as Group;
      symbol.rotation.z = -rotation;
      const signpost = marker.children[1] as Group;
      signpost.visible = true;
      signpost.position.set(post.x - road.x, (ground?.sample(post.x, post.z) ?? frame.y) - height - .028,
        post.z - road.z);
      signpost.rotation.y = rotation;
      const sign = `${frame.type}:${frame.nation ?? "roman"}`;
      if (signpost.userData.sign === sign) return;
      signpost.userData.sign = sign;
      const material = iconMaterial(frame.type, frame.nation);
      if (signpost.children.length === 2) {
        const front = new Mesh(iconGeometry, material); front.position.set(0, .78, .028);
        const back = new Mesh(iconGeometry, material); back.position.set(0, .78, -.028);
        back.rotation.y = Math.PI;
        // Opaque pictograms batch with the post; ware artwork (alpha blended) keeps its own sorted draw.
        markStaticBatchMesh(front, material, false); markStaticBatchMesh(back, material, false);
        front.name = "building_signpost_icon_front"; back.name = "building_signpost_icon_back";
        signpost.add(front, back);
      } else for (const icon of signpost.children.slice(2)) {
        (icon as Mesh).material = material;
        markStaticBatchMesh(icon as Mesh, material, false);
      }
    },
    dispose: () => {
      disposed = true;
      for (const geometry of [symbolGeometry, postGeometry, boardGeometry, iconGeometry]) geometry.dispose();
      for (const material of [symbolMaterial, wood, ...icons.values()]) material.dispose();
      for (const texture of textures) texture.dispose();
      woodTexture.dispose();
      icons.clear(); textures.clear();
    }
  };
};

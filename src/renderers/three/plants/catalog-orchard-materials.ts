import { DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter,   type Material,MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

import { getRoadPlant } from "../../../../../island-of-settlers-shared/src/road-plant-catalog";
import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { botanicalNoise } from "../../../render-common/plants/catalog-orchard-graph";
import type { PlantCompletionMaterials } from "./plant-completion-contract";

export interface CatalogBotanicalMaterials extends PlantCompletionMaterials {
  readonly materials: Readonly<Record<"wood" | "foliage" | "fruit", Material>>;
}

const applyBotanicalFiltering = (texture: DataTexture) => {
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 2;
  texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};

/** Painted palm bark: ring scars, staggered date leaf-base diamonds and fan-palm fibres. */
const palmBarkShade = (u: number, v: number, species: PlantDecorationAsset["species"]) => {
  const noise = botanicalNoise(Math.floor(u * 512) + Math.floor(v * 1024) * 73);
  const fine = Math.sin(u * Math.PI * 2 * 41 + Math.sin(v * 19) * 1.1) * .022 +
    Math.sin(u * Math.PI * 2 * 13 + v * 27) * .012;
  if (species === "date-palm") {
    const rows = 9, columns = 6;
    const row = v * rows + Math.sin(u * Math.PI * 4) * .035;
    const shifted = u * columns + (Math.floor(row) % 2) * .5;
    const cellX = shifted - Math.floor(shifted), cellY = row - Math.floor(row);
    const diamond = Math.abs(cellX - .5) * 1.65 + Math.abs(cellY - .5);
    const outline = Math.exp(-Math.pow((diamond - .46) * 15, 2)) * .13;
    const lip = Math.exp(-Math.pow((cellY - .04) * 26, 2)) * .055;
    return .85 + fine + noise * .035 - outline - lip + Math.max(0, .32 - diamond) * .10;
  }
  if (species === "fan-palm") {
    const coarse = Math.sin(u * Math.PI * 2 * 17 + v * 8.5) * .018 +
      Math.sin(u * Math.PI * 2 * 43 + Math.sin(v * 23) * .8) * .017;
    const ring = Math.exp(-Math.pow(((v * 8 + .5) % 1 - .5) * 11, 2)) * .055;
    return .86 + coarse + fine * .6 + ring + noise * .03;
  }
  const bands = v * 13 + Math.sin(u * Math.PI * 6 + v * 5) * .035;
  const groove = Math.exp(-Math.pow((((bands % 1) + 1) % 1 - .5) * 9, 2));
  return .90 + fine + noise * .035 - groove * .18 + Math.sin(bands * Math.PI * 2) * .012;
};

const botanicalMap = (kind: "bark" | "leaf" | "fruit", palm: boolean, detailed: boolean,
  species: PlantDecorationAsset["species"]) => {
  let width = 64, height = 128;
  if (kind === "leaf" && detailed) { width = 128; height = 256; }
  if (kind === "bark") { width = detailed ? 256 : 128; height = detailed ? 512 : 256; }
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    let shade = .86 + botanicalNoise(x + y * 71) * .12;
    if (kind === "bark") {
      const fissure = Math.sin(u * 83 + Math.sin(v * 29) * 1.8);
      shade = .82 + Math.max(0, fissure) * .12 + botanicalNoise(x + y * 9) * .07;
      if (palm) shade = palmBarkShade(u, v, species);
    }
    if (kind === "leaf") {
      const midrib = Math.exp(-Math.abs(u - .5) * 100);
      const lateral = Math.pow(Math.max(0, Math.cos((v - Math.abs(u - .5) * .55) * 110)), 18);
      shade = .86 + v * .10 + midrib * .15 + lateral * .055;
      if (palm) {
        const parallelVeins = Math.pow(Math.max(0, Math.cos(u * 120)), 8);
        shade = .84 + v * .10 + midrib * .17 + parallelVeins * .035;
      }
    }
    if (kind === "fruit") shade = .92 + botanicalNoise(x * 3 + y * 17) * .08;
    const index = (x + y * width) * 4;
    bytes[index] = Math.min(255, shade * 255);
    bytes[index + 1] = Math.min(255, shade * 255);
    bytes[index + 2] = Math.min(255, shade * 255);
    bytes[index + 3] = 255;
  }
  const texture = new DataTexture(bytes, width, height, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  return applyBotanicalFiltering(texture);
};

const barkNormal = (heightMap: DataTexture) => {
  const { data, height, width } = heightMap.image;
  const bytes = new Uint8Array(width * height * 4);
  const sample = (x: number, y: number) => data![((y + height) % height * width + (x + width) % width) * 4]!;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (sample(x - 1, y) - sample(x + 1, y)) / 180;
    const dy = (sample(x, y - 1) - sample(x, y + 1)) / 180;
    const length = Math.hypot(dx, dy, 1), index = (x + y * width) * 4;
    bytes[index] = (dx / length * .5 + .5) * 255;
    bytes[index + 1] = (dy / length * .5 + .5) * 255;
    bytes[index + 2] = (1 / length * .5 + .5) * 255;
    bytes[index + 3] = 255;
  }
  const normal = applyBotanicalFiltering(new DataTexture(bytes, width, height, RGBAFormat));
  const roughnessBytes = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const value = (.87 + (1 - data![index * 4]! / 255) * .40) * 255;
    roughnessBytes[index * 4] = value;
    roughnessBytes[index * 4 + 1] = value;
    roughnessBytes[index * 4 + 2] = value;
    roughnessBytes[index * 4 + 3] = 255;
  }
  const roughness = applyBotanicalFiltering(new DataTexture(roughnessBytes, width, height, RGBAFormat));
  return { normal, roughness };
};

const woodTone = (species: PlantDecorationAsset["species"]) => {
  if (species === "olive-standard") return 0x938570;
  if (species === "dwarf-coconut") return 0x928979;
  if (species === "date-palm") return 0x826b50;
  if (species === "fan-palm") return 0x7d6751;
  return 0x9d7754;
};

/** Original deterministic opaque paint maps: no alpha sorting, per-instance resources, or external assets. */
export const createCatalogBotanicalMaterials = (asset: PlantDecorationAsset,
  detailed: boolean): CatalogBotanicalMaterials => {
  const definition = getRoadPlant(asset.species)!, palm = definition.form === "palm";
  const maps = [botanicalMap("bark", palm, detailed, asset.species),
    botanicalMap("leaf", palm, detailed, asset.species),
    botanicalMap("fruit", palm, detailed, asset.species)];
  const wood = new MeshStandardMaterial({ color: woodTone(asset.species), map: maps[0], roughness: .91,
    vertexColors: true });
  if (detailed) {
    const { normal, roughness } = barkNormal(maps[0]!);
    maps.push(normal, roughness);
    wood.normalMap = normal; wood.normalScale.set(.55, .55);
    wood.roughness = 1; wood.roughnessMap = roughness;
  }
  const foliage = new MeshStandardMaterial({ color: 0xffffff, map: maps[1], roughness: .69,
    side: DoubleSide, vertexColors: true });
  foliage.color.setRGB(...definition.foliage, SRGBColorSpace);
  if (detailed) { foliage.bumpMap = maps[1]!; foliage.bumpScale = .004; }
  if (asset.species === "olive-standard") {
    foliage.color.set(0x6f8b63);
    foliage.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
        "#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = " +
        "mix(diffuseColor.rgb, vec3(0.23, 0.32, 0.27), 0.60);");
    };
    foliage.customProgramCacheKey = () => "catalog-olive-silver-underside-v3";
  }
  const fruit = new MeshStandardMaterial({ color: 0xffffff, map: maps[2], roughness: detailed ? .57 : .75,
    vertexColors: true });
  const materials = { wood, foliage, fruit };
  let disposed = false;
  return { materials, dispose: () => {
    if (disposed) return;
    disposed = true;
    Object.values(materials).forEach(material => material.dispose());
    maps.forEach(map => map.dispose());
  } };
};

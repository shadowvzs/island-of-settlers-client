import { getRoadPlant, type RoadPlantId } from "../../../../island-of-settlers-shared/src/road-plant-catalog";

export type CatalogShrubPoint = [number, number, number];
export interface CatalogShrubShoot {
  start: CatalogShrubPoint;
  end: CatalogShrubPoint;
  seed: number;
  flowering: boolean;
}
export const shrubNoise = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};
export const shrubMix = (a: CatalogShrubPoint, b: CatalogShrubPoint, t: number): CatalogShrubPoint =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Root-bearing species architectures: clipped sprays, woody flowering bushes and herbaceous clumps. */
export const createCatalogShrubGraph = (species: RoadPlantId, variant: number, potted: boolean,
  detailed: boolean) => {
  const definition = getRoadPlant(species);
  if (!definition) throw new Error(`Unknown plant ${species}`);
  const base = potted ? .222 : 0;
  const compact = species.includes("boxwood") || species === "round-myrtle";
  const herb = ["lavender", "rosemary", "marigold"].includes(species);
  const height = definition.height * (.93 + variant * .035);
  const radius = definition.crownRadius * (.84 + variant * .035);
  let count = compact ? 36 : 14;
  if (herb) count = species === "lavender" ? 17 : 12;
  if (species === "hibiscus") count = 12;
  if (!detailed) count = Math.ceil(count * .68);
  const shoots: CatalogShrubShoot[] = [];
  for (let i = 0; i < count; i++) {
    const seed = i * 47 + variant * 1703 + species.length * 19;
    const angle = i * 2.399963 + variant * .71;
    const ring = Math.sqrt((i + .5) / count);
    let y = height * (.62 + shrubNoise(seed) * .29);
    let reach = radius * ring;
    if (compact) {
      const latitude = 1 - (i + .5) / count * 1.85;
      reach = radius * Math.sqrt(1 - latitude * latitude);
      y = height * (.55 + latitude * .39);
      if (species === "boxwood") y *= .88 + .12 * Math.sin(angle * 3);
      if (species === "golden-boxwood") reach *= .87 + .13 * Math.cos(angle * 3 + variant);
      if (species === "round-myrtle") { reach *= .83; y *= 1.04; }
    }
    if (herb) y = height * (.58 + .35 * (1 - ring) + shrubNoise(seed) * .06);
    const start: CatalogShrubPoint = [Math.cos(angle) * .015, base - .014, Math.sin(angle) * .015];
    const end: CatalogShrubPoint = [Math.cos(angle) * reach, base + y, Math.sin(angle) * reach];
    const branch = shrubMix(start, end, herb ? .40 : .34);
    branch[0] *= .76; branch[2] *= .76;
    shoots.push({ start, end: branch, seed, flowering: false });
    shoots.push({ start: branch, end, seed: seed + 7,
      flowering: !compact && (species !== "rosemary" || i % 4 === 0) });
    if (compact) {
      const side: CatalogShrubPoint = [end[0] * .72, end[1] - height * .16, end[2] * .72];
      shoots.push({ start: branch, end: side, seed: seed + 31, flowering: false });
    }
  }
  return { base, height, radius, shoots, definition };
};

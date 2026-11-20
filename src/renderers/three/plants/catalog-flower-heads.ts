import { Vector3 } from "three";

import { shrubLeaf, shrubPetal, shrubStem, type ShrubSurface } from "./catalog-shrub-surfaces";

const calyx = (green: ShrubSurface, center: Vector3, size: number, seed: number, detailed: boolean) => {
  for (let i = 0; i < 5; i++) shrubLeaf(green, center, i * Math.PI * .4 + seed,
    size * .62, size * .13, "oval", seed + i, detailed);
};
const radial = (petals: ShrubSurface, center: Vector3, normal: Vector3, count: number,
  size: number, width: number, cup: number, seed: number, detailed: boolean) => {
  for (let i = 0; i < count; i++) shrubPetal(petals, center, normal,
    i * Math.PI * 2 / count + seed, size, width, cup, detailed);
};
/** A continuous rolled heart gives roses an unmistakable nested spiral instead of a radial star. */
const roseSpiral = (surface: ShrubSurface, center: Vector3, normal: Vector3,
  seed: number, detailed: boolean) => {
  const right = new Vector3(0, 0, 1).cross(normal).normalize(), up = normal.clone().cross(right);
  const offset = surface.positions.length / 3;
  const steps = detailed ? 24 : 18;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps, angle = seed + t * Math.PI * 4.6;
    const radius = .032 - t * .025;
    for (let edge = -1; edge <= 1; edge++) {
      const reach = Math.max(.002, radius + edge * .007);
      const point = center.clone().addScaledVector(right, Math.cos(angle) * reach)
        .addScaledVector(up, Math.sin(angle) * reach)
        .addScaledVector(normal, .032 + t * .030 + Math.abs(edge) * .005);
      surface.vertex(point, edge ? 1.06 : .73, (edge + 1) / 2, t);
    }
    if (!step) continue;
    const a = offset + step * 3;
    surface.indices.push(a - 3, a, a - 2, a - 2, a, a + 1,
      a - 2, a + 1, a - 1, a - 1, a + 1, a + 2);
  }
};
/** Separate botanical head recipes share only the folded petal surface primitive. */
export const createCatalogFlowerHead = (species: string, petals: ShrubSurface, green: ShrubSurface,
  stems: ShrubSurface, pollen: ShrubSurface, center: Vector3, seed: number, detailed: boolean) => {
  const normal = new Vector3(Math.sin(seed) * .45, .75, Math.cos(seed) * .45).normalize();
  if (species === "lavender" || species === "rosemary") {
    const levels = detailed ? 7 : 5;
    const radius = species === "lavender" ? .019 : .009;
    const end = center.clone().add(new Vector3(0, species === "lavender" ? .105 : .045, 0));
    shrubStem(stems, center, end, .0035, 4);
    for (let j = 0; j < levels; j++) {
      const base = center.clone().lerp(end, j / levels);
      const size = radius * (1 - j / levels * .5);
      for (let k = 0; k < 3; k++) {
        const angle = k * Math.PI * 2 / 3 + j * .7;
        const bud = base.clone().add(new Vector3(Math.cos(angle) * size * .5, 0, Math.sin(angle) * size * .5));
        shrubPetal(petals, bud, new Vector3(Math.cos(angle), .3, Math.sin(angle)).normalize(),
          angle, size, size * .63, size * .65, false);
      }
    }
    return;
  }
  if (species === "hydrangea") {
    const count = detailed ? 11 : 7;
    for (let i = 0; i < count; i++) {
      const yaw = i * 2.399963, ring = Math.sqrt((i + .3) / count);
      const floret = center.clone().add(new Vector3(Math.cos(yaw) * .060 * ring,
        .039 * Math.sqrt(1 - ring * ring), Math.sin(yaw) * .060 * ring));
      shrubStem(stems, center, floret, .0023, 3);
      radial(petals, floret, normal, 4, .025, .016, .008, yaw, false);
      radial(pollen, floret.clone().addScaledVector(normal, .004), normal, 4, .004, .002, .003, yaw, false);
    }
    return;
  }
  if (species.endsWith("-rose")) {
    calyx(green, center, .055, seed, false);
    const layers = detailed ? 4 : 3;
    for (let layer = 0; layer < layers - 1; layer++) {
      const radius = .064 - layer * .012;
      const bearing = center.clone().addScaledVector(normal, layer * .011);
      radial(petals, bearing, normal, layer ? 5 : 7, radius, radius * .61,
        .012 + layer * .008, seed + layer * 2.399963, false);
    }
    roseSpiral(petals, center, normal, seed + layers * .73, detailed);
    return;
  }
  if (species === "marigold") {
    calyx(green, center, .040, seed, false);
    const layers = detailed ? 4 : 3;
    for (let j = 0; j < layers; j++) radial(petals, center.clone().addScaledVector(normal, j * .008),
      normal, detailed ? 9 : 7, .043 - j * .007, .011, .014 + j * .003, seed + j * .5, false);
    return;
  }
  if (species === "azalea") {
    const throat = center.clone().addScaledVector(normal, -.020);
    radial(petals, throat, normal, 5, .053, .025, .044, seed, detailed);
    shrubStem(pollen, throat, center.clone().addScaledVector(normal, .050), .0021, 4);
    return;
  }
  if (species === "hibiscus") {
    calyx(green, center, .055, seed, false);
    radial(petals, center, normal, 5, .075, .047, .020, seed, detailed);
    const tip = center.clone().addScaledVector(normal, .080);
    shrubStem(pollen, center, tip, .004, 5);
    const anthers = detailed ? 6 : 3;
    for (let i = 0; i < anthers; i++) radial(pollen, center.clone().lerp(tip, .55 + i * .07),
      normal, 4, .009, .004, .003, i, false);
    return;
  }
  radial(petals, center, normal, 5, .016, .009, .005, seed, false);
  radial(pollen, center.clone().addScaledVector(normal, .004), normal, 5, .006, .002, .007, seed, false);
};

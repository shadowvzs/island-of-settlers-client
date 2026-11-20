import type { BuildingPart, Point3 } from "./building-recipe";
import { addIndigenousAwningFrame } from "./indigenous-awning-frame";
import { indigenousBarrelBearingHeight } from "./indigenous-barrel-bearing";
import type { IndigenousRoofProfile } from "./indigenous-roof-profile";
import { indigenousRoofHeight } from "./indigenous-roof-profile";
import type { RoofEnvelope } from "./nation-kit-classify";
import { type Add, runBetween } from "./nation-kit-parts";

export interface IndigenousRoofStyle {
  profile: IndigenousRoofProfile;
  surface: BuildingPart["surface"];
  rise: number;
}

/** Different working occupations retain distinct roofs, supported by the canonical walls/posts. */
export const addIndigenousRoof = (add: Add, roof: RoofEnvelope, style: IndigenousRoofStyle,
  detailed: boolean, main: boolean) => {
  const width = roof.max[0] - roof.min[0], depth = roof.max[2] - roof.min[2];
  const base = roof.min[1], x = (roof.max[0] + roof.min[0]) / 2, z = (roof.max[2] + roof.min[2]) / 2;
  const rise = Math.max(.12, Math.min(style.rise, Math.max(.18, Math.min(width, depth) * .75)));
  const turned = width > depth && style.profile !== "tipi";
  const size: Point3 = turned ? [depth, rise, width] : [width, rise, depth];
  add({ indigenousRoof: style.profile, position: [x, base + rise / 2, z],
    rotation: turned ? [0, Math.PI / 2, 0] : undefined, shape: "indigenous-roof", size,
    stage: 3, surface: style.surface });
  const point = (u: number, v: number, lift = 0): Point3 => {
    const y = base + (indigenousRoofHeight(style.profile, u, v) + .5) * rise + lift;
    if (turned) return [x + v * size[2], y, z - u * size[0]];
    return [x + u * size[0], y, z + v * size[2]];
  };
  const pole = (from: Point3, to: Point3, thickness = .035) =>
    runBetween(add, from, to, [thickness, thickness], { shape: "box", stage: 3, surface: "wood" });
  const bearing = (u: number, v: number): Point3 => {
    const result = point(u, v, -.045);
    if (style.profile === "barrel") result[1] = base
      + (indigenousBarrelBearingHeight(u, .0225 / size[0], detailed) + .5) * rise - .05;
    return result;
  };
  // Open occupational work bays need their own real frame now that the former masonry is gone.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const head = bearing(sx * .42, sz * .42);
    if (head[1] <= .1) continue;
    add({ position: [head[0], head[1] / 2, head[2]], radialSegments: detailed ? 7 : 4,
      shape: "cylinder", size: [.045, head[1], .045], stage: 1, surface: "wood" });
  }
  if (style.profile === "awning") {
    addIndigenousAwningFrame(add, point, detailed);
    return;
  }
  for (const side of [-1, 1]) pole(bearing(-.42, side * .42), bearing(.42, side * .42), .035);
  if (style.profile === "barrel") {
    // Arched rafters connect the lowered post/tie bearings to the longitudinal purlins.
    // Include purlin stations explicitly so perpendicular wood joints have real contact.
    const count = detailed ? 12 : 4;
    const knots = [...new Set([-.42, -.3, .3, .42,
      ...Array.from({ length: count + 1 }, (_, index) => index / count - .5)
        .filter(value => Math.abs(value) < .42)])].sort((a, b) => a - b);
    for (const side of [-1, 1]) for (let index = 0; index < knots.length - 1; index++)
      pole(bearing(knots[index]!, side * .42), bearing(knots[index + 1]!, side * .42), .025);
    for (const side of [-1, 1]) {
      const from = bearing(side * .3, -.42), to = bearing(side * .3, .42);
      from[1] += .018; to[1] += .018;
      pole(from, to, .025);
    }
    return;
  }
  // Lashings and poles follow the roof surface, never hover above a differently shaped roof.
  if (style.profile === "tipi") {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      pole(point(sx * .32, sz * .32, -.045), [x, base + rise - .045, z]);
      pole([x, base + rise - .045, z], [x - sx * .06, base + rise + .14, z - sz * .06]);
    }
    if (main) add({ position: [x, base + rise + .015, z], shape: "ring",
      size: [.115, .055, .115], stage: 3, surface: "rope" });
  } else {
    // Deep bearing purlins avoid the sharply curved fabric edge, including coarse Minimal facets.
    for (const side of [-1, 1]) pole(point(side * .3, -.35, -.12), point(side * .3, .35, -.12), .025);
  }
  // Sewn seams belong to the textile material; exposed wood never substitutes for fabric stitching.
};

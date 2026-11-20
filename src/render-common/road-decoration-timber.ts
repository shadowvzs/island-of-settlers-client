import { ROAD_DECORATION_POT_FOOT, type RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";
import type { BuildingPart } from "./buildings/building-recipe";
import { runBetween } from "./buildings/nation-kit-parts";
import { createClimberPendantComposition, sampleClimberShoot } from "./road-climber-composition";
import { roadDecorationAdder, type RoadDecorationPart, roadProfileBeam } from "./road-decoration-recipe";
import { wisteriaLimb } from "./road-decoration-wisteria-botany";

const TIMBER: NonNullable<BuildingPart["tint"]> = [.71, .56, .36];

/** Grounded pegged timber gate, with a distinct braced/drake-crested ceremonial variant. */
export const vikingRoadPortalParts = (definition: RoadDecorationDefinition, detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), opening = definition.opening!;
  const postX = opening.width / 2 + .27, head = opening.height + .28;
  for (const side of [-1, 1]) {
    add({ shape: "bevel-box", position: [side * postX, .07, 0], size: [.44, .14, .49],
      surface: "stone", tint: [.80, .81, .74] });
    add({ shape: "bevel-box", position: [side * postX, head / 2 + .025, 0], size: [.25, head, .27],
      surface: "planks", tint: TIMBER });
    for (const y of [.21, head - .09]) add({ shape: "bevel-box", position: [side * postX, y, 0],
      size: [.28, .055, .30], surface: "iron", tint: [.46, .43, .34] });
    // Incised chevron members lie on a real face; they are not detached ring/yoke volumes.
    for (const y of detailed ? [.65, .85, 1.05, 1.25, 1.45, 1.65] : [.8, 1.15, 1.5])
      for (const face of [-1, 1]) for (const direction of [-1, 1])
        roadProfileBeam(add, [side * postX + direction * .07, y + .045, face * .142],
          [side * postX, y, face * .142], .014, .014, "wood", [.36, .26, .15]);
  }
  add({ shape: "bevel-box", position: [0, head, 0], size: [postX * 2 + .65, .26, .35],
    surface: "planks", tint: TIMBER });
  const crest = head + (definition.variant === 1 ? .68 : .35);
  for (const side of [-1, 1]) {
    roadProfileBeam(add, [side * (postX + .20), head + .14, 0], [0, crest, 0], .15, .32, "wood", TIMBER);
    if (definition.variant === 1) add({ shape: "dragon-head", position: [side * (postX + .24), head + .33, 0],
      rotation: [0, side * Math.PI / 2, 0], size: [.22, .38, .26], surface: "wood", tint: TIMBER });
  }
  if (definition.variant === 1) for (const side of [-1, 1])
    roadProfileBeam(add, [side * (postX - .05), head + .11, 0], [side * .3, crest - .04, 0],
      .09, .22, "wood", TIMBER);
  return parts;
};

/** Standalone earthenware bowl/soil and a real branched leafy plant; no decorative display plinth. */
export const roadsideFlowerPotParts = (definition: RoadDecorationDefinition, detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), nubian = definition.nation === "nubian";
  add({ shape: "bowl", position: [0, .14, 0], size: [.32, .28, .32], surface: "plaster",
    tint: nubian ? [.74, .36, .17] : [.66, .40, .23] });
  // A real ceramic foot has a broad planar sole; the bowl's rounded body is not its bearing surface.
  const foot = ROAD_DECORATION_POT_FOOT;
  add({ shape: "cylinder", position: [0, foot.height / 2, 0],
    size: [foot.radius * 2, foot.height, foot.radius * 2], radialSegments: detailed ? 16 : 8,
    surface: "plaster", tint: nubian ? [.74, .36, .17] : [.66, .40, .23] });
  add({ shape: "planting-soil", position: [0, .235, 0], size: [.255, .025, .255], surface: "dark" });
  const height = nubian ? .43 : .36;
  add({ shape: "cylinder", position: [0, .24 + height * .36, 0], size: [.014, height * .72, .014],
    radialSegments: detailed ? 6 : 4, surface: "bark" });
  for (let index = 0; index < 6; index++) {
    const angle = index * 2.39996, y = .28 + index / 6 * height * .55;
    const x = Math.sin(angle) * .065, z = Math.cos(angle) * .065;
    runBetween(add, [0, y, 0], [x, y + .065, z], [.009, .011], { surface: "bark" });
    for (const offset of [0, .8]) add({ shape: "harvested-tea-leaf",
      position: [x + Math.sin(angle + offset) * .034, y + .07, z + Math.cos(angle + offset) * .034],
      rotation: [.15, angle + offset, .12], size: [.055, .014, .09], surface: "leaf",
      tint: nubian ? [.85, .96, .63] : [.71, .91, .64] });
  }
  for (let index = 0; index < (detailed ? 5 : 3); index++) {
    const angle = index * 2.39996, radius = .085 + index % 2 * .02;
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius, y = .38 + (index % 3) * .07;
    add({ shape: "cylinder", position: [x, (y + .25) / 2, z], size: [.009, y - .25, .009],
      radialSegments: 4, surface: "leaf" });
    const petals = detailed ? 5 : 4;
    for (let petal = 0; petal < petals; petal++) add({ shape: "sphere",
      position: [x + Math.sin(petal * Math.PI * .4) * .017, y, z + Math.cos(petal * Math.PI * .4) * .017],
      size: [.024, .012, .024], radialSegments: detailed ? 5 : 3, surface: "paint",
      tint: nubian ? [.98, .77, .19] : [.91, .72, .77] });
  }
  return parts;
};

/** Two rooted climbers wrap a fitted timber support; every leaf is static and above the clear road prism. */
export const floweringRoadPergolaParts = (definition: RoadDecorationDefinition,
  detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), opening = definition.opening!;
  const postX = opening.width / 2 + .23, top = opening.height + .36;
  for (const side of [-1, 1]) {
    add({ shape: "bevel-box", position: [side * postX, top / 2, 0], size: [.14, top, .16],
      surface: "wood", tint: [.71, .51, .29] });
    const turns = detailed ? 18 : 12;
    for (let index = 0; index < turns; index++) {
      const angle = index * .87, y = .15 + index / (turns - 1) * (top - .15);
      const x = side * postX + Math.sin(angle) * .075, z = Math.cos(angle) * .09;
      add({ shape: "cord", position: [x, y, z], size: [.018, top / turns + .08, .018],
        rotation: [.23 * Math.cos(angle), 0, .23 * Math.sin(angle)], radialSegments: detailed ? 6 : 4,
        surface: "bark" });
      const leaves = detailed ? 7 : 4;
      for (let leaf = 0; leaf < leaves; leaf++) {
        const direction = angle + leaf * 2.39996, radius = .105;
        parts.push({ kind: "folded-leaf", position: [side * postX + Math.sin(direction) * radius,
          y + .045 * Math.sin(index * 1.7 + leaf * 2.4), Math.cos(direction) * radius],
        rotation: [.4 + leaf % 2 * .4, direction, .3], size: [.14, .025, .21], surface: "leaf",
        tint: [.95, 1.12, .79] });
      }
    }
  }
  for (const z of [-.17, .17]) add({ shape: "bevel-box", position: [0, top, z],
    size: [postX * 2 + .34, .12, .09], surface: "wood", tint: [.71, .51, .29] });
  const spars = detailed ? 9 : 5;
  for (let index = 0; index < spars; index++) {
    const x = -postX + index / (spars - 1) * postX * 2;
    add({ shape: "bevel-box", position: [x, top + .08, 0], size: [.06, .08, .64], surface: "wood" });
    for (let leaf = 0; leaf < (detailed ? 12 : 8); leaf++) {
      const z = -.25 + leaf / (detailed ? 11 : 7) * .50;
      parts.push({ kind: "folded-leaf", position: [x + Math.sin(leaf * 2.4) * .07, top + .13, z],
        rotation: [.25, index * 1.7 + leaf, .25], size: [.16, .025, .23], surface: "leaf", tint: [.95, 1.12, .79] });
    }
  }
  // Crown flowers grow from real canes and branching shoots instead of every second timber spar.
  const canes = new Map<number, [number, number, number][]>();
  const turns = detailed ? 18 : 12, lastAngle = (turns - 1) * .87;
  for (const z of [-.12, .12]) {
    const points = Array.from({ length: 7 }, (_, index): [number, number, number] =>
      [-postX + index / 6 * postX * 2, top + .13, z]);
    for (let index = 1; index < points.length; index++)
      wisteriaLimb(parts, points[index - 1]!, points[index]!, .026, .022, detailed);
    for (const side of [-1, 1]) wisteriaLimb(parts,
      [side * postX + Math.sin(lastAngle) * .075, top, Math.cos(lastAngle) * .09],
      [side * postX, top + .13, z], .025, .020, detailed);
    canes.set(Math.sign(z), points);
  }
  const composition = createClimberPendantComposition(detailed ? 5 : 3, 871,
    (at, side) => sampleClimberShoot(canes.get(side)!, at), { minimumTipRise: .035 });
  for (const shoot of composition.shoots)
    for (let segment = 1; segment < shoot.points.length; segment++)
      wisteriaLimb(parts, [...shoot.points[segment - 1]!], [...shoot.points[segment]!], .015, .007, detailed);
  for (const site of composition.sites) {
    const head: [number, number, number] = [site.attachment[0], site.attachment[1] + .025, site.attachment[2]];
    wisteriaLimb(parts, [...site.attachment], head, .004, .003, detailed);
    add({ shape: "cylinder", position: [head[0], head[1] - .005, head[2]], size: [.016, .015, .016],
      radialSegments: detailed ? 4 : 3, topScale: [.5, 1, .5], surface: "leaf", tint: [.33, .44, .16] });
    const petals = detailed ? 5 : 4;
    for (let petal = 0; petal < petals; petal++) {
      const angle = site.yaw + petal * Math.PI * 2 / petals;
      parts.push({ kind: "folded-leaf", position: [head[0] + Math.sin(angle) * .035,
        head[1], head[2] + Math.cos(angle) * .035], rotation: [.12 + site.tilt, angle, 0],
      size: [.04, .012, .075], surface: "paint", tint: [1, .75, .44] });
    }
  }
  return parts;
};

import type { RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";
import { addChineseBracket, addChineseRoof, CHINESE_TIMBER } from "./buildings/chinese-building-roofs";
import { roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";

/** Chinese pailou uses the same supported dougong and pan/cover roof construction as Chinese buildings. */
export const chineseRoadPailouParts = (definition: RoadDecorationDefinition,
  detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], rawAdd = roadDecorationAdder(parts), opening = definition.opening!;
  const postX = opening.width / 2 + .25, top = opening.height + .57;
  const add: typeof rawAdd = part => rawAdd({ ...part,
    roofTileSpacing: part.roofTiles ? 3 : part.roofTileSpacing });
  for (const side of [-1, 1]) {
    add({ shape: "bevel-box", position: [side * postX, .075, 0], size: [.42, .15, .52],
      surface: "cut-stone", tint: [.92, .89, .78] });
    add({ shape: "cylinder", position: [side * postX, top / 2, 0], size: [.23, top, .23],
      radialSegments: detailed ? 20 : 8, surface: "paint", tint: CHINESE_TIMBER });
    for (const z of [-.13, .13]) addChineseBracket(add, [side * postX, top - .17, z], 0, detailed, 1.1);
    add({ shape: "bevel-box", position: [side * postX, .25, 0], size: [.29, .07, .29],
      surface: "cut-stone", tint: [.92, .89, .78] });
  }
  add({ shape: "bevel-box", position: [0, opening.height + .18, 0], size: [postX * 2 + .25, .17, .25],
    surface: "paint", tint: CHINESE_TIMBER });
  for (const x of [-.48, .48]) add({ shape: "bevel-box", position: [x, opening.height + .39, 0],
    size: [.08, .29, .17], surface: "paint", tint: CHINESE_TIMBER });
  add({ shape: "bevel-box", position: [0, opening.height + .42, .04], size: [.80, .30, .21],
    surface: "paint", tint: [.24, .14, .07] });
  for (const y of [opening.height + .29, opening.height + .55]) add({ shape: "bevel-box",
    position: [0, y, .16], size: [.79, .025, .03], surface: "gold", tint: [.83, .62, .24] });
  addChineseRoof(add, { min: [-postX - .40, top, -.46], max: [postX + .40, top + .4, .46] },
    59, detailed, true, "hip");
  return parts;
};

/** Shared true pointed-arch geometry, with an open frame and a distinct carved pishtaq variant. */
export const persianRoadPortalParts = (definition: RoadDecorationDefinition,
  detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), opening = definition.opening!;
  const width = opening.width + .16, spring = opening.height + .08, rise = width * .61;
  const thickness = .28, pier = (width + thickness) / 2;
  for (const side of [-1, 1]) {
    add({ shape: "bevel-box", position: [side * pier, .07, 0], size: [.43, .14, .62],
      surface: "cut-stone", tint: [.94, .87, .72] });
    if (definition.variant === 1) for (const y of [.60, 1.10, 1.60]) {
      add({ shape: "bevel-box", position: [side * (pier + .12), y, .29], size: [.14, .25, .035],
        surface: "paint", tint: [.21, .51, .53] });
      add({ shape: "bevel-box", position: [side * (pier + .12), y, .315], size: [.095, .095, .025],
        rotation: [0, 0, Math.PI / 4], surface: "cut-stone", tint: [.95, .88, .68] });
    }
  }
  // True extruded wedge voussoirs follow the same canonical two-circle pointed profile.
  // Arc-centred wedges avoid enlarged tangent-box elbows at the steep springing.
  const half = width / 2, centre = (rise * rise - half * half) / (2 * half), radius = centre + half;
  const slices = detailed ? 16 : 7;
  for (const side of [-1, 1]) {
    add({ shape: "bevel-box", position: [side * pier, spring / 2, 0], size: [thickness, spring, .54],
      surface: "plaster", tint: [.86, .74, .56] });
    const start = side < 0 ? Math.acos(-centre / radius) : 0;
    const end = side < 0 ? Math.PI : Math.acos(centre / radius);
    for (let index = 0; index < slices; index++) parts.push({ kind: "arch-stone",
      position: [-side * centre, spring, 0], innerRadius: radius, thickness, depth: .54,
      from: start + (end - start) * index / slices + .006,
      to: start + (end - start) * (index + 1) / slices - .006,
      surface: "plaster", tint: index % 4 === 2 ? [.96, .86, .66] : [.86, .74, .56] });
  }
  // Fit the single smaller keystone to the actual clipped voussoir endpoints; preserve the portal around it.
  const apexAngle = Math.acos(centre / radius) - .006;
  const lower = radius * Math.sin(apexAngle), upper = (radius + thickness) * Math.sin(apexAngle);
  const bottomWidth = 2 * (-centre + radius * Math.cos(apexAngle)) + .006;
  const topWidth = 2 * (-centre + (radius + thickness) * Math.cos(apexAngle)) + .006;
  add({ shape: "bevel-box", position: [0, spring + (lower + upper) / 2, 0], size: [bottomWidth, upper - lower + .006, .54],
    topScale: [topWidth / bottomWidth, 1, 1], surface: "plaster", tint: [.96, .86, .66] });
  if (definition.variant === 1) {
    const outerWidth = width + thickness * 2, height = rise + thickness * 1.35;
    add({ shape: "persian-arch-spandrel", position: [0, spring + height / 2, -.54 * .13],
      size: [outerWidth, height, .54 * .70], pointedArchOpening: [width / outerWidth, rise / height],
      surface: "plaster", tint: [.86, .74, .56] });
    add({ shape: "bevel-box", position: [0, spring + height - .025, .54 * .24],
      size: [outerWidth + .10, .065, .54 * .65], surface: "plaster", tint: [.96, .86, .66] });
    const top = spring + rise + thickness * 1.35;
    for (let index = 0; index < 7; index++) add({ shape: "bevel-box",
      position: [(index - 3) * .39, top + .07, 0], size: [.11, .15, .19],
      surface: "cut-stone", tint: [.94, .87, .72] });
  }
  return parts;
};

/** Battered masonry posts and a supported moulded cavetto crown; central passage stays completely open. */
export const nubianRoadPortalParts = (definition: RoadDecorationDefinition,
  detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), opening = definition.opening!;
  const postX = opening.width / 2 + .29, head = opening.height + .24;
  for (const side of [-1, 1]) {
    add({ shape: "bevel-box", position: [side * postX, head / 2, 0], size: [.46, head, .57],
      topScale: [.82, 1, .86], surface: "cut-stone", tint: [.93, .79, .54] });
    add({ shape: "bevel-box", position: [side * postX, .08, 0], size: [.52, .16, .65],
      surface: "cut-stone", tint: [.93, .79, .54] });
    for (const y of detailed ? [.55, .95, 1.35, 1.75] : [.75, 1.45]) {
      add({ shape: "bevel-box", position: [side * postX, y, .292], size: [.18, .21, .025],
        surface: "paint", tint: [.33, .41, .40] });
      add({ shape: "bevel-box", position: [side * postX, y, .313], size: [.08, .14, .02],
        surface: "cut-stone", tint: [.93, .79, .54] });
    }
  }
  add({ shape: "bevel-box", position: [0, head, 0], size: [postX * 2 + .42, .25, .62],
    surface: "cut-stone", tint: [.93, .79, .54] });
  const layers = detailed ? 7 : 3;
  for (let layer = 0; layer < layers; layer++) {
    const t = layer / (layers - 1), projection = .10 * t * t;
    add({ shape: "bevel-box", position: [0, head + .145 + t * .23, 0],
      size: [postX * 2 + .43 + projection * 2, .23 / (layers - 1) + .015, .63 + projection * 2],
      surface: "cut-stone", tint: [.93, .79, .54] });
  }
  return parts;
};

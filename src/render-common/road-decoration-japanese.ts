import type { RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";
import type { BuildingPart } from "./buildings/building-recipe";
import { roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";

const CEDAR: NonNullable<BuildingPart["tint"]> = [.94, .86, .69];
const STONE: NonNullable<BuildingPart["tint"]> = [.84, .86, .87];

/** Two slightly inclined posts, joined nuki, shaped kasagi and supported projecting ends. */
export const japaneseRoadToriiParts = (definition: RoadDecorationDefinition, detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), opening = definition.opening!;
  const postX = opening.width / 2 + .24, nuki = opening.height + .16, top = nuki + .44;
  for (const side of [-1, 1]) {
    add({ shape: "cylinder", position: [side * postX, .055, 0], size: [.39, .11, .39],
      radialSegments: detailed ? 20 : 8, surface: "stone", tint: STONE });
    add({ shape: "cylinder", position: [side * (postX - .015), top / 2 + .003, 0],
      rotation: [0, 0, side * .019], size: [.23, top, .23], radialSegments: detailed ? 20 : 8,
      surface: "wood", tint: CEDAR });
    for (const y of [.13, nuki - .10]) add({ shape: "ring", position: [side * (postX - .019 * y), y, 0],
      size: [.255, .045, .255], radialSegments: detailed ? 20 : 8,
      surface: "iron", tint: [.43, .40, .32] });
  }
  add({ shape: "bevel-box", position: [0, nuki, 0], size: [postX * 2 + .55, .17, .22],
    surface: "wood", tint: CEDAR });
  add({ shape: "bevel-box", position: [0, nuki + .26, 0], size: [.13, .39, .16], surface: "wood", tint: CEDAR });
  const width = (postX + .46) * 2;
  parts.push({ kind: "swept-beam", position: [0, top, 0], size: [width, .17, .31],
    sweep: .14, surface: "wood", tint: CEDAR });
  parts.push({ kind: "swept-beam", position: [0, top + .095, 0], size: [width + .02, .045, .36],
    sweep: .14, surface: "wood", tint: [.25, .19, .12] });
  return parts;
};

/** Actual open fire chamber, four posts, moulded support, swept stone roof and carved jewel. */
export const roadsideStoneLanternParts = (definition: RoadDecorationDefinition,
  detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts);
  const chinese = definition.nation === "chinese", segments = detailed ? 16 : 8;
  if (chinese) {
    // A hexagonal pavilion chamber on a tiered pedestal distinguishes this from the Japanese garden lantern.
    for (const [y, diameter, height] of [[.05, .34, .10], [.16, .25, .12], [.31, .17, .22],
      [.44, .27, .07], [.51, .33, .07], [.79, .34, .06]] as const)
      add({ shape: "cylinder", position: [0, y, 0], size: [diameter, height, diameter],
        radialSegments: 6, surface: "cut-stone", tint: STONE });
    for (let index = 0; index < 6; index++) {
      const angle = index * Math.PI / 3;
      add({ shape: "cylinder", position: [Math.sin(angle) * .125, .65, Math.cos(angle) * .125],
        size: [.033, .23, .033], radialSegments: detailed ? 8 : 4, surface: "cut-stone", tint: STONE });
    }
    for (const [y, diameter, height] of [[.85, .48, .09], [.92, .34, .08], [.98, .22, .06]] as const)
      add({ shape: "cone", position: [0, y, 0], size: [diameter, height, diameter], radialSegments: 6,
        topScale: [.52, 1, .52], surface: "cut-stone", tint: STONE });
    add({ shape: "sphere", position: [0, 1.05, 0], size: [.075, .10, .075],
      radialSegments: detailed ? 10 : 5, surface: "cut-stone", tint: STONE });
    return parts;
  }
  add({ shape: "bevel-box", position: [0, .04, 0], size: [.32, .08, .32], surface: "cut-stone", tint: STONE });
  add({ shape: "cylinder", position: [0, .13, 0], size: [.21, .13, .21], radialSegments: segments,
    surface: "cut-stone", tint: STONE });
  add({ shape: "cylinder", position: [0, .29, 0], size: [.115, .29, .115], radialSegments: segments,
    surface: "cut-stone", tint: STONE });
  for (const y of [.17, .44]) add({ shape: "bevel-box", position: [0, y, 0], size: [.22, .06, .22],
    surface: "cut-stone", tint: STONE });
  add({ shape: "bevel-box", position: [0, .50, 0], size: [.31, .07, .31], surface: "cut-stone", tint: STONE });
  for (const x of [-.112, .112]) for (const z of [-.112, .112]) add({ shape: "bevel-box",
    position: [x, .64, z], size: [.04, .23, .04], surface: "cut-stone", tint: STONE });
  add({ shape: "bevel-box", position: [0, .77, 0], size: [.30, .055, .30], surface: "cut-stone", tint: STONE });
  parts.push({ kind: "lantern-roof", position: [0, .80, 0], size: [chinese ? .46 : .44, .14, chinese ? .46 : .44],
    surface: "cut-stone", tint: STONE });
  add({ shape: "sphere", position: [0, .95, 0], size: [.09, .12, .09], radialSegments: detailed ? 12 : 6,
    surface: "cut-stone", tint: STONE });
  add({ shape: "cone", position: [0, 1.015, 0], size: [.065, .085, .065], radialSegments: detailed ? 12 : 6,
    surface: "cut-stone", tint: STONE });
  if (chinese) for (const side of [-1, 1]) add({ shape: "bevel-box", position: [side * .117, .64, 0],
    size: [.025, .18, .025], rotation: [0, 0, side * .38], surface: "cut-stone", tint: STONE });
  return parts;
};

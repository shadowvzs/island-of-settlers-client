import type { RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";
import type { BuildingPart } from "./buildings/building-recipe";
import { roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";

/** Separate dressed voussoirs and stacked rusticated piers; no solid hidden backing across the road. */
export const romanRoadArchParts = (definition: RoadDecorationDefinition, detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts);
  const opening = definition.opening!, half = opening.width / 2, spring = opening.height + .05;
  const pier = half + .23, inner = pier - .14, depth = .48;
  const baseTint: BuildingPart["tint"] = [.91, .87, .75];
  for (const side of [-1, 1]) {
    const x = side * pier, courses = detailed ? 8 : 5, plinth = .14;
    add({ shape: "box", position: [x, (spring + plinth) / 2, 0], size: [.26, spring - plinth, depth - .025],
      surface: "plaster", tint: [.69, .68, .64] });
    add({ shape: "bevel-box", position: [x, plinth / 2, 0], size: [.42, plinth, .58],
      surface: "cut-stone", tint: baseTint });
    for (let row = 0; row < courses; row++) {
      const height = (spring - plinth) / courses;
      add({ shape: "bevel-box", position: [x, plinth + height * (row + .5), 0],
        size: [.28 + (row % 2) * .014, height - .006, depth], surface: "cut-stone",
        tint: [.88 + .025 * (row % 3), .84 + .018 * (row % 3), .73 + .017 * (row % 3)] });
    }
    add({ shape: "bevel-box", position: [x, spring - .015, 0], size: [.43, .12, .61],
      surface: "cut-stone", tint: baseTint });
    if (definition.variant === 1) {
      add({ shape: "civic-column-shaft", position: [x + side * .23, spring * .5, .19],
        size: [.18, spring - .2, .18], surface: "cut-stone", tint: baseTint });
      for (const y of [.16, spring - .12]) add({ shape: "bevel-box", position: [x + side * .23, y, .19],
        size: [.25, .1, .25], surface: "cut-stone", tint: baseTint });
    }
  }
  const count = 13;
  for (let index = 0; index < count; index++) parts.push({ kind: "arch-stone", position: [0, spring, 0],
    innerRadius: inner, thickness: .28, depth, from: index / count * Math.PI + .003,
    to: (index + 1) / count * Math.PI - .003, surface: "cut-stone",
    tint: [.88 + index % 3 * .023, .84 + index % 3 * .019, .73 + index % 3 * .018] });
  for (let index = 1; index < count; index++) parts.push({ kind: "arch-stone", mortar: true,
    position: [0, spring, 0], innerRadius: inner + .008, thickness: .264, depth: depth - .025,
    from: index / count * Math.PI - .004, to: index / count * Math.PI + .004,
    surface: "plaster", tint: [.69, .68, .64] });
  if (definition.variant === 1) {
    const top = spring + inner + .28;
    add({ shape: "bevel-box", position: [0, top + .055, 0], size: [1.05, .13, .59],
      surface: "cut-stone", tint: baseTint });
    add({ shape: "bevel-box", position: [0, top + .18, .02], size: [.71, .16, .48],
      surface: "cut-stone", tint: baseTint });
    add({ shape: "bevel-box", position: [0, top + .18, .277], size: [.56, .075, .025],
      surface: "paint", tint: [.42, .30, .17] });
  }
  return parts;
};

import type { RoadDecorationStoneFamily } from "../shared/settlement/road-decoration-catalog";
import { roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";

/** Unregistered rough rubble/mortar alternative: irregular quarry stones and actual open annular vault. */
export const createRubbleRoadArchRecipe = (detailed: boolean, stoneFamily: RoadDecorationStoneFamily = "limestone") => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts);
  const pier = 1.46, spring = 2.18, courses = detailed ? 7 : 5, inner = 1.23;
  for (const side of [-1, 1]) {
    add({ shape: "bevel-box", position: [side * pier, .06, 0], size: [.52, .12, .62], surface: "cut-stone", tint: [.86, .84, .77] });
    add({ shape: "box", position: [side * pier, (spring + .12) / 2, 0], size: [.32, spring - .12, .20],
      surface: "plaster", tint: [.69, .68, .63] });
    for (let course = 0; course < courses; course++) {
      const height = (spring - .12) / courses;
      parts.push({ kind: "rubble-stone", seed: course + (side > 0 ? 2 : 0),
        position: [side * pier + Math.sin(course * 1.7) * .013, .12 + height * (course + .5), .006 * Math.sin(course)],
        rotation: [0, .025 * Math.sin(course * 2), .012 * Math.cos(course)], size: [.45, height + .006, .57],
        surface: "cut-stone", tint: [.91 - course % 3 * .018, .88 - course % 3 * .017, .79 - course % 3 * .013] });
    }
  }
  const keyHalf = .08, leftEnd = Math.PI / 2 - keyHalf, jointHalf = .002;
  const intervals: Array<[number, number, boolean]> = [];
  for (let index = 0; index < 6; index++) intervals.push([index / 6 * leftEnd, (index + 1) / 6 * leftEnd, false]);
  intervals.push([leftEnd, Math.PI / 2 + keyHalf, true]);
  for (let index = 0; index < 6; index++) intervals.push([
    Math.PI / 2 + keyHalf + index / 6 * leftEnd, Math.PI / 2 + keyHalf + (index + 1) / 6 * leftEnd, false]);
  intervals.forEach(([from, to, keystone], index) => {
    // The same fitted quarry units continue around the vault. Mortar occupies only the tiny joint,
    // never a complete front-facing annulus that can mask the irregular stone surfaces.
    if (index) parts.push({ kind: "arch-stone", mortar: true, position: [0, spring, 0], innerRadius: inner + .008,
      thickness: .40, depth: .51, from: from - jointHalf, to: from + jointHalf,
      surface: "plaster", tint: [.75, .74, .70] });
    parts.push({ kind: "arch-stone", rubble: index % 4, position: [0, spring, 0], innerRadius: inner,
      thickness: .42, depth: .57,
      from: index === 0 ? from : from + jointHalf,
      to: index === intervals.length - 1 ? to : to - jointHalf, surface: "cut-stone",
      tint: keystone && stoneFamily === "marble" ? [.98, .98, .97]
        : [.90 - index % 3 * .02, .88 - index % 3 * .015, .80 - index % 3 * .016] });
  });
  return { definition: { id: "rubble-mortar-arch" }, parts, wind: 0 as const, stoneFamily };
};

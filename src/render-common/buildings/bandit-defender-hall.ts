import { banditDefenderHallSize, type BanditSiteRef } from "./bandit-camp-plan";
import type { BuildingPart, Point3 } from "./building-recipe";
import type { Add } from "./nation-kit-parts";
import { enemyBuildingDesign, type EnemyBuildingStyle } from "./themed-neutral-building-style";

/** A freestanding refuge with a real doorway and firing openings, without a perimeter wall. */
export const addBanditDefenderHall = (add: Add, site: BanditSiteRef, style: EnemyBuildingStyle) => {
  const design = enemyBuildingDesign(style);
  const { depth, front, width } = banditDefenderHallSize(site);
  const back = front - depth, height = 1.55;
  const box = (position: Point3, size: Point3, surface: BuildingPart["surface"], stage = 2) =>
    add({ position, size, surface, stage, shape: "box" });
  box([0, 0.045, front - depth / 2], [width, 0.09, depth], "stone", 1);
  box([0, height / 2, back], [width, height, 0.1], design.walls, 1);
  for (const side of [-1, 1]) {
    box(
      [side * (width / 2 - 0.05), height / 2, front - depth / 2],
      [0.1, height, depth],
      design.walls,
      1
    );
    const wing = (width - 0.76) / 2,
      centre = side * (0.38 + wing / 2),
      window = Math.min(0.28, wing - 0.12);
    const jamb = (wing - window) / 2;
    for (const edge of [-1, 1])
      box(
        [centre + (edge * (window + jamb)) / 2, height / 2, front],
        [jamb, height, 0.1],
        design.walls,
        1
      );
    box([centre, 0.4, front], [window, 0.8, 0.1], design.walls, 1);
    box([centre, 1.325, front], [window, 0.45, 0.1], design.walls, 1);
    box([centre, 0.95, front - 0.025], [window, 0.3, 0.012], "dark");
    box([centre, 0.79, front + 0.035], [window + 0.08, 0.045, 0.16], "wood");
    box([side * 0.43, 0.6, front + 0.01], [0.1, 1.2, 0.12], "wood", 1);
    for (const z of [back, front])
      box([side * (width / 2 - 0.045), height / 2, z], [0.11, height, 0.13], "wood", 1);
  }
  box([0, 1.375, front], [0.76, 0.35, 0.1], design.walls, 1);
  box([0, 1.23, front + 0.035], [0.98, 0.09, 0.16], "wood");
  add({
    position: [0, height + 0.25, front - depth / 2],
    size: [width + 0.14, 0.5, depth + 0.16],
    shape: "occupation-roof",
    occupationRoof: design.profile,
    surface: design.snow ? "plaster" : design.roof,
    stage: 4
  });
  for (const end of [-1, 1])
    add({
      position: [0, height + 0.25, front - depth / 2 + end * (depth / 2 - 0.02)],
      size: [width, 0.5, 0.06],
      shape: "roof-infill",
      occupationRoof: design.profile,
      roofInfillRatio: [width / (width + 0.14), (depth - 0.04) / (depth + 0.16)],
      surface: design.walls,
      stage: 3
    });
  box([width / 2 - 0.2, 0.32, front - depth + 0.25], [0.22, 0.5, 0.025], "cloth", 3);
};

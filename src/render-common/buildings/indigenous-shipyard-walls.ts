import type { BuildingRecipe, Point3 } from "./building-recipe";
import type { NationBody } from "./nation-kit-classify";
import { type Add, doorGapOf } from "./nation-kit-parts";

/** The store/work room is enclosed; the independent slipway shelter remains an open working bay. */
export const addIndigenousShipyardWalls = (add: Add, original: BuildingRecipe, body: NationBody) => {
  for (const wall of body.walls) {
    const normal = wall.along === 0 ? 2 : 0;
    const centre: Point3 = [(wall.min[0] + wall.max[0]) / 2,
      (wall.min[1] + wall.max[1]) / 2, (wall.min[2] + wall.max[2]) / 2];
    const size: Point3 = [wall.max[0] - wall.min[0], wall.height, wall.max[2] - wall.min[2]];
    size[normal] = .028;
    add({ position: centre, shape: "bevel-box", size, stage: 2, surface: "cloth-reeds" });
    // Thin stitched panels are fixed to visible rails, rather than pretending to be thick masonry.
    for (const fraction of [.12, .5, .88]) {
      const position: Point3 = [...centre];
      position[1] = wall.base + wall.height * fraction;
      position[normal] += .023;
      const rail: Point3 = [...size];
      rail[1] = .018; rail[normal] = .018;
      add({ position, shape: "box", size: rail, stage: 2, surface: "wood" });
    }
    for (const end of [-1, 1]) {
      const position: Point3 = [...centre];
      position[wall.along] += end * Math.max(0, wall.length / 2 - .018);
      add({ position, shape: "cylinder", size: [.032, wall.height, .032],
        stage: 1, surface: "bark", radialSegments: 6 });
    }
  }
  const door = doorGapOf(original);
  const front = body.walls.filter(wall => wall.along === 0 &&
    Math.abs((wall.min[2] + wall.max[2]) / 2 - door.z) < .15);
  const top = Math.max(door.top, ...front.map(wall => wall.max[1]));
  const existingHeaders = front.filter(wall => wall.min[0] <= door.left + .001 &&
    wall.max[0] >= door.right - .001 && wall.base >= door.top - .001);
  const headerTop = Math.min(top, ...existingHeaders.map(wall => wall.base));
  if (headerTop > door.top + .025) add({ position: [(door.left + door.right) / 2,
    (headerTop + door.top) / 2, door.z], shape: "bevel-box",
    size: [door.right - door.left, headerTop - door.top, .028],
    stage: 2, surface: "cloth-reeds" });
  for (const x of [door.left - .025, door.right + .025]) add({ position: [x, door.top / 2, door.z],
    shape: "cylinder", size: [.035, door.top, .035], stage: 1, surface: "bark", radialSegments: 6 });
};

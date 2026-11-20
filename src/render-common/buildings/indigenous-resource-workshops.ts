import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import type { NationBody, WallRun } from "./nation-kit-classify";
import { type Add, doorGapOf } from "./nation-kit-parts";

/** Bonded courses retain the canonical wall/door void; exposed boulders are genuinely dimensional. */
const rubbleWall = (add: Add, wall: WallRun, detailed: boolean, seed: number) => {
  const normal = wall.along === 0 ? 2 : 0;
  const thickness = wall.max[normal] - wall.min[normal];
  const centre: Point3 = wall.min.map((value, axis) => (value + wall.max[axis]!) / 2) as Point3;
  const core: Point3 = [wall.max[0] - wall.min[0], wall.height, wall.max[2] - wall.min[2]];
  // Mortar belongs behind the broad fractured faces. A thick core hid the stones' shoulders
  // and left only little tips exposed, making real masonry read as pebble-spotted plaster.
  core[normal] *= .16;
  add({ architecture: true, position: centre, shape: "box", size: core,
    stage: 1, surface: "indigenous-rubble", worldUv: 4 });
  const rows = Math.max(1, Math.ceil(wall.height / (detailed ? .23 : .31)));
  const weights = Array.from({ length: rows }, (_, row) => 1 + Math.sin(seed * .41 + row * 2.17) * .18);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let bottom = wall.base;
  for (let row = 0; row < rows; row++) {
    const course = wall.height * weights[row]! / total;
    const count = Math.max(1, Math.ceil(wall.length / .32));
    const cuts = [0, ...Array.from({ length: count - 1 }, (_, index) =>
      (index + 1 + (row % 2 ? .35 : -.12) + Math.sin(seed + row * 4.7 + index * 2.3) * .10) / count), 1];
    for (let index = 0; index < cuts.length - 1; index++) {
      const start = cuts[index]!, end = cuts[index + 1]!;
      const position: Point3 = [...centre], size: Point3 = [...core];
      position[wall.along] = wall.min[wall.along] + wall.length * (start + end) / 2;
      position[1] = bottom + course / 2;
      size[wall.along] = wall.length * (end - start) * (detailed ? 1 : .985);
      size[1] = course * (detailed ? .995 : .985);
      size[normal] = thickness;
      const oriented: Point3 = [size[wall.along], size[1], thickness];
      add({ architecture: true, decorVariant: seed + row * 17 + index,
        indigenousMasonryStone: true, position, rotation: normal === 0 ? [0, Math.PI / 2, 0] : undefined,
        shape: "structural-rock", size: oriented, stage: 1, surface: "stone" });
    }
    bottom += course;
  }
};

/** Timber nursery and masonry quarry are actual rooms; small original trims are not new walls. */
export const addIndigenousResourceWalls = (add: Add, original: BuildingRecipe,
  body: NationBody, detailed: boolean, masonry: boolean) => {
  const door = doorGapOf(original);
  const walls = body.walls.filter(wall => wall.length > .2).map(wall => {
    if (masonry && wall.along === 0 && wall.base >= door.top - .001 &&
      wall.min[0] <= door.left && wall.max[0] >= door.right) {
      const min: Point3 = [...wall.min]; min[1] = Math.max(wall.base, door.top + .062);
      // The hinge reveal stops below the lintel. Above it masonry closes all the way to the
      // shortened left return; retaining the old door-width header left a tall open slot here.
      min[0] -= .065;
      return { ...wall, base: min[1], height: wall.max[1] - min[1], length: wall.length + .065, min };
    }
    if (!masonry || wall.along !== 0 || Math.abs(wall.max[0] - door.left) > .001 ||
      Math.abs((wall.min[2] + wall.max[2]) / 2 - door.z) > .1) return wall;
    // The conserved hinge is recessed in the wall. A stepped reveal clears the real timber
    // leaf and iron straps through ninety degrees without moving that canonical pivot.
    const max: Point3 = [...wall.max]; max[0] -= .065;
    return { ...wall, length: wall.length - .065, max };
  });
  for (const [index, wall] of walls.entries()) {
    if (masonry) { rubbleWall(add, wall, detailed, index * 101); continue; }
    const normal = wall.along === 0 ? 2 : 0;
    const position: Point3 = wall.min.map((value, axis) => (value + wall.max[axis]!) / 2) as Point3;
    const size: Point3 = [wall.max[0] - wall.min[0], wall.height, wall.max[2] - wall.min[2]];
    size[normal] = .055;
    add({ architecture: true, position, shape: "bevel-box", size, stage: 1,
      surface: "planks", worldUv: 1 });
    for (const fraction of [0, 1]) {
      const post: Point3 = [...position];
      post[wall.along] = wall.min[wall.along] + .035 + fraction * (wall.length - .07);
      add({ architecture: true, position: post, radialSegments: detailed ? 8 : 5,
        shape: "cylinder", size: [.065, wall.height, .065], stage: 1, surface: "bark" });
    }
    for (const height of [.065, wall.height - .025]) {
      const rail: Point3 = [...position], dimensions: Point3 = [...size];
      rail[1] = wall.base + height; dimensions[1] = .05; dimensions[normal] = .07;
      add({ architecture: true, position: rail, shape: "box", size: dimensions, stage: 2, surface: "wood" });
    }
  }
  if (masonry) add({ architecture: true,
    position: [door.left - .0325, door.top / 2, door.z - .065], shape: "bevel-box",
    size: [.065, door.top, .05], stage: 1, surface: "indigenous-rubble", worldUv: 4 });
  const top = Math.max(...walls.map(wall => wall.max[1]));
  const lintelHeight = masonry ? .065 : top - door.top;
  if (lintelHeight > 0) add({ architecture: true,
    position: [(door.left + door.right) / 2, door.top + lintelHeight / 2, door.z - .025],
    shape: "bevel-box", size: [door.right - door.left + (masonry ? .28 : 0), lintelHeight, .11],
    stage: 2, surface: "wood" });
  // Continuous wall plate carries the weather cover and joins the separate front wall returns.
  const rear = walls.find(wall => wall.along === 0 && wall.base < .1 && wall.min[2] < 0);
  if (rear) for (const z of [rear.min[2] + .055, door.z - .025]) add({ architecture: true,
    position: [(rear.min[0] + rear.max[0]) / 2, top + .025, z],
    shape: "box", size: [rear.length, .05, .09], stage: 2, surface: "wood" });
};

/** Chisels hang on the actual inner rear wall, leaving the requested front quarry mural unobstructed. */
export const mountIndigenousQuarryToolsInside = (parts: BuildingPart[]) => {
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part.stock || part.workyardAssembly !== "resource-19" || part.position[1] < .5 ||
      part.position[0] < -.65 || part.position[0] > -.15 || part.position[2] < .64) continue;
    parts[index] = { ...part, position: [part.position[0], part.position[1], part.position[2] - 1.145] };
  }
};

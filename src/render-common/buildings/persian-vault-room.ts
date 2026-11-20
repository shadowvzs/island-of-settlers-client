import type { BuildingRecipe, Point3 } from "./building-recipe";
import type { Add } from "./nation-kit-parts";

/** A real curved end wall fills the oval room right up to the barrel skin's underside. */
export const addPersianVaultCap = (add: Add, x: number, z: number, width: number, depth: number,
  wallTop: number, rise: number, ratio = 1, turned = false, detailed = true) => {
  const height = rise * .87, springing = wallTop - .06 * rise + .002;
  const rotation: Point3 | undefined = turned ? [0, Math.PI / 2, 0] : undefined;
  // The cap sits just inside the room shell: equal-width hollow walls used to fight the room's
  // outer face along their 6 % overlap (dashed white seams at the vault springing).
  add({ compactGeometry: true, radialSegments: detailed ? 16 : 6, occupationRoof: "barrel", persianOpening: [0, 0, -.5], roofInfillRatio: [ratio, 1],
    position: [x, springing + height / 2, z], rotation,
    shape: "persian-room", size: [width - .006, height, depth - .006], stage: 2, surface: "plaster" });
  // One open springer course covers the room wall, cap and barrel's shared springing line.
  add({ position: [x, springing + .02, z], radialSegments: detailed ? 24 : 8,
    rotation, shape: "cylinder", openEnded: true, size: [width + .012, .06, depth + .012],
    topScale: [.98, 1, .98], stage: 2, surface: "plaster" });
};

export const addPersianVaultRoom = (add: Add, original: BuildingRecipe,
  room: { x: number; z: number; width: number; depth: number; height: number; rise: number }, detailed = true) => {
  const { depth, height, rise, width, x, z } = room;
  const left = original.door[0], right = left + (original.doorDimensions?.width ?? .46);
  add({ persianOpening: [(left - x - .13) / width, (right - x + .13) / width,
    ((original.doorDimensions?.height ?? .77) + .13) / height - .5], position: [x, height / 2, z],
    shape: "persian-room", size: [width, height, depth], stage: 1, surface: "plaster" });
  addPersianVaultCap(add, x, z, width, depth, height, rise, 1, false, detailed);
  add({ radialSegments: detailed ? 16 : 6, occupationRoof: "barrel", position: [x, height + rise * .44, z], shape: "occupation-roof",
    size: [width, rise, depth], stage: 3, surface: "roof" });
};

/** The civic audience chamber is a full circular domed mass, not a barrel house with a roof trinket. */
export const addPersianDomedRoom = (add: Add, original: BuildingRecipe, detailed: boolean) => {
  const x = 0, z = -.36, width = 2.05, depth = 2.10, height = 1.76;
  const left = original.door[0], right = left + (original.doorDimensions?.width ?? .46);
  add({ persianOpening: [(left - .13) / width, (right + .13) / width,
    ((original.doorDimensions?.height ?? .77) + .13) / height - .5],
    position: [x, height / 2, z], shape: "persian-room", size: [width, height, depth],
    stage: 1, surface: "plaster" });
  // Open cornice tube, not a capped cylinder: its top cap used to read as a bright shelf at night.
  // It stops 2 mm inside the dome springing so the dome lip hides the open rim from above.
  add({ position: [x, height, z], shape: "cylinder", radialSegments: detailed ? 40 : 16,
    openEnded: true, size: [2.076, .12, 2.076], stage: 3, surface: "plaster" });
  add({ position: [x, height + .06 + .60, z], shape: "ogive-dome", radialSegments: detailed ? 40 : 16,
    size: [2.08, 1.20, 2.08], stage: 3, surface: "roof" });
};

/** Supported open longitudinal vault: the actual roof spring feet sit on deep masonry side piers. */
export const addPersianIwan = (add: Add, x: number, z: number, width: number, depth: number,
  spring: number, rise: number, pierWidth = .16, detailed = true) => {
  for (const side of [-1, 1]) add({ position: [x + side * (width / 2 - pierWidth * .4), spring / 2, z],
    shape: "bevel-box", size: [pierWidth, spring, depth], stage: 1, surface: "plaster" });
  add({ radialSegments: detailed ? 16 : 6, occupationRoof: "barrel", position: [x, spring + rise * .44, z], shape: "occupation-roof",
    size: [width, rise, depth], stage: 3, surface: "roof" });
};

/** Reuse the tagged occupation painting on an actual supported plaster keystone plaque. */
export const addPersianCivicPlaque = (add: Add, original: BuildingRecipe, face: Point3) => {
  const ink = original.parts.filter(part => part.occupationSign && part.surface === "paint");
  if (!ink.length) return;
  const lo = (axis: 0 | 1) => Math.min(...ink.map(part => part.position[axis] - part.size[axis] / 2));
  const hi = (axis: 0 | 1) => Math.max(...ink.map(part => part.position[axis] + part.size[axis] / 2));
  const cx = (lo(0) + hi(0)) / 2, cy = (lo(1) + hi(1)) / 2;
  const scale = Math.min(1, .29 / (hi(0) - lo(0)), .14 / (hi(1) - lo(1)));
  const front = Math.min(...ink.map(part => part.position[2]));
  add({ position: [face[0], face[1], face[2] - .045], shape: "bevel-box",
    size: [.36, .19, .09], stage: 3, surface: "plaster" });
  for (const part of ink) add({ ...part,
    position: [face[0] + (part.position[0] - cx) * scale, face[1] + (part.position[1] - cy) * scale,
      face[2] + part.position[2] - front + .002],
    size: [part.size[0] * scale, part.size[1] * scale, part.size[2]] });
};

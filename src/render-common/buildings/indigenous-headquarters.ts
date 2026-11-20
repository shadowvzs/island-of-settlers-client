import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { addIndigenousLodge } from "./indigenous-lodges";
import type { Add } from "./nation-kit-parts";
import { runBetween } from "./nation-kit-parts";

const COUNCIL = { centreZ: -.45, depth: 2.60, height: 3.25, width: 3.0 };

/** Flared textile collars lap over the great council cone, carried by the same concealed radial poles. */
const addCouncilCollar = (add: Add, base: number, width: number, depth: number, rise: number,
  bearingY: number, detailed: boolean) => {
  const { centreZ, height } = COUNCIL;
  add({ indigenousRoof: "tipi", position: [0, base + rise / 2, centreZ], shape: "indigenous-roof",
    size: [width, rise, depth], stage: 3, surface: "cloth" });
  const share = (bearingY - .025) / (height - .14 - .025);
  const rx = COUNCIL.width * .4 * (1 - share), rz = COUNCIL.depth * .4 * (1 - share);
  add({ position: [0, bearingY, centreZ], radialSegments: detailed ? 32 : 16,
    shape: "ring", size: [rx * 2 + .045, .045, rz * 2 + .045], stage: 3, surface: "rope" });
  const count = detailed ? 10 : 6;
  for (let index = 1; index < count; index++) {
    const angle = index * Math.PI * 2 / count, sx = Math.sin(angle), sz = Math.cos(angle);
    runBetween(add, [sx * rx, bearingY, centreZ + sz * rz],
      [sx * width * .45, base + rise * .1 - .065, centreZ + sz * depth * .45], [.025, .025],
      { stage: 3, surface: "wood" });
  }
};

const addCouncilFringe = (add: Add, detailed: boolean) => {
  const count = detailed ? 24 : 12;
  for (let index = 0; index < count; index++) {
    const angle = index * Math.PI * 2 / count;
    const x = Math.sin(angle) * 1.225, z = COUNCIL.centreZ + Math.cos(angle) * 1.075;
    let length = index % 3 === 0 ? .14 : .09;
    if (Math.cos(angle) > .9 && Math.abs(x) < .4) length = .06;
    runBetween(add, [x, .951, z], [x, .95 - length, z], [.007, .007], { stage: 4, surface: "rope" });
    add({ position: [x, .95 - length, z], radialSegments: detailed ? 7 : 4,
      shape: "sphere", size: [.026, .035, .026], stage: 4, surface: "paint",
      tint: index % 3 === 0 ? [.27, .43, .39] : [.70, .37, .19] });
  }
};

const addCouncilDrum = (add: Add, x: number, detailed: boolean) => {
  add({ position: [x, .21, 1.03], radialSegments: detailed ? 20 : 10,
    shape: "cylinder", size: [.32, .42, .32], stage: 3, surface: "wood" });
  add({ position: [x, .425, 1.03], radialSegments: detailed ? 20 : 10,
    shape: "cylinder", size: [.33, .015, .33], stage: 3, surface: "hide" });
  for (const y of [.07, .36, .414]) add({ position: [x, y, 1.03], radialSegments: detailed ? 20 : 10,
    shape: "ring", size: [.345, .025, .345], stage: 4, surface: "rope" });
  const count = detailed ? 10 : 5;
  for (let index = 0; index < count; index++) {
    const angle = index * Math.PI * 2 / count;
    runBetween(add, [x + Math.sin(angle) * .166, .09, 1.03 + Math.cos(angle) * .166],
      [x + Math.sin(angle + .24) * .166, .39, 1.03 + Math.cos(angle + .24) * .166], [.006, .006],
      { stage: 4, surface: "rope" });
  }
};

/** A prestigious unified council tent, rather than an ordinary lodge with workshop lean-tos. */
export const createIndigenousHeadquartersRecipe = (original: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = original.parts.filter(part => part.stock);
  const add: Add = part => parts.push({ compactGeometry: true, stage: 1, ...part,
    surface: part.shape === "indigenous-roof" && part.size[1] > 3 ? "cloth-council" : part.surface,
    tint: part.shape === "indigenous-roof" && part.size[1] < 3 ? [.86, .65, .4] : part.tint });
  const { centreZ, depth, height, width } = COUNCIL;
  const hall = { doorSurround: [], keep: [], walls: [], roofs: [{
    min: [-width / 2 - .04, 0, centreZ - depth / 2 - .04] as Point3,
    max: [width / 2 + .04, height, centreZ + depth / 2 + .04] as Point3
  }] };
  addIndigenousLodge(add, original, hall, false, detailed, height, height, [], true);
  addCouncilCollar(add, .95, 2.45, 2.15, 1.18, 1.30, detailed);
  addCouncilCollar(add, 2.45, 1.10, .96, .60, 2.55, detailed);
  addCouncilFringe(add, detailed);
  for (const x of [original.door[0] - .045,
    original.door[0] + (original.doorDimensions?.width ?? .46) + .045])
    for (const y of [.16, .61]) add({ position: [x, y, original.door[2]],
      radialSegments: detailed ? 12 : 6, shape: "ring", size: [.055, .035, .055], stage: 4, surface: "rope" });
  addCouncilDrum(add, -1.34, detailed); addCouncilDrum(add, 1.34, detailed);
  if (original.flagAnchor && !original.hideFlag) {
    const [x, y, z] = original.flagAnchor, mastX = -1.67;
    add({ position: [mastX, y / 2, z], radialSegments: detailed ? 10 : 5,
      shape: "cylinder", size: [.055, y, .055], stage: 2, surface: "wood" });
    runBetween(add, [mastX, y, z], [x, y, z], [.035, .035], { stage: 2, surface: "wood" });
    runBetween(add, [mastX, y - .35, z], [x - .05, y - .025, z], [.025, .025],
      { stage: 3, surface: "wood" });
  }
  return { ...original, parts, tentDoor: true };
};

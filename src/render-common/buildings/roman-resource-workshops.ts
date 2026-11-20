import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingSurface, Point3 } from "./building-recipe";
import { withBuildingStock } from "./building-stock-parts";
import {
  addFishingEquipment,
  addFishingNet,
  addMasonryEquipment,
  addNurseryEquipment} from "./roman-workshop-equipment";

export type AddPart = (
  surface: BuildingSurface,
  position: Point3,
  size: Point3,
  stage?: number,
  shape?: BuildingPart["shape"],
  rotation?: Point3,
  tint?: Point3,
  stock?: BuildingPart["stock"],
  windCordSlot?: number
) => unknown;

/** Grounded occupation yards share Roman materials, but have distinct silhouettes. */
export const addRomanResourceWorkshop = (
  id: number,
  part: AddPart,
  width: number,
  depth: number,
  detailed: boolean
) => {
  if (detailed && id === 18) addFishingEquipment(part, width, depth);
  if (detailed && id === 20) addNurseryEquipment(part, width, depth);
  if (detailed && id === 19) addMasonryEquipment(part, width, depth);
  const x = width / 2 + 0.32;
  const z = -depth * 0.12;
  if (id === 20) {
    // A shallow wall-mounted nursery preserves the cottage and leaves the doorway lane clear.
    const nurseryX = width / 2 + 0.11;
    for (const end of [-1, 1])
      part("wood", [nurseryX + 0.06, 0.5825, end * 0.59], [0.035, 0.805, 0.035], 2);
    part("wood", [nurseryX + 0.06, 0.977, 0], [0.04, 0.06, 1.215], 2);
    part("roof", [nurseryX, 1.04, 0], [0.24, 0.065, 1.26], 4, "box", [0, 0, -0.29]);
    part("wood", [nurseryX, 0.325, 0], [0.23, 0.05, 1.17], 3);
    for (const end of [-1, 1]) {
      part("wood", [nurseryX - 0.005, 0.27, end * 0.49], [0.22, 0.07, 0.04], 2);
      part("wood", [width / 2 + 0.035, 0.315, end * 0.49], [0.07, 0.1, 0.06], 2);
    }
    for (let seedling = 0; seedling < 6; seedling++) {
      const seedZ = -.465 + seedling * .186;
      part("roof", [nurseryX + .005, .3875, seedZ], [.115, .075, .115], 3, "cylinder");
      part("dark", [nurseryX + .005, .425, seedZ], [.097, .009, .097], 3, "cylinder");
      addRomanSeedling(withBuildingStock(part, "seedling", seedling), nurseryX + .005, .426, seedZ, detailed);
    }
  }
  if (id === 18) {
    // Flexible fishing net is tied to three staggered poles beside the stone wall.
    addFishingNet(part, width / 2 + 0.18, -depth * 0.13, detailed);
    part("wood", [x, 0.25, z + 0.97], [0.5, 0.14, 0.3], 3);
    // A boat trip can return four fish to a tray already holding five: three layers of three.
    for (let i = 0; i < 9; i++) {
      const fishPart = withBuildingStock(part, "fish", i);
      const fishX = x - 0.15 + (i % 3) * 0.15;
      const fishZ = z + 0.97;
      const fishY = Math.floor(i / 3) * .09;
      fishPart("fish", [fishX, 0.351 + fishY, fishZ], [0.12, 0.09, 0.29], 3, "fish",
        [0, (i % 3 - 1) * 0.13, 0]);
      if (detailed)
        for (const side of [-1, 1]) {
          fishPart(
            "paint",
            [fishX + side * 0.027, 0.366 + fishY, fishZ - 0.082],
            [0.012, 0.012, 0.012],
            3,
            "sphere",
            undefined,
            [0.7, 0.77, 0.79]
          );
          fishPart(
            "dark",
            [fishX + side * 0.031, 0.368 + fishY, fishZ - 0.083],
            [0.007, 0.007, 0.007],
            3,
            "sphere"
          );
        }
    }
  }
  if (id === 19) {
    // A shallow front-left working bay leaves the main door and public path clear.
    const benchX = -.53, benchZ = .88;
    for (const end of [-1, 1])
      for (const side of [-1, 1])
        part("wood", [benchX + side * .46, .275, benchZ + end * .11], [.075, .19, .075], 2);
    part("wood", [benchX, .42, benchZ], [1.08, .1, .34], 3);
    // Three low pairs hold six stones within the unchanged worker's comfortable reach.
    for (let i = 0; i < 6; i++)
      withBuildingStock(part, "stone", i)("stone",
        [-.87 + (i % 3) * .34, .55 + Math.floor(i / 3) * .16, .94],
        [.3, .16, .3], 3, "stone-block");
    if (detailed) {
      part("wood", [benchX, .484, .747], [.3, .025, .025], 3);
      part("iron", [benchX + .15, .515, .747], [.14, .09, .065], 3);
      part("iron", [benchX - .23, .482, .747], [.1, .022, .022], 3);
    }
  }
};

/** Small broadleaf sapling: visible trunk, branching shoots and paired thin leaves. */
export const addRomanSeedling = (
  part: AddPart,
  x: number,
  base: number,
  z: number,
  _detailed: boolean
) => {
  part("paint", [x, base + .18, z], [.21, .36, .21], 3, "nursery-sapling");
};

/** The nursery pot stays on its shelf; soil and fine roots travel with the sapling. */
export const addRomanSeedlingRootBall = (part: AddPart, base: number, detailed: boolean) => {
  part("dark", [0, base - .023, 0], [.096, .062, .096], 3, "rock",
    undefined, [1.35, .95, .65]);
  if (!detailed) return;
  for (let root = 0; root < 3; root++) {
    const angle = root * Math.PI * 2 / 3;
    part("bark", [DMath.sin(angle) * .018, base - .051, DMath.cos(angle) * .018],
      [.004, .027, .004], 3, "cord", [DMath.cos(angle) * .5, 0, DMath.sin(angle) * .5]);
  }
};

/** Practical windows and stone entry details; painted occupation signs are added separately. */
export const addRomanResourceFacade = (
  id: number,
  part: AddPart,
  width: number,
  depth: number,
  height: number,
  detailed: boolean
) => {
  const front = depth / 2 + 0.075;
  if (id === 20) {
    // Shuttered nursery window; ridge runs across the cottage.
    part("wood", [0.35, 0.81, front], [0.36, 0.38, 0.035], 3);
    part("dark", [0.35, 0.81, front + 0.021], [0.25, 0.26, 0.012], 3, "window-shadow");
    for (const side of [-1, 1])
      part("wood", [0.35 + side * 0.2, 0.81, front], [0.12, 0.32, 0.035], 3);
    if (detailed) {
      // Climbing stems and leaves against the left wall, rooted in the soil.
      for (const z of [-0.32, 0.25]) {
        part("bark", [-width / 2 - 0.013, 0.68, z], [0.018, 1, 0.018], 3);
        for (let i = 0; i < 6; i++)
          part(
            "leaf",
            [-width / 2 - 0.023, 0.3 + i * 0.14, z + (i % 2 ? 0.045 : -0.045)],
            [0.03, 0.11, 0.13],
            3,
            "sphere"
          );
      }
    }
  }
  if (id === 18) {
    // Recognizable fish relief fastened directly to stone, without a decorative backing board.
    part("gold", [-0.4, 1.1, front - 0.015], [0.26, 0.1, 0.025], 3, "sphere");
    // A narrow caudal neck joins the two lobes; the trailing V stays open against the wall.
    part("gold", [-0.272, 1.1, front - 0.015], [0.03, 0.022, 0.025], 3);
    part("gold", [-0.23, 1.1, front - 0.015], [0.11, 0.13, 0.025], 3, "fish-tail");
    part("dark", [-0.48, 1.12, front + 0.001], [0.018, 0.018, 0.009], 3, "sphere");
    part("gold", [-0.4, 1.16, front - 0.015], [0.07, 0.04, 0.02], 3, "box", [0, 0, 0.4]);
  }
  if (id === 19) {
    // Heavy alternating corner blocks and a broad stone lintel frame the mason's entry.
    for (const side of [-1, 1])
      for (let i = 0; i < (detailed ? 5 : 3); i++)
        part(
          "stone",
          [side * (width / 2 - 0.06), 0.28 + i * (detailed ? 0.2 : 0.34), depth / 2 - 0.03],
          [i % 2 ? 0.19 : 0.29, 0.18, 0.2],
          2
        );
    part("stone", [0.38, 1.02, front], [0.73, 0.14, 0.18], 3);
  }
};

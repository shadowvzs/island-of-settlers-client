import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart, Point3 } from "./building-recipe";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";
import { addMayaCatapultEntryHood } from "./catapult-maya-entry-hood";
import type { Add } from "./nation-kit-parts";

const H = CATAPULT_SHAFT_HEIGHT;

const box = (add: Add, detailed: boolean, position: Point3, size: Point3,
  surface: BuildingPart["surface"], tint?: Point3, rotation?: Point3) =>
  add({ position, size, surface, tint, rotation, shape: detailed ? "bevel-box" : "box" });

const chineseFacade = (add: Add, detailed: boolean) => {
  const red: Point3 = [.22, .055, .032];
  for (const side of [-1, 1]) {
    for (const z of [-.61, .61]) box(add, detailed, [side * .705, H / 2, z], [.065, H, .08], "paint", red);
    for (const y of [.20, 1.35, 2.34]) box(add, detailed, [side * .705, y, 0], [.065, .08, 1.30], "paint", red);
    box(add, detailed, [side * .59, H / 2, .725], [.08, H, .08], "paint", red);
    for (const y of [1.22, 2.26]) {
      box(add, detailed, [side * .59, y, .74], [.20, .07, .10], "paint", red);
      box(add, detailed, [side * .59, y + .06, .74], [.29, .05, .10], "paint", red);
    }
  }
  for (const y of [1.33, 2.34]) box(add, detailed, [0, y, .725], [1.26, .085, .08], "paint", red);
};

const persianFacade = (add: Add, detailed: boolean) => {
  for (const side of [-1, 1]) {
    box(add, detailed, [side * .605, 1.22, .725], [.17, H - .035, .12], "plaster", [.94, .85, .69]);
    box(add, detailed, [side * .605, 1.23, .79], [.035, 2.30, .012], "paint", [.025, .075, .30]);
    add({ position: [side * .43, 1.72, .72], shape: "persian-palmette-panel", size: [.22, .48, .05],
      surface: "plaster", tint: [1.02, .94, .78] });
    for (const y of [.16, 2.36]) box(add, detailed, [side * .605, y, .73], [.25, .10, .13], "plaster");
  }
  for (let index = 0; index < 9; index++) {
    const angle = (index + .5) / 9 * Math.PI;
    box(add, detailed, [Math.cos(angle) * .36, .95 + Math.sin(angle) * .33, .735],
      [.13, .065, .10], "plaster", [.91, .80, .60], [0, 0, angle - Math.PI / 2]);
  }
};

const mayaFacade = (add: Add, detailed: boolean) => {
  for (const side of [-1, 1]) {
    for (const y of [.17, .55, .93, 1.31, 1.69, 2.07])
      box(add, detailed, [side * .60, y, .72], [.19, .32, .13], "cut-stone", [.97, .93, .82]);
    for (const y of [1.07, 1.17, 1.27]) {
      const inward = (y - 1.07) * 1.4;
      box(add, detailed, [side * (.30 - inward), y, .735], [.15, .09, .11], "cut-stone");
    }
    box(add, detailed, [side * .725, 2.32, 0], [.10, .10, 1.44], "cut-stone");
  }
  for (const y of [2.24, 2.36]) box(add, detailed, [0, y, .73], [1.42, .075, .10], "cut-stone");
  add({ position: [0, 1.73, .725], shape: "maya-civic-mask", compactGeometry:true, size: [.36, .44, .055],
    surface: "gold", tint: [.88, .78, .55] });
};

const nubianFacade = (add: Add, detailed: boolean) => {
  for (const side of [-1, 1]) {
    add({ position: [side * .59, H / 2, .72], shape: detailed ? "bevel-box" : "box",
      size: [.20, H, .15], surface: "plaster", topScale: [.70, 1, .85], tint: [.88, .73, .49] });
    for (const y of [.20, 1.35, 2.33]) box(add, detailed, [side * .59, y, .795],
      [.17, .05, .012], "paint", [.49, .22, .13]);
    box(add, detailed, [side * .723, .19, 0], [.12, .18, 1.44], "stone");
  }
  for (let index = 0; index < 3; index++) {
    const x = (index - 1) * .23;
    for (const side of [-1, 1]) box(add, detailed, [x + side * .045, 1.70, .73], [.12, .045, .065],
      "plaster", [.98, .86, .64], [0, 0, side * .70]);
  }
  box(add, detailed, [0, 2.33, .73], [1.38, .12, .10], "plaster");
};

const timberFacade = (add: Add, detailed: boolean, indigenous: boolean) => {
  const surface: BuildingPart["surface"] = indigenous ? "palm-trunk" : "wood";
  for (const side of [-1, 1]) {
    for (const z of [-.62, .62]) {
      add({ position: [side * .69, H / 2, z], radialSegments: detailed ? 10 : 5,
        shape: "cylinder", size: [.095, H, .095], surface });
      for (const y of indigenous ? [.28, 1.31, 2.28] : [.28, 2.28]) add({
        position: [side * .69, y, z], radialSegments: detailed ? 10 : 5, shape: "cylinder",
        size: [.115, indigenous ? .075 : .045, .115], surface: indigenous ? "rope" : "iron" });
    }
    for (const y of [.20, 1.35, 2.32]) box(add, detailed, [side * .725, y, 0], [.07, .085, 1.34], surface);
    box(add, detailed, [side * .725, .87, 0], [.06, 1.15, .065], surface, undefined, [side * .70, 0, 0]);
    box(add, detailed, [side * .56, .21, .73], [.20, .28, .12], "stone");
  }
  box(add, detailed, [0, 1.20, .74], [1.31, .14, .10], surface);
  if (!indigenous) for (const x of [-.58, .58]) add({ position: [x, 1.20, .799],
    rotation: [Math.PI / 2, 0, 0], radialSegments: detailed ? 8 : 4,
    shape: "cylinder", size: [.045, .022, .045], surface: "iron" });
};

/** Add only bonded shaft dressing; every part stays below the shared engine/deck and clear of the door. */
export const addAdditionalCatapultFacade = (parts: BuildingPart[], nation: WorkerNation, detailed: boolean) => {
  const add: Add = part => parts.push({ architecture: true, stage: 2, worldUv: 1.8, ...part });
  if (nation === "chinese") return chineseFacade(add, detailed);
  if (nation === "persian") return persianFacade(add, detailed);
  if (nation === "maya") {
    mayaFacade(add, detailed); addMayaCatapultEntryHood(parts, detailed); return;
  }
  if (nation === "nubian") return nubianFacade(add, detailed);
  if (nation === "indigenous") return timberFacade(add, detailed, true);
  if (nation === "viking") return timberFacade(add, detailed, false);
};

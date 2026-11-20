import type { SettlerNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { createOpeningShadowDisk } from "./building-window-shadows";
import { addChineseBracket, addChineseRoof, CHINESE_TIMBER } from "./chinese-building-roofs";
import { type Add, runBetween } from "./nation-kit-parts";

type WellNation = Exclude<SettlerNation, "roman"> | "chinese";

/** Open curbs leave the existing draw bucket, water surface and windlass unobstructed. */
const squareCurb = (add: Add, surface: BuildingPart["surface"], timber: boolean) => {
  const courses = timber ? 4 : 3, rise = .42 / courses;
  for (let row = 0; row < courses; row++) for (const side of [-1, 1]) {
    const y = (row + .5) * rise - .003;
    add({ position: [side * .31, y, -.15], shape: timber ? "bevel-box" : "stone-block",
      size: [.105, rise - .006, .71], stage: 1, surface });
    add({ position: [0, y, -.15 + side * .305], shape: timber ? "bevel-box" : "stone-block",
      size: [.52, rise - .006, .105], stage: 1, surface });
  }
};

const posts = (add: Add, height: number, surface: BuildingPart["surface"], tint?: Point3) => {
  for (const z of [-.60, .30]) {
    add({ position: [0, .055, z], shape: "stone-block", size: [.22, .11, .22], stage: 1, surface: "stone" });
    add({ position: [0, height / 2, z], shape: "bevel-box", size: [.11, height, .11],
      stage: 2, surface, tint });
  }
};

const chineseWell = (add: Add, detailed: boolean) => {
  squareCurb(add, "cut-stone", false);
  posts(add, 1.38, "paint", CHINESE_TIMBER);
  for (const z of [-.60, .30]) {
    addChineseBracket(add, [0, 1.21, z], 0, detailed, .8);
    add({ position: [0, 1.38, z], shape: "bevel-box", size: [.88, .065, .09],
      stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  }
  addChineseRoof(add, { min: [-.50, 1.39, -.73], max: [.50, 1.76, .43] }, 35, detailed, true);
};

const japaneseWell = (add: Add, detailed: boolean) => {
  squareCurb(add, "wood", true);
  posts(add, 1.12, "wood");
  // An exposed forked frame and tied crossbeam, without another generic pitched canopy.
  add({ position: [0, 1.08, -.15], shape: "bevel-box", size: [.09, .10, 1.12], stage: 2, surface: "wood" });
  for (const z of [-.60, .30]) for (const side of [-1, 1])
    runBetween(add, [0, .83, z], [side * .15, 1.17, z], [.045, .045], { stage: 2, surface: "wood" });
  if (!detailed) return;
  for (const z of [-.61, .29]) for (let row = 0; row < 3; row++)
    add({ position: [0, .92 + row * .035, z], shape: "box", size: [.13, .022, .14],
      stage: 3, surface: "rope" });
};

const vikingWell = (add: Add) => {
  squareCurb(add, "bark", true);
  for (const z of [-.60, .30]) for (const side of [-1, 1])
    runBetween(add, [side * .35, .02, z], [0, 1.70, z], [.10, .11],
      { shape: "bevel-box", stage: 2, surface: "wood" });
  add({ position: [0, 1.70, -.15], shape: "box", size: [.10, .10, 1.12], stage: 2, surface: "wood" });
  add({ occupationRoof: "gable", position: [0, 1.40, -.15], shape: "occupation-roof",
    size: [.94, .65, 1.14], stage: 3, surface: "roof-shingles" });
};

const nubianWell = (add: Add, detailed: boolean) => {
  // A battered octagonal adobe curb, with short masonry cheeks supporting the exposed axle.
  const sides = 8;
  for (let row = 0; row < 3; row++) for (let side = 0; side < sides; side++) {
    const angle = side * Math.PI * 2 / sides, radius = .34 - row * .018;
    add({ position: [Math.cos(angle) * radius, .075 + row * .13, -.15 + Math.sin(angle) * radius],
      rotation: [0, Math.PI / 2 - angle, 0], shape: "bevel-box", size: [.29, .13, .095],
      stage: 1, surface: "plaster" });
  }
  for (const z of [-.60, .30]) {
    add({ position: [0, .43, z], shape: "box", size: [.23, .86, .16],
      topScale: [.7, 1, .8], stage: 2, surface: "plaster" });
    add({ position: [0, .89, z], shape: "stone-block", size: [.25, .08, .18], stage: 2, surface: "stone" });
  }
  if (detailed) add({ position: [-.39, .19, .64], shape: "clay-jar", size: [.22, .38, .22],
    radialSegments: 12, stage: 3, surface: "paint", tint: [.52, .29, .13] });
};

const nationalBasin = (add: Add, nation: WellNation, detailed: boolean) => {
  if (nation === "chinese") {
    add({ position: [-.03, .13, -.75], shape: "bowl", size: [.58, .26, .46], surface: "paint",
      tint: [.26, .43, .33] });
    for (let petal = 0; petal < 8; petal++) {
      const angle = petal * Math.PI / 4;
      add({ position: [-.03 + Math.cos(angle) * .255, .235, -.75 + Math.sin(angle) * .20],
        rotation: [0, -angle, 0], shape: "bevel-box", size: [.06, .06, .12],
        surface: "cut-stone" });
    }
    return;
  }
  if (nation === "nubian") {
    add({ position: [-.03, .13, -.75], shape: "bowl", size: [.61, .26, .47],
      surface: "paint", tint: [.57, .28, .12] });
    add({ position: [-.03, .245, -.75], shape: "ring", size: [.61, .035, .47],
      surface: "paint", tint: [.68, .39, .19] });
    for (const side of [-1, 1]) add({ position: [-.03 + side * .31, .18, -.75], shape: "ring",
      rotation: [0, 0, Math.PI / 2], size: [.10, .035, .10], surface: "paint", tint: [.57, .28, .12] });
    return;
  }
  if (nation === "japanese") {
    add({ position: [-.03, .13, -.75], shape: "bowl", size: [.57, .26, .44], surface: "wood" });
    for (const x of [-.27, .21]) add({ position: [x, .16, -.75], shape: "ring",
      rotation: [0, 0, Math.PI / 2], size: [.32, .028, .46], surface: "rope" });
    // A split-bamboo spout feeds the collecting bowl; its trestle stands independently of the shaft.
    add({ position: [-.39, .155, -.80], shape: "cylinder", size: [.045, .31, .045], surface: "wood" });
    add({ position: [-.29, .31, -.80], shape: "ring", rotation: [0, 0, Math.PI / 2],
      size: [.075, .29, .075], surface: "paint", tint: [.46, .49, .23], radialSegments: detailed ? 12 : 6 });
    return;
  }
  // A long hollow log with bound ends, rather than the Roman board-sided collecting box.
  add({ position: [-.03, .13, -.75], shape: "bowl", size: [.64, .26, .46], surface: "wood" });
  for (const side of [-1, 1]) {
    add({ position: [-.03 + side * .275, .13, -.75], rotation: [0, 0, Math.PI / 2],
      shape: "ring", size: [.28, .04, .46], surface: "bark" });
    add({ position: [-.03 + side * .21, .04, -.75], shape: "bevel-box",
      size: [.11, .08, .43], surface: "wood" });
  }
};

/** Nation-authored wells retain all inventory and the shared animated water-drawing contacts. */
export const createNationWellRecipe = (original: BuildingRecipe, nation: WellNation,
  detailed: boolean): BuildingRecipe => {
  const parts = original.parts.filter(part => part.stock);
  const add: Add = part => parts.push({ compactGeometry: true, stage: 1, ...part });
  add(createOpeningShadowDisk({ position: [0, .0125, -.15], shape: "cylinder",
    size: [.52, .025, .52], stage: 1, surface: "dark" }, detailed));
  nationalBasin(add, nation, detailed);
  ({ chinese: chineseWell, japanese: japaneseWell, nubian: nubianWell, viking: vikingWell })[nation](add, detailed);
  return { ...original, parts };
};

import { srgbToLinear } from "../color";
import type { BuildingFirstNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { withChineseTeaInputBays } from "./chinese-tea-input-bays";
import { expansionDrinkWorkstation } from "./expansion-drink-maker-layout";
import { isPressVatPart } from "./nation-drink-makers";

const CLAY = srgbToLinear(.64, .34, .2);
const JUICE = srgbToLinear(.55, .08, .13);
const CACAO = srgbToLinear(.24, .12, .065);
const TEA = srgbToLinear(.31, .39, .12);
const BERRY = srgbToLinear(.30, .08, .18);
type Add = (surface: BuildingPart["surface"], position: Point3, size: Point3,
  shape?: BuildingPart["shape"], rotation?: Point3, tint?: Point3) => void;

const jar = (add: Add, x: number, z: number, scale = 1, y = 0) => {
  add("paint", [x, y + .11 * scale, z], [.15 * scale, .22 * scale, .15 * scale], "clay-jar", undefined, CLAY);
};

const table = (add: Add, detailed: boolean) => {
  add("wood", [.87, .34, .24], [.46, .045, .21], "bevel-box");
  for (const x of [.68, 1.06]) for (const z of [.18, .30])
    add("wood", [x, .16, z], [.035, .32, .035], "box");
  if (detailed) for (const z of [.18, .30]) add("wood", [.87, .11, z], [.42, .035, .035]);
};

const tea = (add: Add, detailed: boolean) => {
  table(add, detailed);
  // A shallow rolling tray is exactly under the two animation hand contacts.
  add("wood", [.87, .378, .235], [.36, .03, .16], "bevel-box");
  add("paint", [.87, .418, .235], [.30, .06, .105], "box", undefined, TEA);
  add("wood", [.87, .46, .23], [.30, .045, .045], "cylinder", [0, 0, Math.PI / 2]);
  for (const x of [.69, 1.05]) add("wood", [x, .397, .235], [.018, .05, .17]);
  add("iron", [.87, .13, -.98], [.30, .26, .30], "cylinder");
  add("dark", [.87, .269, -.98], [.22, .018, .22], "cylinder");
  add("iron", [.87, .35, -.98], [.25, .18, .25], "bowl");
  add("iron", [.87, .452, -.98], [.19, .025, .19], "cylinder");
  add("wood", [.87, .48, -.98], [.045, .04, .045], "sphere");
  add("iron", [1.005, .39, -.98], [.045, .14, .045], "cylinder", [0, 0, -.8]);
  add("iron", [.74, .42, -.98], [.035, .15, .14], "ring", [0, 0, Math.PI / 2]);
  for (const z of detailed ? [-.90, -1.12] : [-1.05]) {
    add("wood", [.44, .37, z], [.24, .025, .16]);
    add("paint", [.44, .39, z], [.20, .014, .12], "box", undefined, TEA);
  }
  jar(add, 1.19, -.98);
};

const pomegranate = (add: Add, detailed: boolean) => {
  table(add, detailed);
  add("paint", [.87, .39, .23], [.31, .07, .17], "bowl", undefined, CLAY);
  add("paint", [.87, .414, .23], [.23, .012, .12], "cylinder", undefined, JUICE);
  for (const x of [.66, 1.08]) add("wood", [x, .43, .20], [.055, .86, .06], "bevel-box");
  add("wood", [.87, .83, .20], [.49, .065, .075], "bevel-box");
  add("wood", [.87, .60, .23], [.055, .40, .055], "cylinder");
  add("wood", [.87, .45, .23], [.21, .055, .12], "cylinder");
  // The horizontal press handle intersects the two shared hand targets.
  add("wood", [.87, .54, .23], [.37, .035, .035], "cylinder", [0, 0, Math.PI / 2]);
  add("paint", [1.035, .385, .23], [.12, .025, .04], "box", undefined, CLAY);
  jar(add, 1.15, .23, .7);
  add("wood", [.87, .14, -.98], [.56, .28, .3], "bevel-box");
  jar(add, .72, -.98, 1, .28); jar(add, .99, -.98, 1.2, .28);
  if (detailed) for (const dx of [-.11, .04, .15])
    add("paint", [.87 + dx, .31, -.82], [.065, .065, .065], "sphere", undefined, JUICE);
};

const cacao = (add: Add, detailed: boolean) => {
  // Four legs support the sloping stone metate, with a broad mano under both hands.
  for (const x of [.71, 1.03]) for (const z of [.18, .29])
    add("stone", [x, .14, z], [.065, .28, .065], "bevel-box");
  add("stone", [.87, .32, .24], [.43, .10, .21], "bevel-box", [.12, 0, 0]);
  add("paint", [.87, .397, .24], [.25, .025, .12], "box", [.12, 0, 0], CACAO);
  add("stone", [.87, .44, .25], [.31, .05, .05], "cylinder", [0, 0, Math.PI / 2]);
  add("wood", [.87, .13, -.98], [.62, .26, .30], "bevel-box");
  for (const x of detailed ? [.65, .87, 1.09] : [.72, 1.01]) jar(add, x, -.98, 1.1, .26);
  if (detailed) {
    jar(add, 1.17, .24, .65);
    add("wood", [1.17, .30, .24], [.018, .26, .018], "cylinder", [.15, 0, .25]);
    add("wood", [.59, .32, -.84], [.025, .36, .025], "cylinder", [.2, 0, -.3]);
  }
};

const berries = (add: Add, detailed: boolean) => {
  table(add, detailed);
  add("paint", [.87, .40, .24], [.32, .12, .18], "bowl", undefined, CLAY);
  add("paint", [.87, .444, .24], [.23, .015, .12], "cylinder", undefined, BERRY);
  add("wood", [.79, .49, .24], [.038, .19, .038], "cylinder", [0, 0, -.18]);
  add("wood", [.97, .462, .24], [.09, .018, .13], "ring");
  add("wood", [.87, .12, -.98], [.61, .24, .30], "bevel-box");
  for (const x of detailed ? [.65, .86, 1.08] : [.72, 1.02]) jar(add, x, -.98, 1, .24);
  if (detailed) {
    add("straw", [1.17, .045, .20], [.18, .09, .18], "bowl");
    jar(add, .53, -.83, .65);
  }
};

/** Own national drink tools; raw/output inventories and every gameplay anchor remain untouched. */
export const decorateExpansionDrinkMaker = (recipe: BuildingRecipe, id: number,
  nation: BuildingFirstNation, detailed: boolean): BuildingRecipe => {
  if (id !== 6) return recipe;
  const parts = recipe.parts.filter(part => !isPressVatPart(part));
  const add: Add = (surface, position, size, shape = "box", rotation, tint) =>
    parts.push({ surface, position, size, shape, rotation, tint, stage: 3 });
  const raw = expansionDrinkWorkstation(nation).rawInput;
  // Low ceramic receiving vessel surrounds the unchanged raw stock contact.
  if(nation!=="chinese")add("paint", [raw[0], .10, raw[2]], [.62, .20, .62], "bowl", undefined, CLAY);
  ({ chinese: tea, persian: pomegranate, maya: cacao, indigenous: berries })[nation](add, detailed);
  const toolHeight = { chinese: .46, indigenous: .49, maya: .44, persian: .54 }[nation];
  const toolX = nation === "indigenous" ? .79 : .87;
  const toolSurface = nation === "maya" ? "stone" : "wood";
  const moving = parts.find(part => part.shape === "cylinder" && part.surface === toolSurface &&
    Math.abs(part.position[0] - toolX) < .001 && Math.abs(part.position[1] - toolHeight) < .001);
  if (moving) moving.drinkTool = nation;
  const built={ ...recipe, drinkNation: nation, parts };
  return nation==="chinese"?withChineseTeaInputBays(built):built;
};

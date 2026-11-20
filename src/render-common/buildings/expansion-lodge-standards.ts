import type { BuildingFirstNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, BuildingSurface, Point3 } from "./building-recipe";
import { COMMANDER_LODGE_CUES } from "./nation-commander-lodge-designs";

/** Nations whose Commander's Lodge is built from their own recipe, not the national lodge design. */
type ExpansionLodgeNation = BuildingFirstNation;

type Add = (surface: BuildingSurface, position: Point3, size: Point3, shape?: BuildingPart["shape"],
  rotation?: Point3, tint?: Point3) => void;

/** The cloth hangs from the crossbar on the camera side of the pole, as on the national lodges. */
const CLOTH = { height: .48, offset: .2, width: .4 } as const;

interface StandardStyle { banner: Point3; foot: BuildingSurface; pole: BuildingSurface; trim: Point3 }

const STYLES: Readonly<Record<ExpansionLodgeNation, StandardStyle>> = {
  chinese: { banner: [.62, .07, .05], foot: "stone", pole: "wood", trim: [.92, .72, .2] },
  indigenous: { banner: [.74, .56, .34], foot: "stone", pole: "wood", trim: [.56, .12, .08] },
  maya: { banner: [.2, .7, .56], foot: "stone", pole: "wood", trim: [.7, .22, .1] },
  persian: { banner: [.2, .34, .74], foot: "stone", pole: "wood", trim: [.9, .74, .3] }
};

/** Stone foot, pole, crossbar, cloth and its hem: grounded at the lodge's standard cue. */
const addMount = (add: Add, style: StandardStyle) => {
  const { height, x, z } = COMMANDER_LODGE_CUES.standard, clothX = x + CLOTH.offset;
  add(style.foot, [x, .05, z], [.24, .1, .24], "bevel-box");
  add(style.pole, [x, height / 2, z], [.07, height, .07], "cylinder");
  add("wood", [clothX, height - .03, z], [CLOTH.width + .02, .05, .05], "bevel-box");
  add("cloth", [clothX, height - .29, z + .012], [CLOTH.width, CLOTH.height, .02], "box", undefined, style.banner);
  add("cloth", [clothX, height - .53, z + .012], [CLOTH.width, .04, .022], "box", undefined, style.trim);
};

/** Chinese war banner: a red field with a gilded disc and a flame-tongue edge on the fly side. */
const chineseEmblem = (add: Add, centre: Point3, detailed: boolean) => {
  const [x, y, z] = centre, gold: Point3 = [.92, .72, .2];
  add("gold", [x, y, z], [.2, .2, .012], "ring");
  add("paint", [x, y, z + .004], [.1, .1, .01], "sphere", undefined, gold);
  if (!detailed) return;
  for (let step = 0; step < 5; step++)
    add("paint", [x + CLOTH.width / 2 + .03, y + .2 - step * .1, z - .012], [.06, .08, .001], "paint-triangle",
      [0, 0, -Math.PI / 2], [.08, .06, .05]);
};

/** Persian standard: a blue field with a gilded sun disc and its rays, and two hanging tassels. */
const persianEmblem = (add: Add, centre: Point3, detailed: boolean) => {
  const [x, y, z] = centre;
  add("gold", [x, y, z], [.12, .12, .014], "sphere");
  const rays = detailed ? 8 : 4;
  for (let index = 0; index < rays; index++) {
    const angle = index * Math.PI * 2 / rays;
    add("gold", [x + Math.cos(angle) * .1, y + Math.sin(angle) * .1, z], [.07, .02, .012], "box", [0, 0, angle]);
  }
  if (!detailed) return;
  for (const side of [-1, 1])
    add("gold", [x + side * .16, y - .28, z - .01], [.025, .09, .025], "cylinder");
};

/** Maya standard: a jade field with a stepped fret and a crest of plumes on the pole head. */
const mayaEmblem = (add: Add, centre: Point3, detailed: boolean) => {
  const [x, y, z] = centre, ochre: Point3 = [.86, .62, .22];
  add("paint", [x, y - .06, z], [.22, .06, .012], "box", undefined, ochre);
  add("paint", [x, y + .02, z], [.14, .06, .012], "box", undefined, ochre);
  add("paint", [x, y + .1, z], [.06, .06, .012], "box", undefined, ochre);
  const { height, x: poleX, z: poleZ } = COMMANDER_LODGE_CUES.standard;
  const plumes = detailed ? [-.5, 0, .5] : [0];
  for (const tilt of plumes)
    add("paint", [poleX + Math.sin(tilt) * .08, height + .1, poleZ], [.06, .22, .03], "sphere",
      [0, 0, -tilt], [.1, .5, .3]);
};

/** Indigenous standard: a hide banner with a painted zigzag and two feathers hung from the bar. */
const indigenousEmblem = (add: Add, centre: Point3, detailed: boolean) => {
  const [x, y, z] = centre, red: Point3 = [.56, .12, .08];
  const teeth = detailed ? 4 : 2;
  for (let index = 0; index < teeth; index++)
    add("paint", [x - .12 + index * .24 / Math.max(1, teeth - 1), y, z], [.07, .1, .001], "paint-triangle",
      undefined, red);
  if (!detailed) return;
  const { height } = COMMANDER_LODGE_CUES.standard;
  for (const side of [-1, 1]) {
    add("rope", [x + side * .17, height - .1, z], [.01, .1, .01], "cylinder");
    add("paint", [x + side * .17, height - .24, z], [.035, .18, .01], "box", undefined, [.94, .92, .86]);
    add("paint", [x + side * .17, height - .32, z + .001], [.036, .04, .01], "box", undefined, [.08, .07, .07]);
  }
};

const EMBLEMS: Readonly<Record<ExpansionLodgeNation, (add: Add, centre: Point3, detailed: boolean) => void>> = {
  chinese: chineseEmblem, indigenous: indigenousEmblem, maya: mayaEmblem, persian: persianEmblem
};

/** Finial on the pole head: a gilded spear point, except the Maya plume crest (its emblem). */
const addFinial = (add: Add, nation: ExpansionLodgeNation) => {
  if (nation === "maya") return;
  const { height, x, z } = COMMANDER_LODGE_CUES.standard;
  add("gold", [x, height + .01, z], [.08, .06, .08], "sphere");
  add("gold", [x, height + .1, z], [.05, .14, .05], "cone");
};

/**
 * The Commander's Lodge is military (owner 2026-11-09): the expansion nations' lodges get an
 * original national commander's standard at the same grounded cue as the national lodge design,
 * on the open ground beside the hall, clear of its walls, roof, door lane and yard.
 */
export const withExpansionLodgeStandard = (
  recipe: BuildingRecipe, nation: ExpansionLodgeNation, detailed: boolean
): BuildingRecipe => {
  const parts = [...recipe.parts];
  const add: Add = (surface, position, size, shape = "box", rotation, tint) => {
    parts.push({ compactGeometry: true, position, rotation, shape, size, stage: 3, surface, tint });
  };
  const style = STYLES[nation], { height, x, z } = COMMANDER_LODGE_CUES.standard;
  addMount(add, style);
  addFinial(add, nation);
  EMBLEMS[nation](add, [x + CLOTH.offset, height - .3, z + .026], detailed);
  return { ...recipe, parts };
};

import type { Point3 } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";
import { srgbToLinear } from "../color";

const RED = srgbToLinear(.67, .085, .08);
const CREAM = srgbToLinear(.87, .76, .56);
const BROWN = srgbToLinear(.31, .14, .06), CERAMIC = srgbToLinear(.67, .37, .2);

/** A basket is part of the goods themselves, with a woven wall and rolled rim. */
const basket = (part: AddPart, detailed: boolean, height = .16) => {
  part("straw", [0, -.15 + height / 2, 0], [.3, height, .25], 3, "bowl", undefined, [.9, .74, .46]);
  part("rope", [0, -.15 + height * .87, 0], [.29, .018, .24], 3, "ring");
  if (!detailed) return;
  for (const y of [-.105, -.07]) part("rope", [0, y, 0], [.28, .009, .23], 3, "ring");
};

const teaLeaves = (part: AddPart, detailed: boolean) => {
  basket(part, detailed);
  const count = detailed ? 14 : 6;
  for (let index = 0; index < count; index++) {
    const angle = index * 2.39996, radius = .025 + (index % 3) * .035;
    part("paint", [Math.cos(angle) * radius, -.025 + (index % 3) * .008, Math.sin(angle) * radius * .7],
      [.09, .018, .031], 3, "harvested-tea-leaf", [.1, angle, (index % 2 ? 1 : -1) * .22]);
  }
};

const pomegranate = (part: AddPart, _detailed: boolean) => {
  for (const side of [-1, 1]) {
    const x = side * .075, y = side < 0 ? -.045 : -.055, z = side * .025;
    const size = side < 0 ? .21 : .19;
    part("paint", [x, y, z], [size, size, size], 3, "pomegranate-whole-fruit");
  }
};

const cacaoBeans = (part: AddPart, detailed: boolean) => {
  basket(part, detailed);
  for (let bean = 0; bean < (detailed ? 14 : 6); bean++) {
    const angle = bean * 2.39996, radius = .025 + bean % 3 * .033;
    part("paint", [Math.cos(angle) * radius, -.02 + bean % 3 * .009, Math.sin(angle) * radius * .7],
      [.058, .025, .033], 3, "sphere", [0, angle, .1], BROWN);
    if (detailed) part("paint", [Math.cos(angle) * radius, -.005 + bean % 3 * .009,
      Math.sin(angle) * radius * .7], [.035, .003, .003], 3, "box", [0, angle, .1],
      srgbToLinear(.16, .065, .02));
  }
};

const berries = (part: AddPart, detailed: boolean) => {
  basket(part, detailed);
  for (let berry = 0; berry < (detailed ? 20 : 8); berry++) {
    const angle = berry * 2.39996, radius = .018 + berry % 4 * .023;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius * .8, y = -.015 + berry % 3 * .012;
    part("paint", [x, y, z], [.043, .043, .043], 3, "harvested-drink-berry");
  }
};

const cup = (part: AddPart, position: Point3, tint: Point3, liquid: Point3, scale = 1) => {
  part("paint", position, [.13 * scale, .09 * scale, .13 * scale], 3, "bowl", undefined, tint);
  part("paint", [position[0], position[1] + .035 * scale, position[2]],
    [.105 * scale, .006 * scale, .105 * scale], 3, "cylinder", undefined, liquid);
};

const tea = (part: AddPart, detailed: boolean) => {
  const glaze = srgbToLinear(.38, .5, .47), liquid = srgbToLinear(.43, .3, .085);
  part("paint", [-.035, -.005, 0], [.22, .29, .2], 3, "clay-jar", undefined, glaze);
  part("paint", [-.035, .145, 0], [.085, .018, .085], 3, "cylinder", undefined, glaze);
  part("wood", [-.035, .164, 0], [.025, .025, .025], 3, "sphere");
  part("paint", [.085, .035, 0], [.045, .14, .045], 3, "cone", [0, 0, -.8], glaze);
  part("paint", [-.16, .035, 0], [.12, .025, .12], 3, "ring", [Math.PI / 2, 0, 0], glaze);
  cup(part, [.15, -.105, .075], CREAM, liquid, .85);
  if (detailed)
    part("paint", [-.035, -.065, 0], [.217, .009, .197], 3, "ring", undefined, CREAM);
};

const pomegranateJuice = (part: AddPart, detailed: boolean) => {
  part("paint", [-.025, -.005, 0], [.23, .29, .2], 3, "clay-jar", undefined, CERAMIC);
  part("cloth", [-.025, .146, 0], [.09, .028, .09], 3, "cylinder", undefined, CREAM);
  part("rope", [-.025, .135, 0], [.09, .012, .09], 3, "ring");
  cup(part, [.155, -.105, .06], CREAM, RED, .9);
  if (detailed) for (const y of [-.075, -.03])
    part("paint", [-.025, y, 0], [.232, .012, .202], 3, "ring", undefined, srgbToLinear(.49, .18, .08));
};

const cacaoDrink = (part: AddPart, detailed: boolean) => {
  part("paint", [0, 0, 0], [.23, .3, .23], 3, "straight-cup", undefined, CREAM);
  part("paint", [0, .143, 0], [.195, .012, .195], 3, "cylinder", undefined, BROWN);
  for (const y of [-.12, -.08, .11])
    part("paint", [0, y, 0], [.237, .012, .237], 3, "ring", undefined, CERAMIC);
  if (!detailed) return;
  for (let bubble = 0; bubble < 8; bubble++) {
    const angle = bubble * 2.39996;
    part("paint", [Math.cos(angle) * .058, .151, Math.sin(angle) * .058], [.022, .009, .022], 3,
      "sphere", undefined, srgbToLinear(.62, .43, .25));
  }
};

const berryDrink = (part: AddPart, detailed: boolean) => {
  part("bark", [-.025, -.015, 0], [.21, .27, .2], 3, "gourd", undefined, [.92, .73, .46]);
  part("wood", [-.025, .133, 0], [.04, .055, .04], 3, "cylinder");
  part("rope", [-.025, .08, 0], [.11, .018, .11], 3, "ring");
  cup(part, [.14, -.105, .075], CERAMIC, srgbToLinear(.31, .035, .085), .9);
  if (detailed) part("rope", [-.025, -.025, 0], [.212, .012, .202], 3, "ring");
};

const RECIPES: Readonly<Record<string, (part: AddPart, detailed: boolean) => void>> = {
  berries, berryDrink, cacaoBeans, cacaoDrink, pomegranate, pomegranateJuice, tea, teaLeaves
};

export const addNationalDrinkWare = (part: AddPart, id: string, detailed: boolean) => {
  const build = RECIPES[id];
  if (!build) return false;
  build(part, detailed);
  return true;
};

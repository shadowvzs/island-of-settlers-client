import type { BuildingFirstNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { addMayaCarvedMotif } from "./maya-carved-motifs";
import type { Add } from "./nation-kit-parts";

/** Replace only the inherited occupation tablet with the nation's own crop and drink pictograms. */
export const decorateExpansionDrinkSign = (recipe: BuildingRecipe, id: number,
  nation: BuildingFirstNation, detailed: boolean): BuildingRecipe => {
  if (id !== 5 && id !== 6) return recipe;
  const sign = recipe.parts.filter(part => part.occupationSign && !part.stock);
  if (!sign.length) return recipe;
  const backing = sign.find(part => part.size[0] >= .28 && part.size[1] >= .15) ?? sign[0]!;
  const centre: Point3 = [...backing.position];
  const parts = recipe.parts.filter(part => !part.occupationSign || part.stock);
  const add: Add = part => parts.push({ ...part, stage: part.stage ?? 3, occupationSign: true });
  add({ ...backing, shape: "box", size: [.31, .18, .045], surface: "plaster", tint: [.88, .82, .67] });
  const color: Point3 = { chinese: [.1, .3, .08], persian: [.66, .045, .04],
    maya: [.45, .2, .06], indigenous: [.2, .06, .35] }[nation] as Point3;
  const face = centre[2] + .025;
  const symbol = (shape: BuildingPart["shape"], dx: number, dy: number, w: number, h: number,
    tint: Point3 = color, angle = 0) => add({ position: [centre[0] + dx, centre[1] + dy, face],
    shape, size: [w, h, .008], surface: "paint", tint, rotation: [0, 0, angle], stage: 3 });
  // Makers carry a cup beside their crop; growers use the full tablet for the crop itself.
  const cropX = id === 6 ? -.055 : 0;
  if (nation === "maya") addMayaCarvedMotif(add, "cacao", [centre[0] + cropX, centre[1], face],
    id === 6 ? .12 : .22, .125, .018, 0, detailed);
  else if (nation === "chinese") {
    symbol("box", cropX, -.012, .008, .115, [.26, .18, .05], -.12);
    for (const side of [-1, 1]) symbol("paint-ellipse", cropX + side * .032, .012,
      .078, .032, color, side * .65);
    if (detailed) symbol("paint-ellipse", cropX, .048, .04, .018, [.28, .48, .1], .9);
  } else if (nation === "persian") {
    symbol("paint-ellipse", cropX, -.004, .105, .115);
    for (const side of [-1, 0, 1]) symbol("paint-triangle", cropX + side * .017, .058, .018, .028);
    if (detailed) symbol("paint-ellipse", cropX - .02, .015, .018, .04, [.88, .22, .09]);
  } else {
    const positions = [[-.032, .025], [.025, .035], [0, -.015], [-.044, -.025], [.04, -.027]];
    for (const [dx, dy] of positions) symbol("paint-ellipse", cropX + dx!, dy!, .039, .039);
    symbol("box", cropX, .061, .008, .03, [.15, .31, .07]);
  }
  if (id === 6) {
    symbol("paint-triangle", .075, -.008, .095, .09, [.49, .27, .13], Math.PI);
    symbol("box", .075, .034, .09, .014, color);
    symbol("box", .075, -.053, .055, .012, [.49, .27, .13]);
  }
  return { ...recipe, parts };
};

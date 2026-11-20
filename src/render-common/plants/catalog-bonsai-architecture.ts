import type { Point3 } from "../buildings/building-recipe";
import type { CatalogBonsaiSpecies } from "./catalog-bonsai-graph";

type Pad = readonly [number, number, number, number];
const PINE: readonly Pad[] = [
  [-.18, .17, .035, .14], [.16, .23, -.025, .15], [-.09, .28, -.13, .13],
  [.17, .33, .105, .12], [-.15, .36, .035, .135], [.025, .43, .015, .14]
];
const JUNIPER: readonly Pad[] = [
  [-.19, .12, .025, .11], [.19, .19, -.02, .12], [-.13, .24, -.105, .12],
  [.14, .31, .10, .115], [-.17, .35, .025, .12], [.06, .40, -.05, .12], [-.06, .46, .015, .11]
];
const AZALEA: readonly Pad[] = [
  [-.17, .20, .03, .135], [.17, .22, -.02, .13], [-.05, .26, -.13, .13],
  [.035, .28, .13, .13], [-.14, .33, -.035, .125], [.14, .34, .035, .125], [0, .40, 0, .14]
];
const ELM: readonly Pad[] = [
  [-.18, .20, .02, .13], [.18, .25, -.035, .13], [-.105, .31, -.135, .12],
  [.09, .34, .13, .12], [-.15, .41, .025, .13], [.13, .43, -.045, .12], [-.015, .51, 0, .13]
];

/** Botanical architecture, rather than a common tree with different leaf materials. */
export const catalogBonsaiArchitecture = (species: CatalogBonsaiSpecies, variant: number, base: number) => {
  let trunk: Point3[], pads: readonly Pad[], thickness = .055;
  if (species === "bonsai-pine") {
    trunk = [[-.025, 0, .01], [.045, .075, .02], [-.035, .16, -.01],
      [.045, .24, .015], [.015, .33, -.01], [.035, .41, 0]];
    pads = PINE; thickness = .066;
  } else if (species === "bonsai-juniper") {
    trunk = [[.025, 0, .01], [-.035, .085, .03], [.055, .16, -.02],
      [-.075, .24, -.015], [-.025, .33, .02], [-.055, .44, 0]];
    pads = JUNIPER; thickness = .047;
  } else if (species === "bonsai-azalea") {
    trunk = [[0, 0, .01], [.025, .055, -.01], [-.02, .11, .015],
      [.015, .18, -.01], [0, .27, .01], [.005, .37, 0]];
    pads = AZALEA; thickness = .058;
  } else {
    trunk = [[-.025, 0, 0], [.015, .10, .015], [-.035, .20, 0],
      [.025, .31, -.01], [-.015, .40, .015], [0, .49, 0]];
    pads = ELM; thickness = .047;
  }
  const transform = (point: Point3): Point3 => {
    let [x, y, z] = point;
    if (variant === 1) { x -= y * .28; y *= .88; z += y * .055; }
    if (variant === 2) { x = x * .88 + y * .06; z *= 1.15; }
    return [x, y + base, z];
  };
  const path = trunk.map(transform);
  return { path, thickness, pads: pads.map(([x, y, z, radius], index) => {
    const point = transform([x, y, z]);
    if (variant === 1 && index % 2 === 0) point[1] -= .025;
    if (variant === 2 && index % 2 === 1) { point[0] += .02; point[1] -= .045; }
    return { centre: point, radius: radius * (variant === 2 ? .94 : 1) };
  }) };
};

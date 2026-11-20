import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { RomanDesignContext } from "./roman-design-kit";
import type { AddPart } from "./roman-resource-workshops";

/** Warm hammered copper, a rounded lid and side lifting handles on the original hearth. */
export const addRomanBrewingKettle = ({ detailed, part, parts }: RomanDesignContext) => {
  part("copper", [.81, .89, .35], [.49, .48, .49], 3, "sphere");
  parts[parts.length - 1]!.radialSegments = detailed ? 16 : 8;
  part("copper", [.81, 1.11, .35], [.38, .045, .38], 3, "sphere");
  part("wood", [.81, 1.155, .35], [.055, .035, .055], 3, "cylinder");
  for (const side of detailed ? [-1, 1] : [1]) {
    part("iron", [.81 + side * .25, .995, .35], [.095, .105, .018], 3,
      "ring", [Math.PI / 2, 0, 0]);
    parts[parts.length - 1]!.radialSegments = detailed ? 10 : 6;
  }
};

/** Rounded painted tankard with a curved handle, foam and a lit side. */
export const addRomanBeerPainting = (part: AddPart, x: number, y: number, z: number) => {
  const ellipse = (dx: number, dy: number, width: number, height: number,
    color: Point3, layer = 0) => part("paint", [x + dx, y + dy, z + .026 + layer * .001],
    [width, height, .002], 3, "sphere", undefined, color);
  ellipse(.047, .002, .065, .078, [.19, .12, .055]);
  ellipse(.047, .005, .043, .055, [.9, .72, .4], 1);
  ellipse(.047, .005, .027, .035, [.62, .57, .49], 2);
  ellipse(-.007, -.006, .104, .102, [.27, .16, .045], 3);
  ellipse(-.009, -.003, .087, .09, [.94, .61, .12], 4);
  ellipse(-.025, .003, .015, .065, [1, .8, .34], 5);
  for (const [dx, dy, size] of [[-.037, .043, .034], [-.009, .05, .043], [.019, .044, .035]])
    ellipse(dx!, dy!, size!, .026, [.98, .96, .83], 6);
};

/** Inputs beside the right wall; no stock obscures the door or sits far out in the grass. */
export const placeRomanBreweryInputs = (parts: BuildingPart[]) => {
  for (const [ware, z] of [["water", -.48], ["grain", .07]] as const) {
    const stock = parts.filter(part => part.stock?.kind === "input" && part.stock.ware === ware);
    if (!stock.length) continue;
    const bounds = stock.map(part => getRomanPartBounds(part));
    const centerX = (Math.min(...bounds.map(bound => bound.min[0])) +
      Math.max(...bounds.map(bound => bound.max[0]))) / 2;
    const centerZ = (Math.min(...bounds.map(bound => bound.min[2])) +
      Math.max(...bounds.map(bound => bound.max[2]))) / 2;
    for (const part of stock) {
      part.position[0] += 1.24 - centerX;
      part.position[2] += z - centerZ;
    }
  }
  // The existing two-unit input target needs two places: slot clamping stacked both deliveries.
  // Keep slot zero fixed and put the second handled bucket alongside it toward the rear, away from the grain bay.
  if (parts.some(part => part.stock?.kind === "input" && part.stock.ware === "water" && part.stock.slot === 1))
    return;
  const firstWater = parts.filter(part => part.stock?.kind === "input" && part.stock.ware === "water" &&
    part.stock.slot === 0);
  for (const piece of firstWater) parts.push({ ...piece,
    position: [piece.position[0], piece.position[1], piece.position[2] - .24],
    stock: { ...piece.stock!, slot: 1 }
  });
};

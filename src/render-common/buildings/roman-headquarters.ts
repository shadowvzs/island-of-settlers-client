import { DMath } from "../../shared/math/deterministic-math";
import { type RomanDesignContext,romanLadder, romanRoom } from "./roman-design-kit";
import type { AddPart } from "./roman-resource-workshops";

const red: [number, number, number] = [.36, .075, .105];
const blue: [number, number, number] = [.08, .26, .43];

/** Columns carry actual roofs; their individual plinths never create a ground platform. */
const civicColumn = (context: RomanDesignContext, x: number, z: number, base: number, top: number, width: number) => {
  const { detailed, part } = context;
  if (detailed) part("stone", [x, base + .035, z], [width * 1.6, .07, width * 1.6], 2, "box");
  const portico = detailed && top < 2;
  part("stone", [x, (base + top) / 2, z], [width, detailed ? top - base - .08 : top - base, width],
    2, portico ? "civic-column-shaft" : "cylinder");
  context.parts.at(-1)!.radialSegments = detailed ? 12 : 4;
  context.parts.at(-1)!.civicPorticoColumn = true;
  if (detailed || (top < 2 && z > 1.4)) part("stone", [x, top - .035, z], [width * 1.7, .07, width * 1.7], 2, "box");

};

const civicStatue = (part: AddPart, base: number, _detailed: boolean) => {
  part("stone", [0, base + .035, 0], [.24, .07, .24], 4, "bevel-box");
  part("paint", [0, base + .43, 0], [.50, .72, .45], 4, "civic-statue");
};

const portico = (context: RomanDesignContext) => {
  const { part } = context;
  for (const x of [-1.10, -.60, .60, 1.10]) civicColumn(context, x, 1.51, .18, 1.50, .13);
  for (const x of [-1.10, 1.10]) civicColumn(context, x, 1.02, .18, 1.50, .13);
  part("stone", [0, 1.475, 1.51], [2.45, .10, .20], 2);
  for (const side of [-1, 1]) {
    part("stone", [side * 1.10, 1.475, 1.26], [.16, .10, .72], 2);
    part("roof", [side * .61, 1.745, 1.38], [1.25, .06, 1.00], 4, "box", [0, 0, -side * .36]);
  }
  part("roof", [0, 1.975, 1.38], [.07, 1.02, .07], 4, "cylinder", [Math.PI / 2, 0, 0]);
  part("stone", [0, 1.745, 1.835], [2.42, .44, .09], 3, "gable");
  part("paint", [0, 1.475, 1.617], [2.37, .075, .018], 3, "box", undefined, red);
  for (const x of context.detailed ? [-.94, -.65, .65, .94] : [])
    part("gold", [x, 1.475, 1.634], [.035, .055, .014], 3, "box", undefined, [.93, .75, .32]);
};

/** Original warm-stone Roman civic landmark: real entrance, open loggia and a terracotta cupola. */
export const addRomanCivicHeadquarters = (context: RomanDesignContext) => {
  const { detailed, part, parts, roof } = context;
  romanRoom(context, 0, 0, 2.22, 1.68, 1.38, 0, .18, false);
  const ceiling = parts.find(piece => piece.stage === 2 && Math.abs(piece.position[1] - 1.595) < .00001)!;
  parts.splice(parts.indexOf(ceiling), 1);
  // Four ceiling pieces leave a real hatch for the ladder, including the upper floor.
  for (const side of [-1, 1]) {
    part("stone", [side * .71, 1.595, 0], [.82, .07, 1.72], 2);
    part("stone", [0, 1.595, side * .58], [.60, .07, .56], 2);
  }
  romanLadder(part, 0, -.02, 2.04, .18, detailed ? .12 : .25);
  for (const side of [-1, 1]) {
    romanRoom(context, side * 1.31, -.16, .64, 1.36, 1.12, undefined, .18, false);
    roof(side * 1.31, 1.35, -.16, .80, 1.56);
    if (detailed) part("paint", [side * .75, 1.36, .903], [.39, .075, .018], 3, "box", undefined, blue);
  }
  portico(context);
  part("roof", [0, 1.755, 0], [2.34, .24, 1.90], 4, "civic-hipped-roof");
  part("stone", [0, 1.75, 0], [1.64, .26, 1.64], 2, "ring");
  parts.at(-1)!.innerRadius = .19;
  parts.at(-1)!.radialSegments = detailed ? 24 : 12;
  for (let i = 0; i < 12; i++) {
    const angle = (i + .5) * Math.PI / 6;
    civicColumn(context, DMath.sin(angle) * .72, DMath.cos(angle) * .72, 1.87, 2.68, .10);
  }
  part("stone", [0, 2.70, 0], [1.78, .09, 1.78], 2, "ring");
  parts.at(-1)!.radialSegments = detailed ? 24 : 12;
  part("paint", [0, 2.775, 0], [1.82, .15, 1.82], 3, "ring", undefined, red);
  parts.at(-1)!.radialSegments = detailed ? 24 : 12;
  part("roof", [0, 2.85, 0], [1.89, 1.25, 1.89], 4, "dome");
  if (detailed) for (const angle of [Math.PI/4,Math.PI*3/4,Math.PI*5/4,Math.PI*7/4])
    part("gold", [DMath.sin(angle)*.916,2.775,DMath.cos(angle)*.916], [.055,.070,.012], 3,
      "gable", [0,angle,0], [.92,.73,.28]);
  civicStatue(part, 3.475, detailed);
  // Visible upper furnishings sit on the ring floor; a hatch and ladder connect to the main hall.
  part("wood", [.50, 1.995, -.05], [.25, .25, .25], 3, "bevel-box");
  part("wood", [.50, 2.1325, -.05], [.34, .045, .29], 3, "bevel-box");
  if (detailed) part("paint", [.50, 2.1675, -.05], [.18, .025, .16], 3, "box", undefined, [.85, .72, .43]);
  return { flagAnchor: [-1.31, 1.77, -.16] as [number, number, number] };
};

import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";
import { stoneWareAppearance, woodWareAppearance } from "./advanced-material-variants";
import type { WareId } from "./ware-catalog";
import { addTimberLog } from "./ware-timber-recipe";

const DARK_HEARTWOOD: Point3 = [.55, .35, .23];
const WARM_CUT: Point3 = [.78, .55, .34];

/** Loose paired trunks and stacked boards remain distinct even without colour. */
const addHardwood = (part: AddPart, logs: boolean, detailed: boolean, compactStock: boolean) => {
  if (logs) {
    const heartwood: AddPart = (surface, position, size, stage, shape, rotation) => {
      // Buried rear cut faces need no separate disk in the cheap stock-pile representation.
      if (compactStock && !detailed && surface === "endgrain" && position[2] < 0) return;
      part(surface, position, size, stage, shape, rotation,
        surface === "endgrain" ? WARM_CUT : DARK_HEARTWOOD);
    };
    for (const x of [-.065, .065])
      addTimberLog(heartwood, { position: [x, 0, 0], diameter: .12, length: .7, detailed: detailed && !compactStock });
    return;
  }
  if (compactStock && !detailed) {
    // Three stacked faces replace hidden inner boards in cheap stock geometry.
    for (const y of [-.04, 0, .04])
      part("wood", [0, y, 0], [.19, .035, .7], 3, "box", undefined, DARK_HEARTWOOD);
    return;
  }
  for (let board = 0; board < 4; board++) {
    const y = (board - 1.5) * .037;
    part("wood", [0, y, (board % 2) * .025], [.19, .033, .7], 3, compactStock ? "box" : "bevel-box",
      undefined, DARK_HEARTWOOD);
    if (detailed)
      for (const z of [-.35, .35])
        part("endgrain", [0, y, z + (board % 2) * .025], [.18, .025, .001], 3,
          "box", undefined, WARM_CUT);
  }
  if (detailed)
    for (const x of [-.055, .01, .063])
      part("paint", [x, .073, .01], [.002, .001, .63], 3, "box", undefined, [.22, .12, .065]);
};

/** Cut marble has a broad slab silhouette and branching mineral seams on exposed faces. */
const addMarble = (part: AddPart, detailed: boolean, ware: string) => {
  const appearance = stoneWareAppearance(ware)!;
  part("paint", [0, 0, 0], [.36, .23, .27], 3, "bevel-box", undefined, [...appearance.body]);
  const veins = detailed ? [-.12, -.025, .09] : [-.065, .075];
  for (const x of veins) {
    const segments = detailed ? 5 : 3;
    for (let segment = 0; segment < segments; segment++) {
      const z = -.125 + (segment + .5) * .25 / segments;
      const bend = .012 * DMath.sin(segment * 1.4 + x * 8);
      part("paint", [x + bend, .1155, z], [.003, .001, .25 / segments + .004], 3,
        "box", [0, -.28 * DMath.cos(segment * 1.4 + x * 8), 0], [...appearance.seam]);
      const y = -.1 + (segment + .5) * .2 / segments;
      part("paint", [x - .01 + bend, y, .1355], [.003, .2 / segments + .004, .001], 3,
        "box", [0, 0, -.28 * DMath.cos(segment * 1.4 + x * 8)], [...appearance.seam]);
    }
    part("paint", [x + .045, .1157, .035], [.002, .001, .12], 3, "box",
      [0, .65, 0], [.59, .62, .58]);
  }

};

/** Four cut boards with the same seated bottom as the hardwood reference. */
const addPlankVariant = (
  part: AddPart, detailed: boolean, width: number, length: number, tint: Point3,
  edge?: "bark" | "stripe", edgeTint: Point3 = WARM_CUT
) => {
  for (let board = 0; board < 4; board++) {
    const y = (board - 1.5) * .037, z = (board % 2) * .02;
    part("wood", [0, y, z], [width, .033, length], 3, "bevel-box", undefined, tint);
    if (detailed) for (const side of [-1, 1])
      part("endgrain", [0, y, z + side * (length / 2 - .0003)], [width * .84, .025, .0006],
        3, "box", undefined, edgeTint);
    if (edge === "bark") for (const side of [-1, 1])
      part("bark", [side * (width / 2 + .006), y, z], [.012, .033, length], 3, "box", undefined, tint);
  }
  if (edge === "stripe")
    part("paint", [0, .073, .01], [.002, .001, length * .92], 3, "box", undefined, edgeTint);
};

/** Three side-by-side logs; same resting height as the paired hardwood logs. */
const addCedarLogs = (part: AddPart, detailed: boolean) => {
  for (const x of [-.078, 0, .078])
    addTimberLog(part, { position: [x, 0, 0], diameter: .12, length: .82, detailed });
};

/** Broad walnut cuts, with one shorter trunk exposing both uneven ends. */
const addWalnutLogs = (part: AddPart, detailed: boolean) => {
  addTimberLog(part, { position: [-.075, 0, 0], diameter: .15, length: .70, detailed });
  addTimberLog(part, { position: [.08, -.018, .06], diameter: .115, length: .53, detailed });
};

/** A heavy mahogany bole paired with a narrow, shorter offcut. */
const addMahoganyLogs = (part: AddPart, detailed: boolean) => {
  addTimberLog(part, { position: [-.04, 0, 0], diameter: .19, length: .72, detailed });
  addTimberLog(part, { position: [.10, -.05, .10], diameter: .08, length: .43, detailed });
};

const addLimestone = (part: AddPart, detailed: boolean, appearance: { body: readonly number[]; seam: readonly number[] }) => {
  for (let layer = 0; layer < 3; layer++)
    part("paint", [(layer - 1) * .018, -.08 + layer * .075, (layer % 2) * .016],
      [.32 - layer * .025, .07, .24 - layer * .012], 3, "stone-block",
      [0, (layer - 1) * .06, 0], [...appearance.body] as Point3);
  if (!detailed) return;
  for (const y of [-.04, .035])
    part("paint", [0, y, .123], [.25, .002, .002], 3, "box", undefined, [...appearance.seam] as Point3);
};

const addGranite = (part: AddPart, appearance: { body: readonly number[]; seam: readonly number[] }) => {
  const chunks: [number, number, number, number, number, number][] = [
    [-.065, -.015, -.025, .30, .28, .29], [.085, -.045, .065, .25, .22, .25]
  ];
  for (const [x, y, z, w, h, d] of chunks) {
    part("paint", [x, y, z], [w, h, d], 3, "rock", [0, (x + z) * 2.3, 0],
      [...appearance.body] as Point3);
  }
};

const addBasalt = (part: AddPart, appearance: { body: readonly number[]; seam: readonly number[] }) => {
  part("paint", [0, 0, 0], [.32, .27, .27], 3, "cylinder", [0, .18, -.08],
    [...appearance.body] as Point3);
};

export const addAdvancedMaterialWare = (part: AddPart, id: WareId | null, detailed: boolean, compactStock = false) => {
  const stone = id ? stoneWareAppearance(id) : undefined;
  if (stone) {
    if (id === "limestone") addLimestone(part, detailed, stone);
    else if (id === "granite") addGranite(part, stone);
    else if (id === "basalt") addBasalt(part, stone);
    else addMarble(part, detailed, id!);
    return true;
  }
  const wood = id ? woodWareAppearance(id) : undefined;
  if (!wood) return false;
  const tinted: AddPart = (surface, position, size, stage, shape, rotation, tint) => {
    const colour = tint?.map((value, axis) => value * wood.tint[axis]!) as Point3 | undefined;
    part(surface, position, size, stage, shape, rotation, colour);
  };
  const logs = wood.source === "logs";
  if (id === "cedarLogs") { addCedarLogs(tinted, detailed); return true; }
  if (id === "cedarPlanks") { addPlankVariant(tinted, detailed, .10, .84, [...wood.tint] as Point3); return true; }
  if (id === "walnutLogs") { addWalnutLogs(tinted, detailed); return true; }
  if (id === "walnutPlanks") {
    addPlankVariant(tinted, detailed, .18, .58, [...wood.tint] as Point3, "bark", DARK_HEARTWOOD); return true;
  }
  if (id === "mahoganyLogs") { addMahoganyLogs(tinted, detailed); return true; }
  if (id === "mahoganyPlanks") {
    addPlankVariant(tinted, detailed, .21, .74, [...wood.tint] as Point3, "stripe", [.30, .16, .10]); return true;
  }
  addHardwood(tinted, logs, detailed, compactStock);
  return true;
};

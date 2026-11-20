import { DMath } from "../../shared/math/deterministic-math";
import { withBuildingStock } from "./building-stock-parts";
import type { AddPart } from "./roman-resource-workshops";

const table = (part: AddPart, x: number, z: number, w: number, d: number, y = 0.61) => {
  part("wood", [x, y, z], [w, 0.045, d], 3);
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      part(
        "wood",
        [x + side * w * 0.4, (y + 0.18) / 2, z + end * d * 0.38],
        [0.045, y - 0.18, 0.045],
        2
      );
};

/** Sturdy joined bakery counter: separate top boards, apron rails and grounded trestle legs. */
export const addBakeryDisplayTable = (part: AddPart, x: number, z: number, detailed: boolean) => {
  const width = .49, depth = .62;
  const boards = detailed ? 5 : 1;
  for (let index = 0; index < boards; index++)
    part("wood", [x - width / 2 + width * (index + .5) / boards, .49, z],
      [width / boards - (detailed ? .004 : 0), .07, depth], 3, "bevel-box");
  for (const side of [-1, 1]) {
    part("wood", [x + side * .187, .335, z - .211], [.065, .31, .065], 2);
    part("wood", [x + side * .187, .335, z + .211], [.065, .31, .065], 2);
    part("wood", [x + side * .187, .255, z], [.055, .055, .48], 2);
    part("wood", [x + side * .211, .422, z], [.035, .065, .55], 3);
  }
  for (const end of [-1, 1])
    part("wood", [x, .422, z + end * .251], [.42, .065, .035], 3);
  part("wood", [x, .255, z], [.4, .045, .045], 2);
};

export const addBakeryProps = (
  part: AddPart,
  width: number,
  depth: number,
  detailed: boolean,
  ovenZ: number,
  tableX: number,
  tableZ: number
) => {
  const x = tableX,
    z = tableZ + 0.03;
  // A thin rectangular serving board leaves the loaves clearly visible, without a deep basin.
  part("wood", [x, 0.536, z], [0.43, 0.018, 0.55], 3, "bevel-box");
  if (detailed) {
    for (const side of [-1, 1])
      part("wood", [x + side * .21, .552, z], [.016, .022, .55], 3);
    for (const end of [-1, 1])
      part("wood", [x, .552, z + end * .267], [.42, .022, .016], 3);
  }
  // A recognizable long-handled oven peel rests on the ground beside the stone oven.
  const peelX = width / 2 + 0.67;
  part("wood", [peelX, 0.305, ovenZ + 0.52], [0.18, 0.25, 0.035], 3, "sphere");
  part("wood", [peelX, 0.7, ovenZ + 0.52], [0.027, 0.57, 0.027], 3, "cylinder");
  if (!detailed) return;
  // The kneading bench occupies the front-right yard, clear of the central entrance and oven.
  const prepZ = depth / 2 + 0.27;
  const prepX = width / 2 + 0.25;
  table(part, prepX - 0.12, prepZ, 0.64, 0.34);
  // Hollow kneading trough, pale dough and a rolling pin on a separate preparation bench.
  part("wood", [prepX - 0.24, 0.665, prepZ], [0.29, 0.045, 0.24], 3);
  for (const side of [-1, 1])
    part("wood", [prepX - 0.24 + side * 0.135, 0.707, prepZ], [0.025, 0.09, 0.24], 3);
  for (const end of [-1, 1])
    part("wood", [prepX - 0.24, 0.707, prepZ + end * 0.108], [0.25, 0.09, 0.025], 3);
  part(
    "paint",
    [prepX - 0.24, 0.708, prepZ],
    [0.2, 0.06, 0.15],
    3,
    "sphere",
    undefined,
    [0.8, 0.71, 0.52]
  );
  part("wood", [prepX + 0.09, 0.665, prepZ], [0.055, 0.25, 0.055], 3, "cylinder", [
    0,
    0,
    Math.PI / 2
  ]);
  part("wood", [prepX + 0.09, 0.665, prepZ], [0.022, 0.36, 0.022], 3, "cylinder", [
    0,
    0,
    Math.PI / 2
  ]);
};

export const addSmelterProps = (part: AddPart, width: number, depth: number, detailed: boolean) => {
  // The open input sacks expose the ore already; avoid a duplicate bin widening this bay.
  if (!detailed) return;
  const moldX = -width / 2 - 0.3,
    moldZ = -depth / 2 + 0.18;
  table(part, moldX, moldZ, 0.6, 0.31, 0.44);
  for (const side of [-1, 1]) {
    part("iron", [moldX + side * 0.145, 0.485, moldZ], [0.24, 0.045, 0.2], 3, "bevel-box");
    part("dark", [moldX + side * 0.145, 0.51, moldZ], [0.14, 0.006, 0.12], 3);
  }
  // Thick-rimmed crucible and long lifting tongs on their own grounded work stand.
  const crucibleX = width / 2 + 0.35;
  part("stone", [crucibleX, 0.28, 0.7], [0.29, 0.2, 0.28], 2, "bevel-box");
  part("iron", [crucibleX, 0.457, 0.7], [0.25, 0.155, 0.25], 3, "ring");
  part("dark", [crucibleX, 0.405, 0.7], [0.19, 0.035, 0.19], 3, "cylinder");
  for (const side of [-1, 1])
    part("iron", [crucibleX + side * 0.06, 0.52, 0.58], [0.018, 0.018, 0.36], 3, "box", [
      0,
      side * 0.18,
      0
    ]);
};

export const addMetalworksProps = (
  part: AddPart,
  width: number,
  depth: number,
  detailed: boolean
) => {
  // These existing boards are the actual input stock, rather than decoration plus a duplicate bay.
  for (let i = 0; i < 6; i++)
    withBuildingStock(part, "planks", i, "input")("wood",
      [-width / 2 - 0.25, 0.205 + i * 0.06, -depth / 2 + 0.28], [0.4, 0.055, 0.5], 3);
  const x = width / 2 + 0.38,
    z = depth / 2 + 0.14;
  // A water-filled quenching barrel distinguishes forging from ore smelting.
  part("wood", [x, 0.35, z], [0.36, 0.34, 0.36], 3, "ring");
  part("wood", [x, 0.2, z], [0.3, 0.035, 0.3], 3, "cylinder");
  part("paint", [x, 0.455, z], [0.27, 0.012, 0.27], 3, "cylinder", undefined, [0.1, 0.22, 0.25]);
  for (const y of [0.24, 0.46]) part("iron", [x, y, z], [0.375, 0.018, 0.375], 3, "cylinder");
  // Working hammer and tongs hang from an iron bar on the facade, never a decorative board.
  const rackX = -width * 0.4,
    front = depth / 2;
  part("iron", [rackX, 1.02, front + 0.06], [0.28, 0.025, 0.035], 3);
  for (const side of [-1, 1])
    part("iron", [rackX + side * 0.115, 1.02, front + 0.035], [0.022, 0.05, 0.07], 3);
  for (const side of [-1, 1])
    part(
      "iron",
      [rackX - 0.055 + side * 0.018, 0.86, front + 0.075],
      [0.012, 0.29, 0.014],
      3,
      "box",
      [0, 0, side * 0.13]
    );
  part("wood", [rackX + 0.08, 0.86, front + 0.075], [0.022, 0.27, 0.022], 3);
  part("steel", [rackX + 0.08, 0.992, front + 0.075], [0.085, 0.055, 0.038], 3);
  if (!detailed) return;
  for (let index = 0; index < 12; index++) {
    const angle = (index * Math.PI * 2) / 12;
    part(
      "wood",
      [x + DMath.sin(angle) * 0.179, 0.35, z + DMath.cos(angle) * 0.179],
      [0.006, 0.3, 0.022],
      3,
      "box",
      [0, angle, 0]
    );
  }
};

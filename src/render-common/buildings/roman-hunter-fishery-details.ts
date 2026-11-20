import { addBoneInMeatHaunch } from "../wares/ware-meat-recipe";
import type { AddPart } from "./roman-resource-workshops";

/** Side drying rack, turned across the facade axis; weapons stay outside the approach. */
export const addHunterDetails = (
  part: AddPart,
  width: number,
  depth: number,
  _detailed: boolean
) => {
  const x = width / 2 + 0.2,
    z = -depth * 0.08;
  for (const side of [-1, 1]) part("wood", [x, 0.73, z + side * 0.38], [0.055, 1.1, 0.055], 2);
  for (const height of [1.27, 0.77]) {
    part("wood", [x, height, z], [0.065, 0.065, 0.84], 2);
    for (let slot = 0; slot < 3; slot++)
      // Bottom meets the bone's binding at 1.077 / .577; top is buried in the beam.
      part("rope", [x, height - 0.0965, z - 0.24 + slot * 0.24], [0.015, 0.193, 0.015], 3, "cord",
        undefined, undefined, undefined, slot + (height < 1 ? 3 : 0));
  }
  for (let i = 0; i < 6; i++) {
    const rz = z - 0.24 + (i % 3) * 0.24;
    const outputPart: AddPart = (surface, position, size, stage, shape, rotation, tint) =>
      part(surface, position, size, stage, shape, rotation, tint,
        { ware: "meat", slot: i, kind: "output", presentation: "hanging" });
    const meatPart: AddPart = (surface, position, size, stage, shape, rotation, tint) =>
      outputPart(
        surface,
        [position[0], position[1] - Math.floor(i / 3) * 0.5, position[2]],
        size,
        stage,
        shape,
        rotation,
        tint
      );
    addBoneInMeatHaunch(meatPart, [x, 0.885, rz], i % 2 ? -0.12 : 0.12);
  }
  // A narrow side-wall preparation bench leaves the complete entrance free.
  const tx = -0.77,
    tz = -0.06;
  for (const end of [-1, 1]) part("wood", [tx, 0.38, tz + end * 0.23], [0.3, 0.4, 0.045], 2);
  part("wood", [tx, 0.6, tz], [0.32, 0.055, 0.61], 3);
  part("wood", [tx, 0.639, tz - 0.095], [0.028, 0.018, 0.095], 3);
  part("iron", [tx, 0.642, tz - 0.043], [0.045, 0.025, 0.016], 3);
  part(
    "paint",
    [tx, 0.64, tz + 0.045],
    [0.035, 0.018, 0.16],
    3,
    "sphere",
    undefined,
    [0.64, 0.66, 0.68]
  );
};

/** Visible working interior behind the fishery sorting hatch, using grounded furnishings. */
export const addFisheryInterior = (
  part: AddPart,
  width: number,
  depth: number,
  detailed: boolean
) => {
  const x = 0.25,
    z = depth / 2 - 0.36;
  for (const side of [-1, 1]) part("wood", [x + side * 0.18, 0.43, z], [0.045, 0.5, 0.26], 2);
  part("wood", [x, 0.7, z], [0.49, 0.055, 0.3], 3);
  for (let i = 0; i < (detailed ? 3 : 1); i++)
    part(
      "paint",
      [x - 0.13 + i * 0.12, 0.755, z],
      [0.075, 0.045, 0.2],
      3,
      detailed ? "sphere" : "box",
      undefined,
      [0.5, 0.62, 0.64]
    );
  const back = -depth / 2 + 0.13;
  for (const bx of [-0.3, 0.28]) {
    part("wood", [bx, 0.48, back], [0.26, 0.6, 0.26], 3, detailed ? "cylinder" : "box");
    if (detailed)
      for (const y of [0.25, 0.67]) part("iron", [bx, y, back], [0.27, 0.025, 0.27], 3, "cylinder");
  }
  if (detailed) {
    for (const y of [0.82, 1.02]) {
      part("wood", [0, y, back], [width - 0.22, 0.035, 0.24], 3);
      for (const side of [-1, 1])
        part("wood", [side * 0.45, y - 0.05, back - 0.04], [0.035, 0.1, 0.13], 3);
      for (const bx of [-0.42, 0.36])
        part("roof", [bx, y + 0.065, back], [0.1, 0.095, 0.1], 3, "cylinder");
    }
  }
};

import { DMath } from "../../shared/math/deterministic-math";
import { addTimberLog } from "../wares/ware-timber-recipe";
import { withBuildingStock } from "./building-stock-parts";
import type { AddPart } from "./roman-resource-workshops";

/** Second menu batch: military masonry, an observation balcony, and practical water/timber yards. */
export const addRomanSecondBatchDetails = (
  id: number,
  part: AddPart,
  width: number,
  depth: number,
  height: number,
  detailed: boolean
) => {
  const front = depth / 2;
  if (id === 1) addBarracksYard(part, width, depth, height, detailed);
  if (id === 2) addGuardhouseFacade(part, width, front, height, detailed);
  if (id === 14) addLookoutBalcony(part, width, front, detailed);
  if (id === 35) addWellEquipment(part, detailed);
  if (id === 33) addSawmillShelter(part, width, depth, detailed);
};

const addBarracksYard = (
  part: AddPart,
  width: number,
  depth: number,
  height: number,
  detailed: boolean
) => {
  // Practical stone arrow slits; military identity comes from the sword rack and roof flag.
  if (detailed) {
    for (const z of [-0.4, 0.3]) {
      part("stone", [width / 2 - 0.03, height * 0.65, z], [0.14, 0.31, 0.17], 2);
      part("dark", [width / 2 + 0.043, height * 0.65, z], [0.01, 0.23, 0.055], 3);
    }
  }
};

const addGuardhouseFacade = (
  part: AddPart,
  width: number,
  front: number,
  height: number,
  detailed: boolean
) => {
  // Taller command lodge: masonry quoins and narrow high windows.
  for (const side of [-1, 1]) {
    for (let i = 0; i < (detailed ? 5 : 3); i++)
      part(
        "stone",
        [side * (width / 2 - 0.06), 0.29 + i * (detailed ? 0.25 : 0.4), front],
        [0.22, 0.18, 0.2],
        2
      );
    part("dark", [side * 0.48, 0.83, front + 0.064], [0.1, 0.2, 0.02], 2);
  }
};

const addLookoutBalcony = (part: AddPart, width: number, front: number, detailed: boolean) => {
  // High lookout deck: entirely above the door approach, with wall-mounted support brackets.
  const deckZ = front + 0.16;
  part("wood", [0, 1.94, 0], [width - 0.14, 0.05, front * 2], 2);

  for (const side of [-1, 1]) {
    part("stone", [side * 0.205, 2.215, front + 0.068], [0.065, 0.55, 0.065], 2);
    part("wood", [side * 0.15, 1.12, -front + 0.13], [0.04, 1.88, 0.04], 2);
  }
  part("stone", [0, 2.49, front + 0.068], [0.475, 0.065, 0.065], 2);

  for (let i = 0; i < 9; i++)
    part("wood", [0, 0.28 + i * 0.205, -front + 0.13], [0.32, 0.028, 0.035], 2);
  part("wood", [0, 1.92, deckZ], [width + 0.35, 0.09, 0.4], 2);
  for (const side of [-1, 1]) {
    part("wood", [side * (width / 2 + 0.09), 2.14, front + 0.33], [0.045, 0.37, 0.045], 3);
    part("wood", [side * width * 0.35, 1.76, front + 0.1], [0.06, 0.31, 0.14], 2);
    part(
      "wood",
      [side * width * 0.35, 1.72, front + 0.14],
      [0.06, 0.31, 0.06],
      2,
      "box",
      [0.45, 0, 0]
    );
  }
  part("wood", [0, 2.32, front + 0.33], [width + 0.27, 0.045, 0.045], 3);
  part("wood", [0, 2.13, front + 0.33], [width + 0.27, 0.035, 0.035], 3);
  if (detailed)
    for (const x of [-0.12, 0.12]) part("wood", [x, 2.14, front + 0.33], [0.028, 0.36, 0.028], 3);
};

const addWellEquipment = (part: AddPart, detailed: boolean) => {
  // Trough behind the shaft, with its long axis across the narrow plot.
  const z = -0.75;
  part("wood", [-0.03, 0.205, z], [0.53, 0.05, 0.43], 2);
  for (const side of [-1, 1]) {
    const rows = detailed ? 3 : 2;
    const boardHeight = detailed ? 0.062 : 0.095;
    for (let row = 0; row < rows; row++) {
      const y = detailed ? 0.25 + row * 0.065 : 0.2665 + row * 0.095;
      part("wood", [-0.03 + side * 0.245, y, z], [0.04, boardHeight, 0.43], 2);
      part("wood", [-0.03, y, z + side * 0.195], [0.53, boardHeight, 0.04], 2);
    }
    for (const end of [-1, 1])
      if (detailed || side === 1)
        part("iron", [-0.03 + end * 0.15, 0.3, z + side * 0.199], [0.018, 0.2, 0.012], 3);
  }
  addFilledWaterBuckets(part, detailed);
};

/** Separate collected output from the empty spare bucket and the moving draw bucket. */
const addFilledWaterBuckets = (part: AddPart, detailed: boolean) => {
  for (let bucket = 0; bucket < 6; bucket++) {
    const outputPart = withBuildingStock(part, "water", bucket);
    // Compact right-hand collection bay leaves the front-left windlass position clear.
    const x = 0.13 + (bucket % 2) * 0.26,
      z = 0.48 + Math.floor(bucket / 2) * 0.25;
    if (detailed) outputPart("wood", [x, 0.195, z], [0.22, 0.03, 0.22], 3, "cylinder");
    outputPart(
      "wood",
      [x, detailed ? 0.315 : 0.30, z],
      [0.24, 0.24, 0.24],
      3,
      "ring"
    );
    outputPart(
      "paint",
      [x, 0.402, z],
      [0.19, 0.009, 0.19],
      3,
      "cylinder",
      undefined,
      [0.045, 0.24, 0.3]
    );
    for (const y of detailed ? [0.235, 0.375] : [0.375])
      outputPart("iron", [x, y, z], [0.249, 0.015, 0.249], 3, "ring");
    if (detailed)
      for (let stave = 0; stave < 8; stave++) {
        const angle = stave * Math.PI / 4;
        outputPart("wood", [x + DMath.sin(angle) * 0.12, 0.315, z + DMath.cos(angle) * 0.12],
          [0.0025, 0.19, 0.006], 3, "box", [0, angle, 0], [0.58, 0.55, 0.5]);
      }
    if (detailed)
      for (const side of [-1, 1])
        outputPart("iron", [x + side * 0.102, 0.45, z], [0.012, 0.15, 0.012], 3);
    outputPart("wood", [x, detailed ? 0.525 : 0.43, z], [0.22, 0.02, 0.02], 3);
    if (detailed)
      outputPart(
        "paint",
        [x, 0.408, z - 0.035],
        [0.12, 0.002, 0.012],
        3,
        "box",
        undefined,
        [0.2, 0.48, 0.48]
      );
  }
};

const addSawmillShelter = (part: AddPart, width: number, depth: number, detailed: boolean) => {
  const x = width / 2 + 0.4,
    z = -depth * 0.12 + 0.12;
  // Sloped side shelter, with every post meeting the roof and the ground.
  for (const side of [-1, 1])
    for (const end of [-1, 1]) {
      const top = 1.34 - side * 0.27 * DMath.tan(0.16);
      part(
        "wood",
        [x + side * 0.27, (top + 0.18) / 2, z + end * 0.4],
        [0.055, top - 0.18, 0.055],
        2
      );
    }
  part("roof", [x, 1.34, z], [0.79, 0.065, 0.95], 4, "box", [0, 0, -0.16]);
  part("wood", [x, 0.48, z], [0.65, 0.065, 0.82], 2);
  for (const side of [-1, 1]) part("wood", [x + side * 0.22, 0.34, z], [0.06, 0.32, 0.6], 2);
  addTimberLog(part, { position: [x, 0.59, z], diameter: 0.16, length: 0.73, detailed });
  // Output belongs to the six front-left stock slots; the shelter never duplicates those units.
};

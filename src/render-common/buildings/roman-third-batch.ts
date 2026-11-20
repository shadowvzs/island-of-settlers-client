import { DMath } from "../../shared/math/deterministic-math";
import { MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import { PRODUCTION_RULES } from "../../shared/settlement/production-rules";
import { withBuildingStock } from "./building-stock-parts";
import { addBakeryDisplayTable, addBakeryProps, addMetalworksProps, addSmelterProps } from "./roman-industry-props";
import type { AddPart } from "./roman-resource-workshops";
import { addPositionedRomanWareStock } from "./roman-stock-layout";
import {
  addRomanButcherInputs,
  addRomanStockBag,
  addRomanWheatBales} from "./roman-workshop-stock";

/** Practical food and metal workshops; shared granite walls, distinct working yards. */
export const ROMAN_THIRD_BATCH_IDS = [21, 31, 32, 26, 25];
export const addRomanThirdBatch = (
  id: number,
  part: AddPart,
  width: number,
  depth: number,
  detailed: boolean
) => {
  if (id === 21) addButchersBay(part, width, depth, detailed);
  if (id === MILL_TYPE_ID) addMillEquipment(part, width, depth, detailed);
  if (id === 32) addBakeryOven(part, width, depth, detailed);
  if (id === 26) addSmeltingYard(part, width, depth, detailed);
  if (id === 25) addToolForge(part, width, depth, detailed);
};

const workTable = (part: AddPart, x: number, z: number, width: number, depth: number) => {
  part("wood", [x, 0.65, z], [width, 0.07, depth], 3);
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      part(
        "wood",
        [x + side * width * 0.38, 0.415, z + end * depth * 0.34],
        [0.055, 0.47, 0.055],
        2
      );
};
const sideRoof = (part: AddPart, x: number, z: number, width: number, depth: number) => {
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      part("wood", [x + side * width * 0.4, 0.71, z + end * depth * 0.4], [0.05, 1.06, 0.05], 2);
  part("roof", [x, 1.26, z], [width, 0.055, depth], 4, "box", [0, 0, -0.1]);
};
const addButchersBay = (part: AddPart, width: number, depth: number, detailed: boolean) => {
  const x = width / 2 + 0.36,
    z = -0.12;
  sideRoof(part, x, z, 0.78, 0.98);
  workTable(part, x, z + 0.12, 0.58, 0.65);
  part("wood", [x, 0.708, z + 0.12], [0.4, 0.045, 0.37], 3);
  // Six finished cuts hang on two short rails within the working bay.
  for (let slot = 0; slot < 6; slot++) {
    const meat = withBuildingStock(part, "meat", slot);
    const meatX = x - 0.21 + (slot % 3) * 0.21;
    const meatZ = z - 0.3 + Math.floor(slot / 3) * 0.23;
    meat("iron", [meatX, 1.02, meatZ], [0.009, 0.22, 0.009], 3);
    meat("paint", [meatX, 0.89, meatZ], [0.13, 0.22, 0.12], 3,
      detailed ? "bevel-box" : "box", undefined, [0.3, 0.12, 0.055]);
    meat("paint", [meatX, 0.98, meatZ], [0.027, 0.095, 0.028], 3,
      "cord", undefined, [0.3, 0.12, 0.055]);
  }
  for (const side of [-1, 1])
    part("wood", [x + side * 0.29, 1.15, z], [0.055, 0.06, 0.8], 3);
  for (const railZ of [z - 0.3, z - 0.07])
    part("wood", [x, 1.15, railZ], [0.62, 0.045, 0.06], 3);
  if (detailed) {
    part("steel", [x - 0.08, 0.743, z + 0.2], [0.025, 0.008, 0.14], 3);
    part("wood", [x - 0.08, 0.743, z + 0.29], [0.035, 0.014, 0.07], 3);
  }
  addRomanButcherInputs(part, width, depth, detailed);
};
const addMillEquipment = (part: AddPart, width: number, depth: number, detailed: boolean) => {
  addRomanWheatBales(withBuildingStock(part, "grain", 0, "input"), width, depth, detailed);
  for (let i = 0; i < 6; i++) {
    const stockPart = withBuildingStock(part, "flour", i);
    const sackPart: AddPart = (surface, position, size, stage, shape, rotation, tint) => {
      // A distant bag keeps its sewn silhouette; the tiny chalk mark belongs to High only.
      if (!detailed && size[0] === 0.064 && size[1] === 0.08) return;
      return stockPart(surface, position, size, stage, shape, rotation, tint);
    };
    addRomanStockBag(sackPart, width / 2 + 0.21 + Math.floor(i / 3) * 0.3,
      -depth * 0.2 + (i % 3) * 0.3, detailed);
  }
};
const addBakeryOven = (part: AddPart, width: number, depth: number, detailed: boolean) => {
  const x = width / 2 + 0.34,
    z = -0.42;
  part("stone", [x, 0.42, z], [0.65, 0.48, 0.74], 2);
  part("stone", [x, 0.68, z], [0.67, 0.5, 0.76], 2, "sphere");
  part("dark", [x, 0.52, z + 0.385], [0.34, 0.28, 0.018], 3, "window-shadow");
  for (let i = 0; i < (detailed ? 9 : 5); i++) {
    const angle = (i * Math.PI) / (detailed ? 8 : 4);
    part(
      "stone",
      [x + DMath.cos(angle) * 0.205, 0.48 + DMath.sin(angle) * 0.2, z + 0.4],
      [0.085, 0.085, 0.055],
      3,
      "box",
      [0, 0, angle]
    );
  }
  part("stone", [x, 0.355, z + 0.405], [0.43, 0.06, 0.12], 2);
  part("stone", [x, 1.02, z - 0.2], [0.22, 0.92, 0.23], 2);
  part("stone", [x, 1.49, z - 0.2], [0.27, 0.05, 0.28], 3);
  part("dark", [x, 1.52, z - 0.2], [0.16, 0.009, 0.17], 3, "window-shadow");
  const tableX = -0.55,
    tableZ = depth / 2 + 0.32;
  addBakeryDisplayTable(part, tableX, tableZ, detailed);
  for (let i = 0; i < 6; i++)
    withBuildingStock(part, "bread", i)(
      "bread",
      [tableX + (i % 2) * 0.13 - 0.065, 0.580, tableZ + Math.floor(i / 2) * 0.19 - 0.19],
      [0.12, 0.07, 0.18],
      3,
      "sphere",
      undefined
    );
  for (const [slot, bagZ] of [depth / 2 - 0.18, depth / 2 - 0.51].entries())
    addRomanStockBag(withBuildingStock(part, "flour", slot, "input"), -width / 2 - 0.19, bagZ, detailed);
  addBakeryProps(part, width, depth, detailed, z, tableX, tableZ);
  addPositionedRomanWareStock(part, "water", 0, "input", [-width / 2 - 0.22, 0.18, depth / 2 - 0.85], detailed);
  part("wood", [x + 0.17, 0.74, z + 0.28], [0.022, 0.035, 0.38], 3, "box", [0.2, 0, 0]);
};
const addSmeltingYard = (part: AddPart, width: number, depth: number, detailed: boolean) => {
  addSmelterProps(part, width, depth, detailed);
  const x = width / 2 + 0.32,
    z = -0.22;
  part("stone", [x, 0.23, z], [0.69, 0.1, 0.73], 2, "bevel-box");
  part("stone", [x, 0.54, z], [0.62, 0.54, 0.65], 2, "bevel-box");
  part("stone", [x, 0.88, z - 0.07], [0.44, 0.19, 0.48], 2, "bevel-box");
  part("stone", [x, 1.37, z - 0.08], [0.33, 0.9, 0.35], 2);
  part("stone", [x, 1.85, z - 0.08], [0.42, 0.06, 0.44], 3, "bevel-box");
  part("dark", [x, 1.885, z - 0.08], [0.24, 0.014, 0.25], 3, "window-shadow");
  // Deep dark fire chamber, ringed with individually fitted arch stones.
  part("dark", [x, 0.54, z + 0.328], [0.32, 0.3, 0.018], 3, "window-shadow");
  for (let i = 0; i < (detailed ? 9 : 7); i++) {
    const angle = (i * Math.PI) / (detailed ? 8 : 6);
    part(
      "stone",
      [x + DMath.cos(angle) * 0.21, 0.51 + DMath.sin(angle) * 0.19, z + 0.35],
      [detailed ? 0.085 : 0.105, 0.08, 0.055],
      3,
      "bevel-box",
      [0, 0, angle]
    );
  }
  for (const side of [-1, 1])
    part("stone", [x + side * 0.22, 0.45, z + 0.35], [0.09, 0.15, 0.07], 3);
  part("stone", [x, 0.36, z + 0.4], [0.53, 0.06, 0.16], 2, "bevel-box");
  part("iron", [x, 0.38, z + 0.48], [0.15, 0.045, 0.25], 3);
  part("stone", [x, 0.26, z + 0.64], [0.25, 0.16, 0.27], 2);
  part("iron", [x, 0.35, z + 0.65], [0.2, 0.03, 0.23], 3);
  if (detailed) {
    for (const y of [0.32, 0.79]) part("iron", [x + 0.318, y, z], [0.015, 0.018, 0.58], 3);
    for (let row = 0; row < 4; row++)
      part("stone", [x + 0.175, 0.98 + row * 0.08, z - 0.08], [0.015, 0.012, 0.34], 3);
    for (let i = 0; i < 4; i++)
      part("dark", [x - 0.11 + i * 0.075, 0.402, z + 0.25], [0.055, 0.04, 0.055], 3, "sphere");
  }
  addRomanStockBag(withBuildingStock(part, "ironOre", 0, "input"), -width / 2 - 0.25, 0.12, detailed, "ore");
  addRomanStockBag(withBuildingStock(part, "coal", 0, "input"), -width / 2 - 0.25, -0.22, detailed, "coal");
  // A compact supported cooling tray holds all six ingots beside the input bay.
  part("wood", [-width / 2 - 0.25, 0.2, depth / 2 - 0.23], [0.44, 0.04, 0.48], 3);
  for (let i = 0; i < 6; i++)
    withBuildingStock(part, "iron", i)("steel",
      [-width / 2 - 0.34 + (i % 2) * 0.18, 0.258 + Math.floor(i / 2) * 0.076, depth / 2 - 0.23],
      [0.14, 0.075, 0.29], 3, "bevel-box");
};
const addToolForge = (part: AddPart, width: number, depth: number, detailed: boolean) => {
  addMetalworksProps(part, width, depth, detailed);
  const x = width / 2 + 0.34,
    z = 0.02;
  sideRoof(part, x, z, 0.75, 0.92);
  const anvilX = x + 0.02,
    anvilZ = z + 0.4;
  // The horn runs across the workshop, giving a readable side silhouette from the front.
  part(
    "steel",
    [anvilX + 0.04, 0.305, anvilZ],
    [0.6, 0.26, 0.24],
    3,
    "anvil",
    undefined,
    [0.52, 0.6, 0.68]
  );
  part("dark", [anvilX - 0.14, 0.43, anvilZ + 0.035], [0.029, 0.004, 0.028], 3);
  addRomanStockBag(withBuildingStock(part, "coal", 0, "input"), -width / 2 - 0.24, 0, detailed, "coal");
  part("wood", [-width / 2 - 0.22, 0.2, -depth * 0.2], [0.35, 0.04, 0.34], 3);
  for (let i = 0; i < (detailed ? 3 : 2); i++)
    withBuildingStock(part, "iron", i, "input")(
      "steel",
      [-width / 2 - 0.31 + i * 0.09, 0.255, -depth * 0.2],
      [0.07, 0.07, 0.25],
      3,
      "bevel-box"
    );
  workTable(part, -width / 2 - 0.23, depth / 2 - 0.22, 0.43, 0.46);
  for (let i = 0; i < 6; i++) {
    const toolZ = depth / 2 - 0.36 + (i % 3) * 0.14;
    withBuildingStock(part, "axe", i, "output", PRODUCTION_RULES[25]!.outputs)("wood", [-width / 2 - 0.23, 0.704 + Math.floor(i / 3) * 0.018, toolZ], [0.23, 0.018, 0.025], 3);
    withBuildingStock(part, "axe", i, "output", PRODUCTION_RULES[25]!.outputs)("steel", [-width / 2 - 0.1, 0.708 + Math.floor(i / 3) * 0.018, toolZ], [0.06, 0.028, 0.09], 3);
  }
  // Recessed forge opening, bounded by masonry rather than fire painted on a solid block.
  for (const side of [-1, 1]) part("stone", [x + side * 0.185, 0.49, -0.51], [0.08, 0.62, 0.35], 2);
  part("stone", [x, 0.325, -0.51], [0.29, 0.29, 0.35], 2);
  part("stone", [x, 0.705, -0.51], [0.29, 0.19, 0.35], 2);
  part("stone", [x, 0.54, -0.67], [0.29, 0.14, 0.035], 2);
  part("dark", [x, 0.54, -0.647], [0.29, 0.14, 0.012], 3, "window-shadow");
  part("stone", [x, 1.08, -0.57], [0.19, 0.75, 0.18], 2);
  part("dark", [x, 1.465, -0.57], [0.11, 0.01, 0.1], 3, "window-shadow");
};

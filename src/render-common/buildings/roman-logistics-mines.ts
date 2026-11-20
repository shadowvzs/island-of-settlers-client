import { DMath } from "../../shared/math/deterministic-math";
import { withBuildingStock } from "./building-stock-parts";
import {
  romanBarrel,
  romanCanopy,
  type RomanDesignContext,
  romanRoom} from "./roman-design-kit";
import { addPositionedRomanWareStock } from "./roman-stock-layout";
import { addRomanStockBag, type RomanStockBagContents } from "./roman-workshop-stock";
export { addRomanHarbor } from "./roman-harbor";

/** Sorted sack contents and stocked ware of a mine (13 gold, 12 iron, otherwise coal). */
const getMineBagContents = (id: number): RomanStockBagContents => {
  if (id === 13) return "gold";
  return id === 12 ? "ore" : "coal";
};

const getMineStockWare = (id: number) => {
  if (id === 13) return "goldOre";
  return id === 12 ? "ironOre" : "coal";
};

export const addRomanStorehouse = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  romanRoom(context, -0.32, -0.05, 1.7, 1.65, 1.62, -0.32);
  romanCanopy(context, 1.03, -0.13, 0.94, 1.6, 1.0);
  for (let i = 0; i < 4; i++) {
    const x = 0.81 + (i % 2) * 0.4,
      z = -0.47 + Math.floor(i / 2) * 0.5;
    part("wood", [x, 0.4, z], [0.35, 0.44, 0.38], 3);
    for (const y of [0.24, 0.55]) part("iron", [x, y, z + 0.195], [0.34, 0.023, 0.018], 3);
  }
  part("stone", [-0.32, 1.41, 0.795], [1.32, 0.1, 0.23], 2);
  for (let i = 0; i < 5; i++) part("dark", [-0.85 + i * 0.26, 1.6, 0.8], [0.12, 0.22, 0.012], 3);
  romanBarrel(part, -1.46, 0.31, detailed);
};

export const addRomanShipyard = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  romanRoom(context, -0.72, -0.25, 0.96, 1.46, 1.21, -0.72);
  romanCanopy(context, 0.64, -0.26, 1.48, 1.54, 1.12);
  // Keel rests on trestles. Curved paired ribs make an unfinished hull, not a timber box.
  for (const z of [-0.76, 0.23]) {
    part("wood", [0.66, 0.45, z], [0.98, 0.07, 0.08], 2);
    for (const side of [-1, 1]) part("wood", [0.66 + side * 0.36, 0.3, z], [0.07, 0.24, 0.08], 2);
  }
  part("wood", [0.66, 0.52, -0.27], [0.055, 0.09, 1.36], 3);
  for (let i = 0; i < (detailed ? 9 : 5); i++) {
    const z = -0.86 + i * (detailed ? 0.15 : 0.3);
    const spread = 0.35 * DMath.sin(((i + 1) * Math.PI) / (detailed ? 10 : 6));
    for (const side of [-1, 1]) {
      part("wood", [0.66 + (side * spread) / 2, 0.58, z], [spread, 0.045, 0.055], 3, "box", [
        0,
        0,
        side * 0.4
      ]);
      part("wood", [0.66 + side * spread, 0.72, z], [0.035, 0.28, 0.06], 3, "box", [
        0,
        0,
        -side * 0.24
      ]);
    }
  }
  for (let i = 0; i < 6; i++) withBuildingStock(part, "planks", i, "input")("wood", [1.62, 0.2 + i * 0.045, -0.12], [0.28, 0.045, 1.12], 3);
  // Finished boats lie crosswise in two columns, with a full tray-depth gap between rows.
  for (let slot = 0; slot < 6; slot++)
    addPositionedRomanWareStock(part, "boat", slot, "output",
      [-0.7 + (slot % 2) * 0.85, 0.18, -1.34 - Math.floor(slot / 2) * 0.49], detailed, Math.PI / 2);
};
export const addRomanMine = (context: RomanDesignContext, id: number) => {
  const { detailed, part } = context;
  addRomanMineAdit(context);
  for (const x of [-0.4, 0.07]) part("iron", [x, 0.195, 0.04], [0.025, 0.025, 0.8], 2);
  romanCanopy(context, 0.88, -0.24, 0.75, 0.78, id === 13 ? 1.3 : 0.81);
  if (id === 10) {
    part("wood", [0.88, 0.205, 0.53], [0.75, 0.05, 0.55], 3);
    for (let i = 0; i < 6; i++)
      withBuildingStock(part, "stone", i)(
        "stone",
        [0.63 + (i % 3) * 0.23, 0.32, 0.37 + Math.floor(i / 3) * 0.25],
        [0.21, 0.23, 0.22],
        3,
        "rock"
      );
  } else {
    const contents = getMineBagContents(id);
    const stockWare = getMineStockWare(id);
    // Six open sacks under the sorting canopy, clear of its posts and main doorway.
    for (let i = 0; i < 6; i++)
      addRomanStockBag(
        withBuildingStock(part, stockWare, i),
        0.65 + (i % 3) * 0.23,
        -0.4 + Math.floor(i / 3) * 0.33,
        detailed,
        contents,
        0.75
      );
  }
  const foodPart: typeof part = (surface, position, size, stage, shape, rotation, tint) =>
    part(surface, position, size, stage, shape, rotation, tint,
      { ware: "fish", wares: ["fish", "meat", "bread"], slot: 0, kind: "input" });
  if (detailed) addRomanStockBag(foodPart, -1.02, 0.22, true);
  else foodPart("paint", [-1.02, 0.375, 0.22], [0.29, 0.39, 0.26], 3, "sack", undefined, [0.43, 0.34, 0.22]);
  if (id === 10) {
    part("stone", [0.88, 0.56, -0.24], [0.49, 0.75, 0.44], 3, "bevel-box");
    part("wood", [0.85, 0.93, -0.01], [0.025, 0.4, 0.025], 3, "box", [0, 0, 0.65]);
    part("steel", [0.73, 1.07, -0.01], [0.25, 0.03, 0.04], 3);
  } else {
    part("wood", [0.88, 0.48, -0.24], [0.56, 0.6, 0.06], 2);
    part("iron", [0.88, 0.64, -0.2], [0.36, 0.18, 0.18], 3);
  }
};

/** Barrel-vaulted granite adit: a hollow tunnel with a fitted arched timber door. */
const addRomanMineAdit = ({ detailed, part, parts }: RomanDesignContext) => {
  const x = -0.17;
  const spring = 0.81;
  const depth = 0.96;
  for (const side of [-1, 1]) {
    part("stone", [x + side * 0.53, 0.495, -0.14], [0.11, 0.63, depth], 1);
    part("stone", [x + side * 0.4075, 0.495, 0.34], [0.355, 0.63, 0.11], 1);
    part("stone", [x + side * 0.27, 0.495, 0.38], [0.075, 0.63, 0.13], 2);
  }
  part("dark", [x, 0.192, -0.14], [1.04, 0.024, 0.85], 0);
  // A solid rounded rear cap seals the tunnel; its lower edge meets the interior floor.
  part("stone", [x, spring, -0.575], [1.03, 0.09, 1.03], 1, "cylinder", [Math.PI / 2, 0, 0]);
  part("stone", [x, 0.425, -0.575], [1.08, 0.49, 0.11], 1);
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 6;
    part("stone", [x, spring, -0.14], [1.17, depth, 1.17], 1, "stone-arc", [Math.PI / 2, 0, angle]);
    // Thick radial voussoirs meet the timber door's exact 0.23 radius.
    part("stone", [x, spring, 0.36], [1.17, 0.16, 1.17], 2, "stone-arc", [Math.PI / 2, 0, angle]);
    parts[parts.length - 1]!.innerRadius = 0.23 / 1.17;
  }
  // Wall-mounted miner's lamp and its iron protective cage; no loose hanging boards.
  part("iron", [0.205, 0.79, 0.4], [0.10, 0.14, 0.055], 3);
  part("dark", [0.205, 0.79, 0.431], [0.074, 0.1, 0.008], 3, "window-shadow");
  if (detailed) {
    for (const offset of [-0.025, 0.025])
      part("iron", [0.205 + offset, 0.79, 0.45], [0.008, 0.12, 0.017], 3);
    for (const y of [0.735, 0.845]) part("iron", [0.205, y, 0.45], [0.09, 0.01, 0.03], 3);
  }
};
export const addRomanCharburner = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  romanRoom(context, -0.64, -0.16, 1.05, 1.08, 0.92, -0.64);
  // Earth covered charcoal clamp and a vent; smoke anchor is on the clamp itself.
  part("bark", [0.84, 0.42, -0.05], [1.25, 0.48, 1.07], 2, "sphere");
  part(
    "paint",
    [0.84, 0.52, -0.05],
    [1.16, 0.65, 1.02],
    3,
    "sphere",
    undefined,
    [0.29, 0.25, 0.17]
  );
  part("stone", [0.84, 0.99, -0.05], [0.12, 0.36, 0.12], 3);
  part("dark", [0.84, 1.175, -0.05], [0.09, 0.012, 0.09], 3, "window-shadow");
  for (let i = 0; i < 6; i++)
    withBuildingStock(part, "coal", i)(
      "dark",
      [0.62 + (i % 3) * 0.18, 0.25, 0.74 + Math.floor(i / 3) * 0.17],
      [0.17, 0.14, 0.17],
      3,
      "rock"
    );
  // Softwood logs are the visible fuel supply; covering the clamp needs no additional wares.
  for (let i = 0; i < 6; i++) {
    const x = -1.4 + (i % 3) * 0.15;
    const y = 0.255 + Math.floor(i / 3) * 0.13;
    withBuildingStock(part, "logs", i, "input")("bark", [x, y, -0.17], [0.14, 0.74, 0.14], 3, "cylinder", [Math.PI / 2, 0, 0]);
    withBuildingStock(part, "logs", i, "input")("endgrain", [x, y, 0.205], [0.12, 0.012, 0.12], 3, "cylinder", [Math.PI / 2, 0, 0]);
  }
  for (let i = 0; i < (detailed ? 5 : 3); i++) {
    const x = 0.6 + i * (detailed ? 0.12 : 0.24);
    part("bark", [x, 0.32, 0.32], [0.1, 0.46, 0.1], 3, "cylinder", [Math.PI / 2, 0, 0]);
    part("endgrain", [x, 0.32, 0.555], [0.086, 0.012, 0.086], 3, "cylinder", [Math.PI / 2, 0, 0]);
  }
};

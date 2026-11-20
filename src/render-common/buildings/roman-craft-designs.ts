import { DMath } from "../../shared/math/deterministic-math";
import { ARMORY_STOCK_WARES } from "../../shared/settlement/armory-orders";
import { withBuildingStock } from "./building-stock-parts";
import { addRomanBrewingKettle } from "./roman-brewery-detail";
import {
  romanBarrel,
  romanBench,
  romanCanopy,
  romanChimney,
  type RomanDesignContext,
  romanRoom} from "./roman-design-kit";
import { addHideFrameTimbers, addLacedHide, addLobedHide, type HideFrame } from "./roman-hide-frame";
import { addRomanLeatherArmorWorkshop } from "./roman-leather-armor";
import type { AddPart } from "./roman-resource-workshops";
import { addRomanStockBag } from "./roman-workshop-stock";

const addSixBars = (context: RomanDesignContext, x: number, z: number, gold = false) => {
  const { part } = context;
  part("wood", [x, 0.21, z], [0.48, 0.06, 0.48], 3);
  for (let i = 0; i < 6; i++)
    withBuildingStock(part, gold ? "goldOre" : "iron", i, "input")(
      gold ? "gold" : "steel",
      [x - 0.13 + (i % 3) * 0.13, 0.265 + Math.floor(i / 3) * 0.07, z],
      [0.11, 0.065, 0.29],
      3,
      "bevel-box"
    );
};
const addHearth = (
  context: RomanDesignContext, x: number, z: number, tall: boolean, chimneySetback = 0.18
) => {
  const { part } = context;
  const rearExtension = chimneySetback - 0.18;
  part("stone", [x, 0.44, z - rearExtension / 2],
    [0.56, 0.52, 0.55 + rearExtension], 2, "bevel-box");
  part("dark", [x, 0.47, z + 0.283], [0.32, 0.25, 0.02], 3, "window-shadow");
  for (const side of [-1, 1])
    part("stone", [x + side * 0.205, 0.49, z + 0.3], [0.08, 0.28, 0.07], 3);
  part("stone", [x, 0.64, z + 0.3], [0.45, 0.065, 0.07], 3);
  part("stone", [x, 0.315, z + 0.34], [0.5, 0.08, 0.15], 2);
  romanChimney(part, x, z - chimneySetback, tall ? 2.03 : 1.48);
};
export const addRomanArmory = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  romanRoom(context, -0.3, 0, 1.4, 1.38, 1.03, -0.3);
  romanCanopy(context, 0.94, -0.1, 1.04, 1.25, 1.27);
  addHearth(context, 0.93, -0.35, true);
  // The heel-side anvil foot is off-centre beneath its projecting horn. A wider log is
  // centred under that foot, with the cut top touching it; the working face stays unchanged.
  part("bark", [1.07, 0.405, 0.54], [0.43, 0.45, 0.43], 2, "cylinder");
  part("steel", [1.15, 0.75, 0.54], [0.53, 0.25, 0.23], 3, "anvil");
  addSixBars(context, -1.26, -0.22);
  addRomanStockBag(withBuildingStock(part, "coal", 0, "input"), -1.25, 0.31, detailed, "coal");
  // Six output places: three gladii and three convex shields on their own stand.
  for (const x of [-1.16, -0.67]) part("wood", [x, 0.59, 1.0], [0.055, 0.82, 0.065], 2);
  part("wood", [-0.915, 0.79, 1.0], [0.56, 0.06, 0.065], 3);
  part("wood", [-0.915, 0.29, 1.0], [0.56, 0.12, 0.32], 3);
  for (let i = 0; i < 3; i++) {
    const x = -1.08 + i * 0.16;
    const swordPart: typeof part = (surface, position, size, stage, shape, rotation, tint) =>
      part(surface, position, size, stage, shape, rotation, tint,
        { ware: "sword", wares: ARMORY_STOCK_WARES, slot: i * 2, kind: "output" });
    const shieldPart: typeof part = (surface, position, size, stage, shape, rotation, tint) =>
      part(surface, position, size, stage, shape, rotation, tint,
        { ware: "shield", wares: ARMORY_STOCK_WARES, slot: i * 2 + 1, kind: "output" });
    swordPart("steel", [x, 0.56, 1.03], [0.045, 0.42, 0.025], 3);
    swordPart("gold", [x, 0.8, 1.03], [0.12, 0.028, 0.03], 3);
    swordPart("wood", [x, 0.86, 1.03], [0.024, 0.12, 0.03], 3);
    shieldPart("paint", [x, 0.49, 1.13], [0.145, 0.3, 0.06], 3, "sphere", undefined, [0.44, 0.11, 0.075]);
    shieldPart("steel", [x, 0.49, 1.166], [0.045, 0.06, 0.025], 3, "sphere");
  }
};
export const addRomanMint = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  // One readable room, with stamping and coin stocks sharing a small right-side yard.
  romanRoom(context, -0.22, -0.15, 1.35, 1.1, 1.3, -0.22);
  addHearth(context, 0.75, -0.18, false);
  romanBench(part, 0.76, 0.5, 0.48, 0.46);
  part("steel", [0.76, 0.74, 0.44], [0.28, 0.12, 0.25], 3);
  // The coherent animated hammer is owned by createIndustryMechanism, not a second loose prop.
  addMintBalance(context);
  addRomanStockBag(withBuildingStock(part, "goldOre", 0, "input"), 0.60, -0.76, detailed, "gold");
  addRomanStockBag(withBuildingStock(part, "coal", 0, "input"), 0.94, -0.76, detailed, "coal");
  // Six small coin piles sit along the front of the die bench, leaving the door clear.
  for (let i = 0; i < 6; i++)
    withBuildingStock(part, "coins", i)(
      "gold", [0.60 + (i % 3) * 0.13, 0.702 + Math.floor(i / 3) * 0.055, 0.66],
      [0.1, 0.055, 0.1], 3, "cylinder"
    );
};
/** A compact balance beside the coin dies distinguishes the mint from a forge. */
const addMintBalance = ({ detailed, part }: RomanDesignContext) => {
  if (!detailed) return;
  const x = -0.82,
    z = 0.66;
  romanBench(part, x, z, 0.46, 0.28);
  part("steel", [x, 0.716, z], [0.16, 0.07, 0.14], 3, "bevel-box");
  part("steel", [x, 0.87, z], [0.023, 0.25, 0.023], 3, "cylinder");
  part("steel", [x, 1.0, z], [0.36, 0.018, 0.022], 3);
  for (const side of [-1, 1]) {
    const panX = x + side * 0.155;
    part("iron", [panX, 0.926, z], [0.01, 0.14, 0.01], 3, "cord");
    part("steel", [panX, 0.851, z], [0.13, 0.018, 0.13], 3, "cylinder");
    part("steel", [panX, 0.865, z], [0.14, 0.026, 0.14], 3, "ring");
    part("gold", [panX, 0.868, z + 0.03], [0.047, 0.014, 0.047], 3, "cylinder");
  }
};
export const addRomanBrewery = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  romanRoom(context, 0.1, -0.15, 1.05, 1.0, 1.44, 0.1);
  romanRoom(context, 0.78, -0.44, 0.5, 0.6, 0.93);
  // The rear flue clears the kettle and lid, with a continuous masonry base underneath.
  addHearth(context, 0.81, 0.35, false, 0.45);
  addRomanBrewingKettle(context);
  addRomanStockBag(withBuildingStock(part, "grain", 0, "input"), 0.10, -0.91, detailed);
  // A compact side cooperage bay: all six output places fit beside the wall.
  for (let i = 0; i < 6; i++) {
    const x = -0.62 - (i % 2) * 0.33;
    const z = -0.58 + Math.floor(i / 2) * 0.33;
    const outputPart = withBuildingStock(part, "beer", i);
    if (detailed) addBreweryOutputBarrel({ ...context, part: outputPart }, x, z);
    else romanBarrel(outputPart, x, z, false, 0.145);
  }
};
/** Tapered coopered beer casks: the iron hoops sit on the curved stave body. */
const addBreweryOutputBarrel = ({ part, parts }: RomanDesignContext, x: number, z: number) => {
  part("wood", [x, 0.25, z], [0.24, 0.14, 0.24], 3, "cylinder");
  parts[parts.length - 1]!.topScale = [1.18, 1, 1.18];
  part("wood", [x, 0.37, z], [0.283, 0.1, 0.283], 3, "cylinder");
  part("wood", [x, 0.48, z], [0.283, 0.12, 0.283], 3, "cylinder");
  parts[parts.length - 1]!.topScale = [0.848, 1, 0.848];
  part("endgrain", [x, 0.548, z], [0.242, 0.018, 0.242], 3, "cylinder");
  part("wood", [x + 0.04, 0.562, z], [0.036, 0.017, 0.036], 3, "cylinder");
  for (const [y, diameter] of [[0.23, 0.258], [0.37, 0.292], [0.51, 0.27]] as const)
    part("iron", [x, y, z], [diameter, 0.024, diameter], 3, "cylinder");
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 2;
    // Short seam segments follow the tapered staves instead of floating straight slats.
    for (const [y, radius, tilt] of [[0.25, 0.132, 0.15], [0.37, 0.144, 0], [0.48, 0.132, -0.15]] as const)
      part(
        "dark",
        [x + DMath.cos(angle) * radius, y, z + DMath.sin(angle) * radius],
        [0.003, y === 0.37 ? 0.1 : 0.14, 0.003],
        3,
        "box",
        [DMath.sin(angle) * tilt, 0, -DMath.cos(angle) * tilt]
      );
  }
};
/** Rollback switch: "lobed" restores the original five-lobe hide with horizontal ties. */
const STRETCHED_HIDE_STYLE = "laced" as "laced" | "lobed";

/** The Tanner's frame holds its next input hide (shown only while stocked); the Skinner's is fixed. */
const addRomanStretchedHide = (context: RomanDesignContext, frame: HideFrame, id: number) => {
  const { detailed, part } = context;
  const hidePart: AddPart = id !== 8 ? part : (surface, position, size, stage, shape, rotation, tint) =>
    part(surface, position, size, stage, shape, rotation, tint,
      { kind: "input", presentation: "hanging", slot: 0, ware: "hides" });
  addHideFrameTimbers(part, frame);
  if (STRETCHED_HIDE_STYLE === "lobed") addLobedHide(part, hidePart, frame);
  else addLacedHide(hidePart, frame, detailed);
};
export const addRomanLeatherWorkshop = (context: RomanDesignContext, id: number) => {
  const { detailed, part } = context;
  const entry = id === 8 ? 0.32 : -0.28;
  romanRoom(
    context,
    entry,
    -0.06,
    id === 8 ? 1.65 : 1.4,
    id === 3 ? 1.1 : 1.4,
    id === 15 ? 1.28 : 0.98,
    entry
  );
  if (id === 15) {
    addRomanLeatherArmorWorkshop(context);
    return;
  }
  const x = id === 8 ? -1.03 : 0.95;
  if (id === 8) {
    for (const z of [-0.43, 0.24]) {
      part("wood", [x, 0.22, z], [0.6, 0.08, 0.6], 2, "cylinder");
      part("wood", [x, 0.4, z], [0.6, 0.36, 0.6], 3, "ring");
      part("tanning-liquid", [x, .49, z], [.45, .016, .45], 3, "vat-liquid");
    }
  }
  addRomanStretchedHide(context, { x, z: 0.81 }, id);
  const tablePart:typeof part=(...args)=>{
    part(...args);
    if(id===8)context.parts.at(-1)!.workyardAssembly="tannery-table";
  };
  romanBench(tablePart, id === 8 ? 1.35 : -1.21, 0.27, 0.5, 0.71);
  const tableX = id === 8 ? 1.35 : -1.21;
  for (let i = 0; i < 6; i++)
    tablePart(
      "paint",
      [tableX, 0.697 + i * 0.018, 0.27],
      [0.38, 0.025, 0.52],
      3,
      "sphere",
      undefined,
      id === 15 ? [0.26, 0.14, 0.07] : [0.5, 0.3, 0.15],
      { ware: id === 8 ? "leather" : "hides", slot: i, kind: "output",
        handlingEdge: id === 8 ? "outward-x" : undefined }
    );
  if (detailed) {
    tablePart("steel", [tableX, 0.693, 0.34], [0.02, 0.008, 0.18], 3);
    tablePart("wood", [tableX, 0.697, 0.47], [0.035, 0.015, 0.08], 3);
    if (id === 3) {
      // Two-hand skin scraper rests on the hide pile, rather than looking like a forge tool.
      part("steel", [tableX, 0.697, 0.1], [0.15, 0.016, 0.04], 3, "bevel-box");
      for (const side of [-1, 1])
        part("wood", [tableX + side * 0.085, 0.701, 0.1], [0.025, 0.024, 0.065], 3);
    }
  }
};

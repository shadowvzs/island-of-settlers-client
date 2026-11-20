import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";
import {
  addRomanStockBag,
  addRomanWheatBales,
  type RomanStockBagContents
} from "../buildings/roman-workshop-stock";
import { IRON_INGOT_POSITION, IRON_INGOT_SIZE } from "./iron-ingot";
import { fitTimberRecipeEnvelope } from "./timber-recipe-envelope";
import { addAdvancedMaterialWare } from "./ware-advanced-material-recipe";
import { addArmourCuirass } from "./ware-armour-recipe";
import { CARGO_BOX_WARE, resolveWareId, TOOL_WARES } from "./ware-catalog";
import { addGoldCoins } from "./ware-coin-recipe";
import {
  BEER_VISUAL_SCALE,
  FLOUR_BAG_SCALE,
  LOG_WARE_SCALE,
  PIG_VISUAL_SCALE,
  STONE_WARE_BLOCK
} from "./ware-dimensions";
import { addDrinkWare } from "./ware-drink-recipe";
import { addBoneInMeatHaunch } from "./ware-meat-recipe";
import { addClothBolt, addFlaxBundle } from "./ware-textile-recipe";
import { addTimberLog, addTimberPlanks } from "./ware-timber-recipe";
import { addWareTool } from "./ware-tool-recipe";

/** Standalone stock/cargo recipes use the same original surfaces and forms as the buildings. */
const getWareBagContents = (id: ReturnType<typeof resolveWareId>): RomanStockBagContents => {
  if (id === "coal") return "coal";
  if (id === "goldOre") return "gold";
  return id === "ironOre" ? "ore" : "flour";
};

/** A closed, planked cargo crate with dark corner battens (High) carried on the shoulder. */
const addCargoCrate = (part: AddPart, detailed: boolean) => {
  part("wood", [0, 0, 0], [.34, .26, .3], 3, "bevel-box");
  if (!detailed) return;
  for (const x of [-.165, .165]) for (const z of [-.14, .14])
    part("paint", [x, 0, z], [.03, .27, .03], 3, "box", undefined, [.24, .16, .1]);
  part("paint", [0, .131, 0], [.3, .004, .035], 3, "box", undefined, [.24, .16, .1]);
};
export const createWareRecipe = (ware: string, detailed: boolean, compactStock = false, stockDensity = 1) => {
  const id = resolveWareId(ware);
  const parts: BuildingPart[] = [];
  const flaxSegments = detailed ? 4 : 3;
  const part: AddPart = (surface, position, size, stage, shape = "box", rotation, tint) => {
    let dimensions = 1;
    if (id === "pig") dimensions = PIG_VISUAL_SCALE;
    else if (id === "beer") dimensions = BEER_VISUAL_SCALE;
    parts.push({
      position: position.map(value => value * dimensions) as typeof position,
      radialSegments: id === "flax" ? flaxSegments : undefined,
      rotation, shape,
      size: size.map(value => value * dimensions) as typeof size,
      stage: stage ?? 3, surface, tint
    });
    if (id === "basalt" && shape === "cylinder") parts[parts.length - 1]!.radialSegments = 6;
    if (id === "coins") parts[parts.length - 1]!.radialSegments = detailed ? 32 : 16;
  };
  if (ware === CARGO_BOX_WARE) { addCargoCrate(part, detailed); return { id, parts, tool: false }; }
  if (addAdvancedMaterialWare(part, id, detailed, compactStock)) {
    fitTimberRecipeEnvelope(parts, id!);
    return { id, parts, tool: false };
  }
  if (id && TOOL_WARES.has(id)) addWareTool(part, id, detailed, compactStock);
  else if (id === "logs") {
    addTimberLog((surface, position, size, stage, shape, rotation, tint) =>
      part(surface, position.map(value => value * LOG_WARE_SCALE) as typeof position,
        size.map(value => value * LOG_WARE_SCALE) as typeof size, stage, shape, rotation, tint), { detailed });
  } else if (id === "planks") {
    addTimberPlanks(compactStock && !detailed ? (surface, position, size, stage, shape, rotation, tint) => {
      if (surface === "wood" && Math.abs(position[1]) > .001) return;
      part(surface, position, size, stage, shape, rotation, tint);
    } : part, { detailed, tied: false });
  } else if (["coal", "ironOre", "goldOre", "flour"].includes(id ?? "")) {
    const contents = getWareBagContents(id);
    const bag: AddPart = (surface, position, size, stage, shape, rotation, tint) => {
      if (id === "flour") {
        part(
          surface,
          [position[0] * FLOUR_BAG_SCALE, (position[1] - 0.375) * FLOUR_BAG_SCALE,
            (position[2] - 0.035) * FLOUR_BAG_SCALE],
          size.map(value => value * FLOUR_BAG_SCALE) as typeof size,
          stage,
          shape,
          rotation,
          tint
        );
        return;
      }
      part(
        surface,
        [position[0] * 1.6, position[1] - 0.35, position[2] * 1.1 - 0.035],
        [size[0] * 1.6, size[1], size[2] * 1.1],
        stage,
        shape,
        rotation,
        tint
      );
    };
    addRomanStockBag(bag, 0, 0, detailed, contents);
  } else if (id === "grain") {
    const bundle: AddPart = (surface, position, size, stage, shape, rotation, tint) =>
      part(
        surface,
        [position[0] + 0.23, position[1] - 0.26, position[2] - 0.05],
        size,
        stage,
        shape,
        rotation,
        tint
      );
    addRomanWheatBales(bundle, 0, 0, detailed, 0, compactStock ? .2 * stockDensity : 1);
  } else if (id === "flax") {
    addFlaxBundle(part, detailed, compactStock);
  } else if (id === "cloth") {
    addClothBolt(part, compactStock);
  } else addCompactWare(part, id, detailed, compactStock);
  return { id, parts, tool: Boolean(id && TOOL_WARES.has(id)) };
};

const addCompactWare = (part: AddPart, id: ReturnType<typeof resolveWareId>, detailed: boolean, compactStock = false, _stockDensity = 1) => {
  // Building stock piles use the lean drink wares (six per yard); icons and carried wares the full ones.
  if (addDrinkWare(part, id ?? "", detailed && !compactStock)) return;
  if (id === "fish") {
    part("fish", [0, 0, 0], [0.17, 0.14, 0.47], 3, "fish", [0, Math.PI / 2, 0]);
    for (const side of [-1, 1])
      part("dark", [-0.185, 0.015, side * 0.04], [0.018, 0.015, 0.013], 3, "sphere");
    return;
  }
  if (id === "meat") {
    addBoneInMeatHaunch(part, [0, 0, 0]);
    return;
  }
  if (["beer", "water"].includes(id ?? "")) {
    addWareVessel(part, id === "water", detailed);
    return;
  }
  if (id === "stone") {
    const { centreY, edge } = STONE_WARE_BLOCK;
    part("cut-stone", [0, centreY, 0], [edge, edge, edge], 3, "stone-block");
    return;
  }
  if (id === "bread") {
    part("bread", [0, 0.015, 0], [0.35, 0.15, 0.21], 3, "sphere");
    if (detailed) addBreadScoring(part);
    return;
  }
  // Gold coins are only coins, no tray (owner, 2026-10-12).
  if (id === "coins") {
    // One unit stays one coin in every presentation, including compact stock.
    addGoldCoins(part);
    return;
  }
  if (id === "armor") {
    addArmourCuirass(part, detailed);
    return;
  }
  // Loose wares travel directly: display trays must never become part of carried cargo.
  if (id === "iron") {
    part("steel", IRON_INGOT_POSITION, IRON_INGOT_SIZE, 3, "iron-ingot");
  } else if (["leather", "hides"].includes(id ?? "")) {
    for (let i = 0; i < 3; i++)
      part("paint", [0, -0.035 + i * 0.035, 0], [0.35, 0.025, 0.22], 3, "sphere", undefined, [0.46, 0.26, 0.13]);
  } else if (id === "pig") {
    part("paint", [0, 0.025, 0], [0.37, 0.21, 0.23], 3, "sphere", undefined, [0.57, 0.39, 0.29]);
    part("paint", [0.18, 0.0, 0], [0.12, 0.13, 0.15], 3, "sphere", undefined, [0.57, 0.39, 0.29]);
    part("paint", [0.245, 0, 0], [0.04, 0.05, 0.1], 3, "sphere", undefined, [0.48, 0.29, 0.21]);
    for (const x of [-0.11, 0.1])
      for (const side of [-1, 1])
        part("dark", [x, -0.062, side * 0.09], [0.045, 0.055, 0.035], 3, "sphere");
  } else if (id === "boat") {
    part("wood", [0, 0, 0], [0.24, 0.12, 0.75], 3, "sphere");
    part("wood", [0, 0.035, 0], [0.1, 0.06, 0.65], 3, "bevel-box");
  } else part("wood", [0, 0.04, 0], [0.32, 0.21, 0.2], 3, "bevel-box");
};

const addWareVessel = (part: AddPart, water: boolean, detailed: boolean) => {
  part("wood", [0, 0, 0], [0.33, 0.25, 0.27], 3, "ring");
  part("wood", [0, -0.118, 0], [0.32, 0.025, 0.26], 3, "cylinder");
  for (const y of [-0.085, 0.085]) part("iron", [0, y, 0], [0.34, 0.018, 0.28], 3, "ring");
  if (water)
    part("paint", [0, 0.08, 0], [0.235, 0.012, 0.19], 3, "cylinder", undefined, [0.1, 0.37, 0.48]);
  else part("endgrain", [0, 0.119, 0], [0.31, 0.02, 0.255], 3, "cylinder");
  if (detailed)
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5;
      part(
        "wood",
        [DMath.sin(angle) * 0.165, 0, DMath.cos(angle) * 0.135],
        [0.009, 0.22, 0.012],
        3,
        "cord"
      );
    }
};

/** Short baked scoring follows the loaf's curved crust rather than floating above it. */
const addBreadScoring = (part: AddPart) => {
  for (const x of [-.1, 0, .1]) {
    for (const z of [-.036, 0, .036]) {
      const surface = Math.sqrt(1 - (x / .175) ** 2 - (z / .105) ** 2);
      const y = .015 + .075 * surface;
      const slope = -.075 * z / (.105 ** 2 * surface);
      part("paint", [x, y - .001, z], [.009, .004, .038], 3, "box",
        [-DMath.atan(slope), 0, 0], [.68, .48, .24]);
    }
  }
};

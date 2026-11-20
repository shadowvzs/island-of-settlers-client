import { DMath } from "../../shared/math/deterministic-math";
import { DRINK_WARES, RAW_DRINK_WARES } from "../../shared/settlement/nation-drinks";
import { withBuildingStock } from "./building-stock-parts";
import { PIG_FEEDING_SURFACE_HEIGHT, PIG_TROUGH_WALL_HEIGHT } from "./pig-feeding-layout";
import {
  romanBarrel,
  romanBench,
  romanCanopy,
  type RomanDesignContext,
  romanFence,
  romanRoom} from "./roman-design-kit";
import { addPositionedRomanWareStock } from "./roman-stock-layout";
import { addRomanWheatBales } from "./roman-workshop-stock";

/** A tall stone barn and attached open threshing bay keep the farm distinct from animal pens. */
export const addRomanFarm = (context: RomanDesignContext) => {
  const { part } = context;
  romanRoom(context, -0.52, -0.08, 1.4, 1.34, 1.34, -0.52, 0.18, false);
  addFarmBarnRoof(context);
  // A solid rear granary wall joins the barn. The forward bay remains genuinely open.
  part("stone", [0.72, 0.67, -0.8], [1.08, 0.98, 0.11], 1);
  part("stone", [1.205, 0.67, -0.54], [0.11, 0.98, 0.52], 1);
  for (const x of [0.24, 1.2]) {
    part("wood", [x, 0.69, 0.68], [0.075, 1.02, 0.075], 2);
    part("wood", [x, 1.13, 0.58], [0.055, 0.28, 0.055], 2, "box", [0.6, 0, 0]);
  }
  part("wood", [0.72, 1.17, 0.68], [1.08, 0.075, 0.08], 2);
  context.roof(0.72, 1.22, -0.03, 1.18, 1.68);
  // A small shuttered loft window is mounted against the stone gable, above the doorway.
  part("dark", [-0.52, 1.81, 0.686], [0.25, 0.22, 0.016], 3, "window-shadow");
  for (const x of [-0.655, -0.385])
    part("wood", [x, 1.81, 0.703], [0.028, 0.25, 0.025], 3);
  for (const y of [1.685, 1.935])
    part("wood", [-0.52, y, 0.703], [0.29, 0.028, 0.025], 3);
  part("wood", [-0.52, 1.81, 0.709], [0.018, 0.22, 0.026], 3);
  // The practical timber entrance frame stays outside the animated leaf and arched aperture.
  for (const x of [-0.86, -0.18])
    part("wood", [x, 0.64, 0.692], [0.055, 0.92, 0.055], 2);
  part("wood", [-0.52, 1.115, 0.692], [0.735, 0.065, 0.06], 2);
  addFarmHarvestBay(context);
  addFarmScythe(context);
};

const addFarmBarnRoof = ({ part }: RomanDesignContext) => {
  const width = 1.62, depth = 1.56, pitch = 0.64, eave = 1.62;
  const rise = DMath.tan(pitch) * width / 2;
  for (const side of [-1, 1]) {
    part("roof", [-0.52 + side * width / 4, eave + rise / 2, -0.08],
      [width / 2 / DMath.cos(pitch), 0.065, depth], 4, "box", [0, 0, -side * pitch]);
    part("stone", [-0.52, eave + rise / 2, -0.08 + side * (depth / 2 - 0.07)],
      [width - 0.1, rise, 0.08], 3, "gable");
  }
  part("roof", [-0.52, eave + rise, -0.08], [0.12, depth + 0.04, 0.12], 4,
    "cylinder", [Math.PI / 2, 0, 0]);
};

// A stable loose pile centered in the open bay, with staggered ends and small independent turns.
const FARM_HARVEST_BUNDLES = [
  [.40, -.33, .12], [.70, -.365, .24], [1.0, -.30, -.19],
  [.43, .36, -.23], [.74, .28, .16], [1.01, .34, -.13]
] as const;

const addFarmHarvestBay = ({ detailed, part }: RomanDesignContext) => {
  // Six independent ground-supported bundles: no upper slot depends on a hidden lower one.
  for (let slot = 0; slot < 6; slot++) {
    const stockPart = withBuildingStock(part, "grain", slot);
    const [x, z, yaw] = FARM_HARVEST_BUNDLES[slot]!;
    const cosine = DMath.cos(yaw), sine = DMath.sin(yaw);
    const bundlePart: typeof part = (surface, position, size, stage, shape, rotation, tint) =>
      stockPart(surface,
        [x + (position[0] + .73) * cosine + (position[2] - .2) * sine, position[1],
          z - (position[0] + .73) * sine + (position[2] - .2) * cosine],
        size, stage, shape, [rotation?.[0] ?? 0, (rotation?.[1] ?? 0) + yaw, rotation?.[2] ?? 0], tint);
    addRomanWheatBales(bundlePart, 1, 0.3, detailed, 0, 0.2);
  }
};

const addFarmScythe = ({ part }: RomanDesignContext) => {
  const lean = 0.18, length = 0.95, x = -1.12, z = 0.69;
  const centerY = 0.18 + DMath.cos(lean) * length / 2;
  part("wood", [x, centerY, z], [0.032, length, 0.032], 3, "cord", [0, 0, lean]);
  const tipX = x - DMath.sin(lean) * length / 2;
  const tipY = centerY + DMath.cos(lean) * length / 2;
  part("steel", [tipX - 0.12, tipY + 0.025, z], [0.48, 0.31, 0.024], 3, "scythe-blade");
  for (const offset of [-0.12, 0.13])
    part("wood", [x - DMath.sin(lean) * offset, centerY + DMath.cos(lean) * offset, z + 0.035],
      [0.028, 0.13, 0.028], 3, "cord", [Math.PI / 2, 0, 0]);
};
/** A low stone sty and compact pen contrast with the stable's tall animal stalls. */
export const addRomanPigFarm = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  const height = 0.94;
  romanRoom(context, -0.42, -0.18, 1.55, 1.3, height, -0.42);
  // Low rear shelter is a working sty rather than a miniature stable arcade.
  part("stone", [0.84, 0.635, -0.8], [0.97, 0.91, 0.1], 1);
  for (const x of [0.39, 1.29]) part("stone", [x, 0.5, -0.44], [0.09, 0.64, 0.72], 1);
  for (const x of [0.39, 1.29]) part("stone", [x, 0.58, -0.04], [0.09, 0.8, 0.1], 1);
  part("roof", [0.84, 1.035, -0.44], [1.08, 0.055, 0.89], 4, "box", [0.12, 0, 0]);
  // Keep shelter and front pen connected; no transverse bars across the shelter opening.
  romanFence(part, 0.84, 0.37, 0.97, 0.9, true);
  // Trough: hollow timber sides around water and fodder, no bright solid water box.
  part("wood", [0.83, 0.205, 0.68], [0.66, 0.055, 0.2], 3);
  for (const end of [-1, 1]) {
    part("wood", [0.83 + end * 0.3, 0.25, 0.68], [0.035, PIG_TROUGH_WALL_HEIGHT, 0.2], 3);
    part("wood", [0.83, 0.25, 0.68 + end * 0.085], [0.64, PIG_TROUGH_WALL_HEIGHT, 0.03], 3);
  }
  part("wood", [.83,.25,.68],[.035,PIG_TROUGH_WALL_HEIGHT,.2],3);
  const feedingHeight = .18 + PIG_FEEDING_SURFACE_HEIGHT;
  part("feed-water", [1.00,feedingHeight,.68],[.25,.006,.13],3,"pig-feeding-water");
  part("feed-grain", [.65,feedingHeight,.68],[.25,.008,.13],3,"pig-feeding-grain");
  for(let slot=0;slot<3;slot++) {
    addPositionedRomanWareStock(part,"grain",slot,"input",[-1.12,.18,.75+slot*.38],detailed);
    addPositionedRomanWareStock(part,"water",slot,"input",[.35,.18,1.10+slot*.32],detailed);
  }
  // The breeding animals are separate from the six finite produced-ware slots below.
  part("paint", [.65,.31,.12],[.25,.23,.4],3,"pig-residents",undefined,[.74,.45,.39]);
  // One ware per allocated output position: two rows of three rested pigs.
  for (let i = 0; i < 6; i++) {
    const x = 0.58 + (i % 3) * 0.24,
      z = 0.12 + Math.floor(i / 3) * 0.29;
    const pigPart = withBuildingStock(part, "pig", i);
    for (const side of [-1, 1])
      pigPart(
        "paint",
        [x + side * 0.075, 0.23, z],
        [0.035, 0.1, 0.11],
        3,
        "box",
        undefined,
        [0.56, 0.31, 0.26]
      );
    pigPart("paint", [x, 0.31, z], [0.21, 0.18, 0.27], 3, "sphere", undefined, [0.69, 0.43, 0.36]);
    pigPart(
      "paint",
      [x, 0.31, z + 0.145],
      [0.12, 0.12, 0.13],
      3,
      "sphere",
      undefined,
      [0.67, 0.4, 0.34]
    );
  }
};
/**
 * One trained vine of the Vineyard rows (revised 2026-10-13; the sphere-leaf original is commit
 * fbad23c): a bark trunk up to the wires, a lobed leaf mass on them and a hanging grape bunch.
 */
const addRomanVine = (part: RomanDesignContext["part"], x: number, z: number) => {
  part("bark", [x, 0.51, z], [0.035, 0.66, 0.035], 3, "cylinder");
  part("leaf", [x, 0.94, z], [0.24, 0.3, 0.27], 3, "vine-foliage");
  part("paint", [x + 0.09, 0.81, z], [0.095, 0.15, 0.095], 3, "grape-bunch", undefined, [0.22, 0.05, 0.3]);
};
export const addRomanVineyard = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  romanRoom(context, -0.28, -0.16, 1.34, 1.02, 1.13, -0.28);
  for (const x of [0.75, 1.1]) {
    for (const z of [-0.65, 0.58]) part("wood", [x, 0.76, z], [0.055, 1.16, 0.055], 2);
    for (const y of [0.64, 1.02])
      part("rope", [x, y, -0.035], [0.012, 1.25, 0.012], 3, "cord", [Math.PI / 2, 0, 0]);
    for (let i = 0; i < (detailed ? 6 : 3); i++) addRomanVine(part, x, -0.5 + i * (detailed ? 0.18 : 0.36));
  }
  romanBench(part, -1.18, 0.23, 0.43, 0.68, 0.45);
  for (let i = 0; i < 6; i++)
    withBuildingStock(part, "grapes", i, "output", RAW_DRINK_WARES)(
      "paint",
      [-1.27 + (i % 2) * 0.17, 0.52, 0.02 + Math.floor(i / 2) * 0.19],
      [0.13, 0.1, 0.16],
      3,
      "sphere",
      undefined,
      [0.28, 0.075, 0.39]
    );
};
export const addRomanWinery = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  romanRoom(context, -0.34, -0.04, 1.42, 1.32, 1.06, -0.34);
  romanCanopy(context, 0.87, -0.13, 0.88, 1.2, 1.26);
  part("wood", [0.87, 0.23, -0.13], [0.7, 0.1, 0.7], 2, "cylinder");
  part("wood", [0.87, 0.45, -0.13], [0.7, 0.4, 0.7], 3, "ring");
  withBuildingStock(part, "grapes", 0, "input", RAW_DRINK_WARES)(
    "paint",
    [0.87, 0.37, -0.13],
    [0.56, 0.025, 0.56],
    3,
    "cylinder",
    undefined,
    [0.27, 0.06, 0.27]
  );
  for (const [row, z] of [0.82, 1.24].entries())
    for (const [column, x] of [0.58, 0.93, 1.28].entries())
      romanBarrel(withBuildingStock(part, "wine", row * 3 + column, "output", DRINK_WARES), x, z, detailed, 0.15);
};

import type { BuildingPart } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { addChineseRoof } from "./chinese-building-roofs";
import type { YaguraTower } from "./military-yagura-tower";
import type { RoofEnvelope } from "./nation-kit-classify";
import { type KitContext, runBetween } from "./nation-kit-parts";

/** The owner's transferred low Chinese hip form keeps Japanese kawara and vermilion/ivory eaves. */
export const useJapaneseTransferredHip = (typeId: number, roof: RoofEnvelope, main: boolean) =>
  typeId === 14 && main || typeId === 39 && roof.min[1] > 2;

export const addJapaneseTransferredHip = (context: KitContext, envelope: RoofEnvelope) => {
  const parts: BuildingPart[] = [];
  // ID2 deliberately selects the former low hip construction without the new pointed-tower override.
  addChineseRoof(part => parts.push({ stage: 1, ...part }), envelope, 2, context.detailed, false, "hip");
  for (const part of parts) {
    let built: BuildingPart = part.surface === "paint"
      ? { ...part, surface: "plaster", tint: [1.5, .28, .16] } : part;
    // Five small fortress roofs retain the same curved hip shell; Minimal paints the tiny tiles
    // instead of tessellating every pan/cap, and High uses appropriately broader tile courses.
    if(context.typeId===9&&built.shape==="occupation-roof")built={...built,
      roofCompactGeometry:Math.min(built.size[0],built.size[2])<.82?true:undefined,
      roofTiles:context.detailed?built.roofTiles:undefined,roofTileSpacing:1.25};
    const bounds = getRomanPartBounds(built);
    if (Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) <= context.limit.extentX + .001 &&
      Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2])) <= context.limit.extentZ + .001)
      context.add(built);
  }
  const roof = parts.find(part => part.shape === "occupation-roof")!;
  // This board meets both the wall/post heads and the closed roof core; it is not another roof skin.
  context.add({ position: [roof.position[0], roof.position[1] - roof.size[1] / 2 + .01, roof.position[2]],
    rotation: roof.rotation, shape: "box", size: [roof.size[0] * .90, .04, roof.size[2] * .90],
    stage: 3, surface: "plaster", tint: [1.18, .92, .80] });
};

/** Watchtower4 previously had an uncovered gallery; the transferred roof has its own real posts. */
export const addJapaneseWatchHip = (context: KitContext, tower: YaguraTower) => {
  const { form, plan, x, z } = tower;
  const width = Math.min(form.gallery?.width ?? form.width, (context.limit.extentX - Math.abs(x)) * 2 - .02);
  const depth = Math.min(form.gallery?.depth ?? form.depth, (context.limit.extentZ - Math.abs(z)) * 2 - .02);
  const eave = plan.deck + .92, px = width / 2 - .10, pz = depth / 2 - .10;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) context.add({
    position: [x + sx * px, (plan.deck + eave) / 2, z + sz * pz],
    shape: "box", size: [.055, .92, .055], stage: 3, surface: "wood" });
  // Fortress Minimal already has a closed bearing soffit meeting all four post heads.
  // Its hidden duplicate rails are unnecessary; keep the real posts/soffit and High joinery.
  for (const side of context.typeId===9&&!context.detailed?[]:[-1, 1]) {
    runBetween(context.add, [x - px, eave - .035, z + side * pz],
      [x + px, eave - .035, z + side * pz], [.065, .065], { stage: 3, surface: "wood" });
    runBetween(context.add, [x + side * px, eave - .035, z - pz],
      [x + side * px, eave - .035, z + pz], [.065, .065], { stage: 3, surface: "wood" });
  }
  addJapaneseTransferredHip(context, { min: [x - width / 2, eave, z - depth / 2],
    max: [x + width / 2, eave + .45, z + depth / 2] });
};

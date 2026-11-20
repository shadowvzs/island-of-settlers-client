import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { createMayaBuildingKit, MAYA_STONE } from "./maya-building-kit";
import { addMayaCarvedMotif } from "./maya-carved-motifs";

/** Open stepped cistern with carved draw stelae; the animated windlass and every bucket stay anchored. */
export const mayaWellRecipe = (original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = original.parts.filter(part => part.stock);
  const kit = createMayaBuildingKit(original, definition,
    { keep: [], walls: [], roofs: [], doorSurround: [] }, detailed, parts);
  const { add } = kit, [x, axleY, z] = original.mechanism;
  const tiers = [
    { bottom: 0, height: .16, span: .76 },
    { bottom: .16, height: .18, span: .66 },
    { bottom: .34, height: .14, span: .74 }
  ];
  for (const tier of tiers) {
    const thickness = (tier.span - .46) / 2, y = tier.bottom + tier.height / 2;
    for (const side of [-1, 1]) {
      add({ position: [x, y, z + side * (tier.span - thickness) / 2], shape: "bevel-box",
        size: [tier.span, tier.height, thickness], stage: 1, surface: "cut-stone", tint: MAYA_STONE });
      add({ position: [x + side * (tier.span - thickness) / 2, y, z], shape: "bevel-box",
        size: [thickness, tier.height, .46], stage: 1, surface: "cut-stone", tint: MAYA_STONE });
    }
  }
  for (const side of [-1, 1]) {
    const postZ = z + side * .45;
    add({ position: [x, axleY / 2 + .015, postZ], shape: "bevel-box",
      size: [.12, axleY + .03, .13], stage: 2, surface: "cut-stone", tint: MAYA_STONE });
    add({ position: [x, axleY + .075, postZ], shape: "bevel-box",
      size: [.22, .12, .19], stage: 2, surface: "cut-stone", tint: MAYA_STONE });
    if (detailed) for (const flank of [-1, 1]) add({
      position: [x + flank * .065, axleY * .53, postZ + .018], shape: "box",
      size: [.018, axleY * .68, .055], stage: 4, surface: "plaster" });
  }
  // This beam is the original windlass support, exactly where the animated drum turns.
  for (const part of original.parts) if (!part.stock && part.surface === "wood" &&
    Math.abs(part.position[1] - axleY) < .002 && Math.abs(part.position[2] - z) < .002) parts.push(part);
  addMayaCarvedMotif(add, "water", [x, .405, z + .376], .42, .095, .025, 0, detailed);
  // The rear collecting trough is a functional limestone basin at the original water-surface anchor.
  const troughX = -.03, troughZ = -.75;
  add({ position: [troughX, .025, troughZ], shape: "box", size: [.53, .05, .43],
    stage: 1, surface: "cut-stone", tint: MAYA_STONE });
  for (const side of [-1, 1]) {
    add({ position: [troughX + side * .245, .14, troughZ], shape: "box", size: [.04, .23, .43],
      stage: 2, surface: "cut-stone", tint: MAYA_STONE });
    add({ position: [troughX, .14, troughZ + side * .195], shape: "box", size: [.45, .23, .04],
      stage: 2, surface: "cut-stone", tint: MAYA_STONE });
  }
  return { ...original, parts };
};

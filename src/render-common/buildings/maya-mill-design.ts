import { MAYA_STONE, type MayaBuildingKit } from "./maya-building-kit";
import { addMayaCarvedMotif } from "./maya-carved-motifs";

/** Three receding stone storeys carry the unchanged axle; all geometry stays behind the sail plane. */
export const addMayaMillUpper = (kit: MayaBuildingKit) => {
  const { add, detailed } = kit;
  const front = .431, back = -.374;
  const tiers = [
    { bottom: 1.18, top: 1.52, width: .99 },
    { bottom: 1.52, top: 1.9, width: .81 },
    { bottom: 1.9, top: 2.57, width: .64 }
  ];
  for (const tier of tiers) {
    const height = tier.top - tier.bottom, y = (tier.top + tier.bottom) / 2;
    for (const z of [back + .035, front - .035]) add({ position: [0, y, z],
      shape: "box", size: [tier.width, height, .07], stage: 2, surface: "plaster" });
    for (const side of [-1, 1]) add({ position: [side * (tier.width / 2 - .035), y, (front + back) / 2],
      shape: "box", size: [.07, height, front - back - .14], stage: 2, surface: "plaster" });
    add({ position: [0, tier.top - .035, (front + back) / 2], shape: "bevel-box",
      size: [tier.width + .025, .07, front - back], stage: 3, surface: "cut-stone", tint: MAYA_STONE });
    if (detailed) for (let course = tier.bottom + .13; course < tier.top - .08; course += .16) {
      for (const z of [back + .005, front - .005]) add({ position: [0, course, z],
        shape: "box", size: [tier.width, .018, .018], stage: 3, surface: "cut-stone", tint: MAYA_STONE });
    }
  }
  // Low shoulder copings mark the work storey; the shaft room reads separately above it.
  for (const side of [-1, 1]) add({ position: [side * .473, 1.23, -.01], shape: "bevel-box",
    size: [.09, .1, .79], stage: 3, surface: "cut-stone", tint: MAYA_STONE });
  add({ position: [0, 2.605, .025], shape: "bevel-box", size: [.61, .07, .74],
    stage: 3, surface: "cut-stone", tint: MAYA_STONE });
  // The carved maize relief belongs to the rear shaft room, clear of the moving sail disc.
  addMayaCarvedMotif(add, "maize", [0, 2.21, back - .008], .33, .33, .025, Math.PI, detailed);
};

import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { roofTopAt } from "./levels/level-roof-surface";
import type { Add } from "./nation-kit-parts";
import { addPersianLatticeNiche, addPersianPishtaq } from "./persian-arched-facade";
import { addPersianDomedRoom, addPersianIwan, addPersianVaultCap } from "./persian-vault-room";

/** A monumental audience vault, low administrative wings and a deep, deliberately oversized civic portal. */
export const persianHeadquartersRecipe = (original: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = original.parts.filter(part => part.stock);
  const add: Add = part => parts.push({ stage: 2, ...part });
  const doorX = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  addPersianDomedRoom(add, original, detailed);
  for (const side of [-1, 1]) {
    const x = side * 1.30, height = side < 0 ? .82 : 1.08, rise = side < 0 ? .38 : .56;
    const spring = side < 0 ? .28 : .43;
    add({ persianOpening: [0, 0, -.5], persianWindows: [{ angle: 0, bottom: .19 / height - .5,
      halfAngle: Math.asin(.4 / .78), pointedAspect: .29 / .20, rise: .29 / height,
      spring: (.19 + spring) / height - .5 }], position: [x, height / 2, -.28],
      shape: "persian-room", size: [.78, height, 1.72], stage: 1, surface: "plaster" });
    addPersianVaultCap(add, x, -.28, .78, 1.72, height, rise, 1, false, detailed);
    add({ occupationRoof: "barrel", position: [x, height + rise * .44, -.28],
      radialSegments: detailed ? 16 : 6, shape: "occupation-roof", size: [.78, rise, 1.72],
      stage: 3, surface: "roof" });
  }
  addPersianIwan(add, doorX, .92, 1.58, 1.06, 1.46, 1.02, .22, detailed);
  // The audience entrance has actual fitted archivolts and deep jambs; the ground route stays open.
  addPersianPishtaq(add, doorX, 0, 1.46, 1.16, 1.46, .97, .10, .28, detailed);
  for (const side of [-1, 1]) add({ position: [doorX + side * .55, 2.35, 1.536],
    shape: "persian-stucco-relief", size: [.18, .30, .028], stage: 3,
    surface: "plaster", tint: [1.06, 1.01, .90] });
  for (const side of [-1, 1]) {
    const spring = side < 0 ? .28 : .43;
    addPersianLatticeNiche(add, side * 1.30, .19, .61, .40, spring, .29, detailed, true);
  }
  // A recessed inner doorway stays at the canonical hinge instead of moving the gameplay entrance.
  const doorWidth = original.doorDimensions?.width ?? .46;
  for (const side of [-1, 1]) add({ position: [doorX + side * (doorWidth / 2 + .065), .44, original.door[2]],
    shape: "bevel-box", size: [.13, .88, .20], stage: 1, surface: "plaster" });
  add({ position: [doorX, .92, original.door[2]], shape: "bevel-box",
    size: [doorWidth + .26, .12, .20], stage: 1, surface: "plaster" });
  // The fortress's stepped crest vocabulary crowns the solid outer portal piers, not the thin roof skin.
  for (const side of [-1, 1]) {
    const x = doorX + side * .72;
    add({ position: [x, 1.48, 1.38], shape: "bevel-box", size: [.25, .10, .25], surface: "plaster" });
    add({ position: [x, 1.57, 1.38], shape: "box", size: [.15, .10, .18], surface: "plaster" });
    add({ position: [x, 1.64, 1.38], shape: "box", size: [.08, .04, .12], surface: "plaster" });
  }
  for (const x of [-1.05, 1.05]) {
    add({ position: [x, .19, .97], shape: "clay-jar", size: [.25, .38, .25],
      surface: "paint", tint: [.18, .46, .48] });
  }
  if (original.flagAnchor) {
    const [x, y, z] = original.flagAnchor, roof = roofTopAt(parts, x, z, detailed);
    if (roof !== null && roof < y - .18) add({ position: [x, (roof + y - .18) / 2, z],
      shape: "cylinder", size: [.035, y - .18 - roof, .035], stage: 3, surface: "wood" });
  }
  return { ...original, parts };
};

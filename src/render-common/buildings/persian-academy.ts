import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { type Add } from "./nation-kit-parts";
import { addPersianCivicPlaque, addPersianIwan, addPersianVaultRoom } from "./persian-vault-room";

/** A deep vaulted military hall and a properly supported open equipment bay, without Roman awnings. */
export const persianAcademyRecipe = (original: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = original.parts.filter(part => part.stock || !part.architecture && !part.occupationSign &&
    part.position[0] > .35 && getRomanPartBounds(part).max[1] < .95);
  const add: Add = part => parts.push({ stage: 2, ...part });
  const doorX = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  addPersianVaultRoom(add, original, { x: -.48, z: -.20, width: 1.65, depth: 1.38, height: 1.28, rise: 1.05 }, detailed);
  addPersianIwan(add, doorX, .57, 1.12, .75, 1.0, .76, .18, detailed);
  addPersianCivicPlaque(add, original, [doorX, 1.55, .965]);
  const bay = { x: .90, z: .06, width: 1.08, depth: 1.46, spring: 1.25, rise: .64 };
  // The corner piers are beneath the two true arch-foot lines; equipment stocks remain exactly authored.
  for (const x of [.40, 1.42]) for (const z of [-.59, .70]) {
    add({ position: [x, .60, z], shape: "bevel-box", size: [.12, 1.20, .12], stage: 1, surface: "plaster" });
    add({ position: [x, 1.205, z], shape: "bevel-box", size: [.15, .09, .15], stage: 2, surface: "plaster" });
  }
  const beamTop = bay.spring - .06 * bay.rise + .004;
  for (const x of [bay.x - bay.width / 2 + .025, bay.x + bay.width / 2 - .025]) add({
    position: [x, beamTop - .035, bay.z], shape: "bevel-box", size: [.09, .07, bay.depth], surface: "plaster" });
  add({ radialSegments: detailed ? 16 : 6, occupationRoof: "barrel", position: [bay.x, bay.spring + bay.rise * .44, bay.z],
    shape: "occupation-roof", size: [bay.width, bay.rise, bay.depth], stage: 3, surface: "roof" });
  if (detailed) for (const x of [-1.17, .20]) add({ position: [x, .035, .43], shape: "bevel-box",
    size: [.20, .07, .22], surface: "cut-stone" });
  return { ...original, parts };
};

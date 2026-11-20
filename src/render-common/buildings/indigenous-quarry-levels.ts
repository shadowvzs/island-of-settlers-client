import type { BuildingPart } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { LevelKit, LevelPart } from "./levels/level-kit";
import type { LevelSite } from "./levels/level-site";

export const isIndigenousQuarrySite = (site: Pick<LevelSite, "nation" | "recipe">) =>
  site.nation === "indigenous" && site.recipe.parts.some(part => part.indigenousMasonryStone);

/** Standard national upgrades still apply to masonry rooms; protected art/access are physical exclusions. */
const placeQuarryLevelPart = (kit: LevelKit, candidate: LevelPart): LevelPart | undefined => {
  let part = candidate;
  // A cold stone-working room has no flue. The ordinary tier-three dispatcher also invokes
  // the shared flue helper; do not inherit its unrelated stack/window on this textile cover.
  if (part.shape === "window-shadow" || part.windowShadow) return undefined;
  const wallTop = Math.max(...kit.site.parts.filter(part => part.indigenousMasonryStone)
    .map(part => getRomanPartBounds(part).max[1]));
  if (part.surface === "plaster" && part.size[0] === .2 && part.size[2] === .2 &&
    part.position[1] > wallTop) return undefined;
  const paint = kit.site.parts.find(part => part.indigenousPigment);
  const bounds = getRomanPartBounds({ ...part, stage: part.stage ?? 3 });
  const front = bounds.max[2] > kit.site.door.z - .08;
  if (front && paint) {
    const ink = getRomanPartBounds(paint);
    const coversInk = bounds.min[0] < ink.max[0] + .025 && bounds.max[0] > ink.min[0] - .025 &&
      bounds.min[1] < ink.max[1] + .025 && bounds.max[1] > ink.min[1] - .025;
    if (coversInk) return undefined;
  }
  if (front && part.shape === "box" && part.size[1] <= .12 && part.position[1] < .15 &&
    bounds.min[0] < kit.site.door.left && bounds.max[0] > kit.site.door.left - .065) {
    const right = kit.site.door.left - .065, width = right - bounds.min[0];
    if (width <= .02) return undefined;
    part = { ...part, position: [bounds.min[0] + width / 2, part.position[1], part.position[2]],
      size: [width, part.size[1], part.size[2]] };
  }
  // The ordinary front hood shadows the enlarged mural from oblique views. Omit its entire
  // roof/fringe/rafter assembly; the existing rear work canopy supplies this tier's shelter.
  if (front && part.surface === "straw" && part.size[0] > .8) return undefined;
  if (front && part.shape === "cylinder" && part.surface === "wood" &&
    part.size[0] === .04 && part.size[2] === .04 && part.position[1] > .85)
    return undefined;
  return part;
};

/** Reuse existing tier pieces, retaining complete clear assemblies and no tent-only ornaments. */
export const addIndigenousQuarryLevel = (kit: LevelKit, decorate: (kit: LevelKit) => void) => {
  const candidates: BuildingPart[] = [];
  decorate({ ...kit, add: part => candidates.push({ ...part, stage: part.stage ?? 3 }) });
  const canopy = candidates.find(part => part.surface === "straw" && part.size[0] === .5 && part.rotation);
  for (const candidate of candidates) {
    let relocated = candidate;
    const canopyStrut = canopy && candidate.surface === "wood" && candidate.size[0] === .035 &&
      Math.abs(candidate.position[0] - canopy.position[0]) <= .201 && candidate.position[2] > kit.site.door.z;
    if (canopy && (candidate === canopy || canopyStrut)) relocated = {
      ...candidate, position: [candidate.position[0] - .20, candidate.position[1], -candidate.position[2] + .055],
      rotation: candidate.rotation ? [-candidate.rotation[0], candidate.rotation[1], candidate.rotation[2]] : undefined
    };
    const placed = placeQuarryLevelPart(kit, relocated);
    if (placed) kit.add(placed);
  }
};

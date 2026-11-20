import type { BuildingDefinition } from "./building-catalog";
import type { BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import {
  type Bounds,
  type DecorSite,
  findWallFaces,
  fitsSite,
  hiddenSidePenalty,
  isBacked,
  isSheltered,
  type WallFace
} from "./nubian-decor-faces";
import {
  type DecorAssembly,
  type DecorSpot,
  hatAssembly,
  jarsAssembly,
  NUBIAN_DECOR_VARIANTS,
  type NubianDecorKind,
  shieldAssembly,
  skullAssembly,
  skullHeight,
  textileAssembly} from "./nubian-decor-props";

interface DecorPlan {
  kinds: readonly NubianDecorKind[];
  /** Minimal keeps only the first few props where the cheap model is already near its budget. */
  minimal?: number;
  /** Skull design: 0 cattle bucranium, 1 oryx (hunters). */
  skull?: number;
}

const WARRIORS: DecorPlan = { kinds: ["shield", "shield", "skull", "textile"] };
const HIDE_WORKERS: DecorPlan = { kinds: ["skull", "textile", "jars"] };
const FIELD_WORKERS: DecorPlan = { kinds: ["hat", "textile", "jars"] };
const KITCHENS: DecorPlan = { kinds: ["jars", "textile", "hat"] };
const MINES: DecorPlan = { kinds: ["skull", "textile"] };

/**
 * Per occupation (measured against the 9,800 High / 2,300 Minimal triangle budgets with
 * tools/bench/nubian-decor-review.ts). The Mill is left to its own redesign.
 */
const DECOR_PLANS: Readonly<Record<number, DecorPlan>> = {
  0: { kinds: ["textile", "shield", "shield", "jars", "textile", "skull"], minimal: 2 },
  1: WARRIORS,
  2: WARRIORS,
  3: HIDE_WORKERS,
  4: { kinds: ["shield", "skull", "textile"] },
  5: FIELD_WORKERS,
  6: KITCHENS,
  8: HIDE_WORKERS,
  9: { kinds: ["shield", "shield", "skull", "textile"] },
  10: MINES,
  11: MINES,
  12: MINES,
  13: MINES,
  14: { kinds: ["shield", "textile"] },
  15: { kinds: ["shield", "skull", "textile"] },
  17: { kinds: ["hat", "textile"] },
  18: { kinds: ["hat", "jars", "textile"] },
  19: { kinds: ["hat", "textile"] },
  20: { kinds: ["hat", "textile"] },
  21: HIDE_WORKERS,
  22: { kinds: ["skull", "textile", "hat"], skull: 1 },
  23: KITCHENS,
  24: { kinds: ["shield", "shield", "textile"] },
  25: { kinds: ["textile", "jars"] },
  26: { kinds: ["textile"] },
  27: { kinds: ["hat", "textile"] },
  28: FIELD_WORKERS,
  29: { kinds: ["jars", "textile", "textile"] },
  32: KITCHENS,
  33: { kinds: ["textile", "hat"] },
  34: { kinds: ["textile", "shield", "jars"] },
  36: { kinds: ["textile", "hat"] },
  37: FIELD_WORKERS,
  39: { kinds: ["textile", "jars", "textile"] },
  40: { kinds: ["textile", "jars", "hat", "textile"] },
  // Residences: household textiles and jars.
  57: { kinds: ["textile", "jars"] },
  58: { kinds: ["textile", "jars", "hat"] },
  59: { kinds: ["textile", "jars", "textile", "hat"] },
  60: FIELD_WORKERS,
  61: { kinds: ["textile", "jars", "hat"] }
};

const SIDE_RANK: Readonly<Record<NubianDecorKind, Readonly<Record<WallFace["side"], number>>>> = {
  hat: { back: 4, front: 0, side: 1 },
  jars: { back: 4, front: 0, side: 1.2 },
  shield: { back: 4, front: 0, side: 1 },
  skull: { back: 4, front: 0, side: 1.5 },
  textile: { back: 3, front: 0.8, side: 0 }
};

const faceRank = (kind: NubianDecorKind, face: WallFace) => SIDE_RANK[kind][face.side] + hiddenSidePenalty(face);

/** Lower is better: door-side props gather round the entrance, textiles fill the middle of free walls. */
const spotScore = (kind: NubianDecorKind, face: WallFace, along: number, doorCenter: number) => {
  const rank = faceRank(kind, face),
    middle = (face.from + face.to) / 2;
  if (kind === "textile") return rank + Math.abs(along - middle) * 0.5;
  if (face.side === "front") return rank + Math.abs(along - doorCenter);
  // Side walls: nearest the front corner, where the gameplay camera sees them.
  return rank + (face.side === "side" ? face.to - along : Math.abs(along - middle));
};

/** Reference heights to try per kind (rod height, centre or ground). */
const heightsFor = (kind: NubianDecorKind, face: WallFace, doorTop: number, variant: number) => {
  if (kind === "jars") return [0];
  if (kind === "textile")
    return [face.top - 0.1, face.top - 0.16, face.top - 0.22, face.top - 0.3, 0.68, 0.6];
  if (kind === "skull") {
    const half = skullHeight(variant) / 2;
    return [doorTop + LINTEL_TOP + half, face.top - 0.04 - half, face.top - 0.12 - half, 0.6, 0.54];
  }
  return [0.62, 0.68, 0.56, 0.5, 0.46];
};

const ALONG_STEP = 0.04;
/** The Nubian door's wooden lintel ends this far above the door opening. */
const LINTEL_TOP = 0.11;

type Build = (spot: DecorSpot) => DecorAssembly;
const TEXTILE_WIDTHS = [0.46, 0.38, 0.3];

/** Assembly forms per kind, most ornate first: wide or narrow hangings, shields with or without spears. */
const buildsFor = (kind: NubianDecorKind, doorCenter: number): Build[] => {
  if (kind === "textile")
    return TEXTILE_WIDTHS.map((width) => (spot: DecorSpot) => textileAssembly(spot, width));
  if (kind === "shield")
    return [(spot) => shieldAssembly(spot, spot.detailed), (spot) => shieldAssembly(spot, false)];
  if (kind === "skull") return [skullAssembly];
  if (kind === "hat") return [hatAssembly];
  return [(spot) => jarsAssembly(spot, spot.along < doorCenter ? -1 : 1)];
};

/** Steps along the face; front faces also try the door axis (a skull on the lintel above the door). */
const alongCandidates = (face: WallFace, doorCenter: number) => {
  const steps: number[] = face.side === "front" ? [doorCenter] : [];
  for (let along = face.from + ALONG_STEP; along < face.to; along += ALONG_STEP) steps.push(along);
  return steps;
};

interface Candidate {
  assembly: DecorAssembly;
  score: number;
}
interface Placement {
  detailed: boolean;
  doorCenter: number;
  doorTop: number;
  variant: number;
}

const fits = (kind: NubianDecorKind, face: WallFace, assembly: DecorAssembly, site: DecorSite) =>
  fitsSite(face, assembly.occupied, site) &&
  (kind === "jars" || isBacked(face, assembly.occupied, site));

/** Props in the shade of a portico or upper storey are a last resort. */
const SHELTER_PENALTY = 2.5;

const firstFit = (
  kind: NubianDecorKind,
  face: WallFace,
  site: DecorSite,
  options: ReadonlyArray<() => DecorAssembly>
) => {
  for (const option of options) {
    const assembly = option();
    if (fits(kind, face, assembly, site)) return assembly;
  }
  return null;
};

interface Slot {
  along: number;
  entry: FaceSite;
  score: number;
}

/** Every candidate slot on every face, best scored first. */
const rankedSlots = (
  kind: NubianDecorKind,
  faces: readonly FaceSite[],
  doorCenter: number
): Slot[] =>
  faces
    .flatMap((entry) =>
      alongCandidates(entry.face, doorCenter).map((along) => ({
        along,
        entry,
        score: spotScore(kind, entry.face, along, doorCenter)
      }))
    )
    .sort((a, b) => a.score - b.score);

/**
 * The best free spot for one prop, or null when the building has no room for it. Slots are tried
 * best first; a sheltered fit only wins until an open slot scores better.
 */
const placeProp = (
  kind: NubianDecorKind,
  site: DecorSite,
  faces: readonly FaceSite[],
  placement: Placement
) => {
  const { detailed, doorCenter, doorTop, variant } = placement,
    builds = buildsFor(kind, doorCenter);
  let best: Candidate | null = null;
  for (const { along, entry, score } of rankedSlots(kind, faces, doorCenter)) {
    if (best && score >= best.score) break;
    const { face } = entry,
      local = { ...site, ...entry.site },
      heights = heightsFor(kind, face, doorTop, variant);
    const found = firstFit(
      kind,
      face,
      local,
      builds.flatMap((build) =>
        heights.map((y) => () => build({ along, detailed, face, variant, y }))
      )
    );
    if (!found) continue;
    const total = score + (isSheltered(face, found.occupied, local.boxes) ? SHELTER_PENALTY : 0);
    if (!best || total < best.score) best = { assembly: found, score: total };
  }
  return best?.assembly ?? null;
};

/** Parts that can touch props on a face: within reach of its plane and along its run. */
const REACH = 0.7;
interface FaceSite {
  face: WallFace;
  site: Pick<DecorSite, "boxes" | "walls">;
}
const nearFace = (face: WallFace, boxes: readonly Bounds[]) =>
  boxes.filter(
    (box) =>
      box.min[face.axis]! < face.plane + REACH &&
      box.max[face.axis]! > face.plane - REACH &&
      box.min[face.along]! < face.to + REACH &&
      box.max[face.along]! > face.from - REACH
  );

const variantOf = (kind: NubianDecorKind, plan: DecorPlan, typeId: number, index: number) => {
  if (kind === "skull") return plan.skull ?? 0;
  const count = kind === "jars" ? NUBIAN_DECOR_VARIANTS.vase : NUBIAN_DECOR_VARIANTS[kind];
  return (typeId * 5 + index * 3) % count;
};

/**
 * Nubian household decor fitted to each occupation: woven hangings on free walls, painted jars
 * beside the door, sun hats and hide shields on pegs, bucrania over doors. Every prop hangs on a
 * peg or rod set into the mud brick or stands on the ground, inside the plot envelope and clear of
 * the door lane, worker walks, windows and stock.
 */
export const addNubianDecor = (
  recipe: BuildingRecipe,
  definition: BuildingDefinition,
  detailed: boolean,
  limit: DecorSite["limit"]
): BuildingRecipe => {
  const plan = DECOR_PLANS[definition.id];
  if (!plan) return recipe;
  const { faces, walls } = findWallFaces(recipe.parts);
  if (!faces.length) return recipe;
  const site: DecorSite = {
    boxes: recipe.parts.map((part) => getRomanPartBounds(part)),
    limit,
    recipe,
    walls
  };
  const local: FaceSite[] = faces.map((face) => ({
    face,
    site: { boxes: nearFace(face, site.boxes), walls: nearFace(face, walls) }
  }));
  const width = recipe.doorDimensions?.width ?? 0.46,
    doorTop = recipe.doorDimensions?.height ?? 0.77;
  const kinds = detailed ? plan.kinds : plan.kinds.slice(0, plan.minimal ?? plan.kinds.length);
  const added = kinds.flatMap((kind, index) => {
    const variant = variantOf(kind, plan, definition.id, index);
    const assembly = placeProp(kind, site, local, {
      detailed,
      doorCenter: recipe.door[0] + width / 2,
      doorTop,
      variant
    });
    if (!assembly) return [];
    // Later props keep clear of this one on every face.
    for (const entry of local) entry.site.boxes.push(assembly.occupied);
    return assembly.parts.map((part) => ({ ...part, nationDecor: true }));
  });
  return { ...recipe, parts: [...recipe.parts, ...added] };
};

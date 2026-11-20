import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "../buildings/building-recipe";
import { HIP_RIDGE_END } from "../buildings/occupation-roof-height";

/** A straight ridge line on a complete weather cover, in the recipe's unrotated plan grid. */
export interface CoverRidge {
  /** Plan axis the ridge runs along (0 x, 2 z). */
  axis: 0 | 2;
  /** Ridge extent along `axis`. */
  end: number;
  /** Coordinate across the ridge: the ridge line itself. */
  line: number;
  /** Ridge extent along `axis`. */
  start: number;
  /** Rendered height of the ridge surface. */
  top: number;
}

/** Unit-roof crown height (centre 0 … eave −0.5) and straight-ridge share of the local z size. */
interface CoverProfile {
  crown: number;
  ridgeShare: number;
}

/** `getOccupationRoofHeight` crowns every form at 0.43; hips keep only the middle ridge share. */
const OCCUPATION_COVERS: Readonly<Record<string, CoverProfile>> = {
  barrel: { crown: .43, ridgeShare: 1 },
  gable: { crown: .43, ridgeShare: 1 },
  "half-hip": { crown: .43, ridgeShare: HIP_RIDGE_END * 2 },
  hip: { crown: .43, ridgeShare: HIP_RIDGE_END * 2 },
  pyramid: { crown: .43, ridgeShare: 0 }
};

/** `nationRoofHeight` crowns Viking gables and Japanese hips at 0.5; a pyramid has no ridge. */
const NATION_COVERS: Readonly<Record<string, CoverProfile>> = {
  japanese: { crown: .5, ridgeShare: .5 },
  "japanese-pyramid": { crown: .5, ridgeShare: 0 },
  viking: { crown: .5, ridgeShare: 1 }
};

/** `indigenousRoofHeight`: barrel and earth longhouses crown flat over the centre; awnings sag. */
const INDIGENOUS_COVERS: Readonly<Record<string, CoverProfile>> = {
  awning: { crown: .42, ridgeShare: 0 },
  barrel: { crown: .5, ridgeShare: 1 },
  earth: { crown: .5, ridgeShare: .4 },
  framed: { crown: .5, ridgeShare: 0 },
  tipi: { crown: .5, ridgeShare: 0 }
};

const NO_ROTATION: Point3 = [0, 0, 0];
const LEVEL_TOLERANCE = 1e-6;
const AXIS_TOLERANCE = 1e-6;

/** Only a yaw keeps a cover's ridge on a plan axis; roofs are never pitched as authored parts. */
const isLevelPart = (part: BuildingPart) =>
  Math.abs(part.rotation?.[0] ?? 0) < LEVEL_TOLERANCE &&
  Math.abs(part.rotation?.[2] ?? 0) < LEVEL_TOLERANCE;

const profileOf = (part: BuildingPart): CoverProfile | null => {
  if (part.stock) return null;
  if (part.shape === "occupation-roof")
    return OCCUPATION_COVERS[part.occupationRoof ?? "hip"] ?? null;
  if (part.shape === "nation-roof") return NATION_COVERS[part.roofProfile ?? "viking"] ?? null;
  if (part.shape === "indigenous-roof")
    return INDIGENOUS_COVERS[part.indigenousRoof ?? "tipi"] ?? null;
  return null;
};

/** End infill follows its cover's rendered form, never its authored box top. */
const infillProfileOf = (part: BuildingPart): CoverProfile | null => {
  if (part.shape !== "roof-infill" || part.stock) return null;
  if (part.indigenousRoof) return INDIGENOUS_COVERS[part.indigenousRoof] ?? null;
  return OCCUPATION_COVERS[part.occupationRoof ?? "hip"] ?? null;
};

/** Rendered crown height of a cover or its end infill; other parts have no roof profile. */
export const coverSurfaceTop = (part: BuildingPart): number | null => {
  if (!isLevelPart(part)) return null;
  const profile = profileOf(part) ?? infillProfileOf(part);
  return profile ? part.position[1] + profile.crown * part.size[1] : null;
};

/** The rendered ridge of a complete cover, or null when it has no straight ridge. */
export const coverRidgeOf = (part: BuildingPart): CoverRidge | null => {
  if (!isLevelPart(part)) return null;
  const profile = profileOf(part);
  if (!profile || profile.ridgeShare <= 0) return null;
  const [, yaw] = part.rotation ?? NO_ROTATION;
  const sin = DMath.sin(yaw), cos = DMath.cos(yaw), turned = Math.abs(sin) > .5;
  if (Math.abs(turned ? cos : sin) > AXIS_TOLERANCE) return null;
  const half = (part.size[2] * profile.ridgeShare) / 2;
  const top = part.position[1] + profile.crown * part.size[1];
  if (turned)
    return { axis: 0, end: part.position[0] + half, line: part.position[2],
      start: part.position[0] - half, top };
  return { axis: 2, end: part.position[2] + half, line: part.position[0],
    start: part.position[2] - half, top };
};

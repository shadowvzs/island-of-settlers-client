import type { BuildingPart, BuildingSurface, Point3 } from "../building-recipe";
import { indigenousRoofHeight } from "../indigenous-roof-profile";
import { mayaPlantRoofCoreHeight } from "../maya-plant-roof-profile";
import { ogiveMeshHeight } from "../nation-ogive-profile";
import { nationRoofMeshHeight } from "../nation-roof-profile";
import { getOccupationRoofHeight } from "../occupation-roof-height";
import { persianBarrelHeight, persianDomeMeshHeight } from "../persian-vault-profile";
import { rotationFromEuler } from "../recipe-rotation";

const ROOF_SURFACES: ReadonlySet<BuildingSurface> = new Set(["roof", "roof-shingles", "roof-slate", "roof-thatch"]);
/** Loose tiles lie on their slab: the slab is the surface. */
const IGNORED_SHAPES: ReadonlySet<BuildingPart["shape"]> = new Set(["tile", "paint-triangle", "paint-ellipse"]);
const TILT_TOLERANCE = 1e-3;

/** Unit (−0.5 … 0.5) height over unit plan point (x, z) of a shaped roof, or null where it has no top. */
type UnitProfile = (part: BuildingPart, x: number, z: number, detailed: boolean) => number | null;

const radial = (x: number, z: number) => Math.hypot(x * 2, z * 2);

const PROFILES: Partial<Record<BuildingPart["shape"], UnitProfile>> = {
  "indigenous-roof": (part, x, z) =>
    indigenousRoofHeight(part.indigenousRoof ?? "tipi", x, z, part.indigenousEntrance),
  "civic-hipped-roof": (_part, x, z) => .5 - 2 * Math.max(Math.abs(x), Math.abs(z)),
  cone: (_part, x, z) => radial(x, z) > 1 ? null : .5 - radial(x, z),
  dome: (_part, x, z) => radial(x, z) > 1 ? null : .5 * Math.sqrt(1 - radial(x, z) ** 2),
  "nation-roof": (part, x, z, detailed) => nationRoofMeshHeight(part.roofProfile ?? "viking", detailed, x, z, part.compactGeometry),
  "occupation-roof": (part, x, z) => {
    if (part.plantRoofStyle) return mayaPlantRoofCoreHeight(part, x, z);
    return getOccupationRoofHeight(part.occupationRoof, x, z, part.roofSweep, part.roofCurve);
  },
  "ogive-dome": (part, x, z, detailed) => ogiveMeshHeight(x, z, detailed, part.radialSegments),
  "persian-barrel": (_part, x, _z, detailed) => persianBarrelHeight(x, detailed),
  "persian-dome": (_part, x, z, detailed) => persianDomeMeshHeight(x, z, detailed)
};

const isLevel = (part: BuildingPart) =>
  Math.abs(part.rotation?.[0] ?? 0) < TILT_TOLERANCE && Math.abs(part.rotation?.[2] ?? 0) < TILT_TOLERANCE;

/** Top of a shaped roof (turned about y only) over the plan point. */
const profileTop = (part: BuildingPart, profile: UnitProfile, x: number, z: number, detailed: boolean) => {
  const yaw = part.rotation?.[1] ?? 0, dx = x - part.position[0], dz = z - part.position[2];
  const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw), localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const unitX = localX / part.size[0], unitZ = localZ / part.size[2];
  if (Math.abs(unitX) > .5 || Math.abs(unitZ) > .5) return null;
  if (part.persianRoofPlan && Math.hypot(unitX * 2 / part.persianRoofPlan[0],
    unitZ * 2 / part.persianRoofPlan[1]) > 1) return null;
  const height = profile(part, unitX, unitZ, detailed);
  return height === null ? null : part.position[1] + height * part.size[1];
};

/** Where a vertical line through the plan point leaves the top of a (rotated) box. */
const boxTop = (part: BuildingPart, x: number, z: number) => {
  const rotation = rotationFromEuler(part.rotation ?? [0, 0, 0]);
  const offset: Point3 = [x - part.position[0], -part.position[1], z - part.position[2]];
  let low = -Infinity, high = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    // Local coordinate along the line y = t: transpose(R)·(offset + t·up).
    const start = rotation[0][axis]! * offset[0] + rotation[1][axis]! * offset[1] + rotation[2][axis]! * offset[2];
    const step = rotation[1][axis]!, half = part.size[axis]! / 2;
    if (Math.abs(step) < 1e-9) {
      if (Math.abs(start) > half) return null;
      continue;
    }
    const first = (-half - start) / step, second = (half - start) / step;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
  }
  return high >= low ? high : null;
};

const partTop = (part: BuildingPart, x: number, z: number, detailed: boolean) => {
  const profile = PROFILES[part.shape];
  if (profile && isLevel(part)) return profileTop(part, profile, x, z, detailed);
  return boxTop(part, x, z);
};

/** Sod laid on a roof (Viking turf roofs): a leaf-surfaced roof slab. */
const isTurf = (part: BuildingPart) => part.surface === "leaf" && part.shape === "box" && part.stage === 4;

export const isRoofCovering = (part: BuildingPart) =>
  (part.shape === "occupation-roof" || part.shape === "indigenous-roof" || ROOF_SURFACES.has(part.surface) || isTurf(part) || part.roofSupport === true) &&
  !IGNORED_SHAPES.has(part.shape) && !part.stock;

/** Domes, cones and spires crown a roof; its own slopes or terrace lie beneath them. */
const CROWN_SHAPES: ReadonlySet<BuildingPart["shape"]> = new Set(["dome", "ogive-dome", "persian-dome", "cone"]);

/**
 * Height of the highest roof covering over a plan point, or null where no roof covers it;
 * `slopesOnly` reads the roof under any dome or spire standing on it.
 */
export const roofTopAt = (parts: readonly BuildingPart[], x: number, z: number, detailed: boolean,
  slopesOnly = false) => {
  let top: number | null = null;
  for (const part of parts) {
    if (!isRoofCovering(part) || slopesOnly && CROWN_SHAPES.has(part.shape)) continue;
    const height = partTop(part, x, z, detailed);
    if (height !== null && (top === null || height > top)) top = height;
  }
  return top;
};

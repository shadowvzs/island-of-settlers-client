import type { BuildingPart } from "./building-recipe";
import type { BuriedBoxFace } from "./buried-box-face";

const solidBox = (part: BuildingPart) => part.shape === "box" &&
  !part.rotation?.some(turn => Math.abs(turn) > 1e-8) && !part.topScale &&
  !part.stock && !part.windowShadow && !part.interiorFloorFaces && !part.workyardAssembly &&
  ["plaster", "stone", "cut-stone", "paint", "wood", "planks"].includes(part.surface);

/** Fund the actual window reveals by dropping only box caps completely inside another static box.
 * Exterior faces, aperture reveals and room-facing surfaces stay unchanged. Never apply to stocks,
 * moving equipment, curved/tapered primitives, or an open floor's sides-only representation.
 */
export const withChineseBuriedWallFaces = (parts: BuildingPart[]): BuildingPart[] => {
  const solids = parts.filter(solidBox);
  return parts.map(part => {
    if (!solidBox(part) || part.stage < 1 || part.stage > 2) return part;
    const faces = new Set<BuriedBoxFace>(part.buriedBoxFaces);
    for (const axis of [0, 1, 2] as const) for (const sign of [-1, 1]) {
      const plane = part.position[axis] + sign * part.size[axis] / 2;
      const covered = solids.some(other => other !== part && [0, 1, 2].every(component => {
        const low = component === axis ? plane : part.position[component]! - part.size[component]! / 2;
        const high = component === axis ? plane : part.position[component]! + part.size[component]! / 2;
        return low >= other.position[component]! - other.size[component]! / 2 - 1e-8 &&
          high <= other.position[component]! + other.size[component]! / 2 + 1e-8 &&
          (component !== axis || sign * (other.position[axis] - plane) + other.size[axis] / 2 > 1e-8);
      }));
      if (covered) faces.add(`${sign < 0 ? "-" : "+"}${"xyz"[axis]}` as BuriedBoxFace);
    }
    return faces.size ? { ...part, buriedBoxFaces: [...faces] } : part;
  });
};

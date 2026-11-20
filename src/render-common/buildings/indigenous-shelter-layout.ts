import type { BuildingRecipe } from "./building-recipe";
import type { NationBody, RoofEnvelope } from "./nation-kit-classify";

const PRESERVED = new Set([1, 10, 11, 12, 13, 17, 18, 19, 20, 36]);
const CLEAR_EQUIPMENT = new Map([[23, .34], [25, .38], [26, .43], [32, .35], [33, .38], [34, .34]]);

/** The door identifies the occupied lodge; subsidiary roofs become open craft yards. */
export const indigenousShelterLayout = (body: NationBody, merged: NationBody | null,
  original: BuildingRecipe, id: number): { shelter: NationBody | null; yards: RoofEnvelope[] } => {
  if (id === 31 && merged) {
    // The windshaft is a full soft textile tower; its rotor turns just beyond the front skirt.
    const centre = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
    return { shelter: { ...merged, roofs: [{ min: [centre - .56, 0, -.46],
      max: [centre + .56, 2.40, .46] }] }, yards: [] };
  }
  if (id === 20 && merged) {
    // The original seedlings are inventory contacts: pull the textile skirt away, never move stock.
    const roof = merged.roofs[0]!;
    return { shelter: { ...merged, roofs: [{ ...roof, max: [.80, roof.max[1], roof.max[2]] }] }, yards: [] };
  }
  if (PRESERVED.has(id) || !merged) return { shelter: merged, yards: [] };
  const roofs = body.roofs.filter(roof => roof.min[1] < 2);
  const centre = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  const eligible = roofs.filter(roof => centre > roof.min[0] && centre < roof.max[0]);
  const ranked = [...(eligible.length ? eligible : roofs)].sort((a, b) =>
    (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) -
    (a.max[0] - a.min[0]) * (a.max[2] - a.min[2]));
  const primary = ranked[0];
  if (!primary) return { shelter: merged, yards: [] };
  const roof: RoofEnvelope = { min: [...primary.min], max: [...primary.max] };
  const clearance = CLEAR_EQUIPMENT.get(id);
  if (clearance && original.mechanism[0] > centre + .3)
    roof.max[0] = Math.max(centre + .34, Math.min(roof.max[0], original.mechanism[0] - clearance));
  return { shelter: { ...body, roofs: [roof] }, yards: roofs.filter(other => other !== primary) };
};

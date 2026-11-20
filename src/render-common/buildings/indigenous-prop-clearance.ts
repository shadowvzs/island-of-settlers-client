import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { indigenousRoofHeight } from "./indigenous-roof-profile";
import { rotateByEuler } from "./recipe-rotation";

/** Original wall furniture cannot survive where the replacement is a taut membrane. */
export const clearIndigenousInheritedProps = (parts: BuildingPart[], inherited: ReadonlySet<BuildingPart>) => {
  const skins = parts.filter(part => part.shape === "indigenous-roof" && part.indigenousEntrance);
  const filtered = parts.filter(part => {
    if (part.stock || !inherited.has(part)) return true;
    if (["wood", "planks"].includes(part.surface) && part.position[1] > .8 &&
      part.size[0] > .6 && part.size[2] > .4 && part.size[1] < .15) return false;
    if (part.occupationSign || part.roofSupport) return false;
    if (part.surface === "dark" && part.position[1] > 1.1 && part.size[1] < .13) return false;
    if (!["wood", "planks", "bark", "paint", "dark", "iron", "leaf"].includes(part.surface)) return true;
    const points: Point3[] = [[...part.position]];
    for (const sx of [-.5, .5]) for (const sy of [-.5, .5]) for (const sz of [-.5, .5]) {
      const vertex = rotateByEuler([sx * part.size[0], sy * part.size[1], sz * part.size[2]],
        part.rotation ?? [0, 0, 0]);
      points.push([part.position[0] + vertex[0], part.position[1] + vertex[1], part.position[2] + vertex[2]]);
    }
    for (const skin of skins) {
      let below = false, above = false, overMembrane = false;
      for (const [x, y, z] of points) {
        const u = (x - skin.position[0]) / skin.size[0], v = (z - skin.position[2]) / skin.size[2];
        const radius = skin.indigenousRoof === "tipi" ? Math.hypot(u * 2, v * 2) :
          Math.hypot(u * 2, Math.max(0, Math.abs(v) * 2 - .4) / .6);
        if (radius >= .995) { above = true; continue; }
        overMembrane = true;
        const ceiling = skin.position[1] + skin.size[1] *
          indigenousRoofHeight(skin.indigenousRoof ?? "tipi", u, v, skin.indigenousEntrance);
        if (y < ceiling - .035) below = true;
        else if (y > ceiling + .015) above = true;
        else return false;
      }
      if (below && above) return false;
      // A grounded external workbench may lie above the cone within its ground projection.
      // Keep its complete tagged assembly; unsupported former wall furniture is still rejected below.
      if(overMembrane&&above&&!below&&part.workyardAssembly!=="tannery-table")return false;
    }
    return true;
  });
  // Props originally bolted to removed walls need actual support. Fabric is not a shelf.
  const bounds = new Map(filtered.map(part => [part, getRomanPartBounds(part)]));
  const standing = filtered.filter(part => !inherited.has(part) && part.shape !== "indigenous-roof" ||
    bounds.get(part)!.min[1] < .035);
  const pending = filtered.filter(part => inherited.has(part) && !standing.includes(part));
  const touch = (a: BuildingPart, b: BuildingPart) => [0, 1, 2].every(axis =>
    bounds.get(a)!.min[axis]! < bounds.get(b)!.max[axis]! + .018 &&
    bounds.get(a)!.max[axis]! > bounds.get(b)!.min[axis]! - .018);
  for (let next = pending.filter(part => standing.some(support => touch(part, support)));
    next.length; next = pending.filter(part => standing.some(support => touch(part, support))))
    for (const part of next) { pending.splice(pending.indexOf(part), 1); standing.push(part); }
  return filtered.filter(part => !pending.includes(part));
};

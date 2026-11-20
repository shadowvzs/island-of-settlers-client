import { getBuildingInteriorFloorSites } from "./building-interior-floors";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";

interface RoomFloor { position: Point3; size: [number, number]; profile?: "rectangle" | "ellipse" }

const inside = (room: RoomFloor, x: number, z: number) =>
  Math.abs(x - room.position[0]) < room.size[0] / 2 - .025 &&
  Math.abs(z - room.position[2]) < room.size[1] / 2 - .025;

const roomSkins = (recipe: BuildingRecipe) => recipe.parts.filter(part => !part.stock && !part.rotation &&
  part.shape === "indigenous-roof" && part.indigenousEntrance &&
  ["tipi", "earth", "framed"].includes(part.indigenousRoof ?? "") &&
  Math.abs(part.position[1] - part.size[1] / 2) < .025);

/** A physical room slab may be a thick bearing rather than a finish; it is never recoloured here. */
const floorBearings = (recipe: BuildingRecipe, typeId: number): RoomFloor[] => {
  const sites: RoomFloor[] = getBuildingInteriorFloorSites(recipe, typeId);
  for (const part of recipe.parts) {
    if (part.stock || part.workyardAssembly || part.rotation || part.stage !== 0 ||
      !["box", "bevel-box"].includes(part.shape) || part.size[1] > .16 ||
      Math.min(part.size[0], part.size[2]) <= .4 || part.position[1] - part.size[1] / 2 > .001) continue;
    sites.push({ position: [part.position[0] + (part.topOffset?.[0] ?? 0),
      part.position[1] + part.size[1] / 2, part.position[2] + (part.topOffset?.[2] ?? 0)],
    size: [part.size[0] * (part.topScale?.[0] ?? 1), part.size[2] * (part.topScale?.[2] ?? 1)] });
  }
  return sites;
};

const hideFor = (room: RoomFloor, bearings: readonly RoomFloor[]): BuildingPart | undefined => {
  const [x, base, z] = room.position;
  const support = bearings.filter(site => inside(site, x, z) && site.position[1] <= base + .16)
    .sort((a, b) => b.position[1] - a.position[1])[0];
  let width = Math.min(1.4, room.size[0] * .58), depth = Math.min(1.8, room.size[1] * .64);
  if (support) {
    const fraction = support.profile === "ellipse" ? .70 : 1;
    width = Math.min(width, support.size[0] * fraction - Math.abs(x - support.position[0]) * 2 - .08);
    depth = Math.min(depth, support.size[1] * fraction - Math.abs(z - support.position[2]) * 2 - .08);
  }
  if (width < .35 || depth < .45) return;
  const bearing = support?.position[1] ?? base;
  return { architecture: true, shape: "indigenous-floor-hide", surface: "hide", stage: 4,
    position: [x, bearing + .007, z], size: [width, .014, depth] };
};

/** Grounded cloth rooms or actual enclosed reed rooms only; open work bays and horse floors are excluded. */
export const withIndigenousFloorHides = (recipe: BuildingRecipe, typeId: number): BuildingRecipe => {
  if (recipe.parts.some(part => part.shape === "indigenous-floor-hide")) return recipe;
  const skins = roomSkins(recipe), bearings = floorBearings(recipe, typeId);
  const rooms: RoomFloor[] = skins.map(part => ({ position: [part.position[0], 0, part.position[2]],
    size: [part.size[0], part.size[2]] }));
  if ([19, 20, 41, 43, 45, 47, 49, 51, 53, 55].includes(typeId) &&
    recipe.parts.some(part => part.architecture && ["indigenous-rubble", "planks"].includes(part.surface) &&
      part.size[1] > .3)) rooms.push(...getBuildingInteriorFloorSites(recipe, typeId));
  if (typeId === 7 && recipe.parts.some(part => part.shape === "indigenous-palm-roof")) {
    const floor = recipe.parts.find(part => !part.stock && part.shape === "cylinder" && part.stage === 1 &&
      part.surface === "straw" && part.size[1] <= .04 &&
      Math.abs(part.position[1] - part.size[1] / 2) < .001);
    if (floor) {
      const hall: RoomFloor = { position: [floor.position[0], floor.position[1] + floor.size[1] / 2,
        floor.position[2]], size: [floor.size[0], floor.size[2]], profile: "ellipse" };
      rooms.push(hall); bearings.push(hall);
    }
  }
  const reedWalls = recipe.parts.filter(part => part.shape === "bevel-box" && part.surface === "cloth-reeds" &&
    !part.stock && part.size[1] > .3);
  if (!rooms.length && reedWalls.length >= 3) for (const site of getBuildingInteriorFloorSites(recipe, typeId)) {
    const enclosed = reedWalls.filter(wall =>
      Math.abs(wall.position[0] - site.position[0]) < site.size[0] / 2 + .16 &&
      Math.abs(wall.position[2] - site.position[2]) < site.size[1] / 2 + .16);
    if (enclosed.length >= 3) rooms.push({ position: site.position, size: site.size });
  }
  const hides = rooms.map(room => hideFor(room, bearings)).filter((part): part is BuildingPart => Boolean(part));
  if (!hides.length) return recipe;
  return { ...recipe, parts: [...recipe.parts, ...hides] };
};

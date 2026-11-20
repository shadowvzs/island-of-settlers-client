import type { BuildingPart } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { MAYA_CIVIC_IDS, MAYA_PLASTER, MAYA_STONE, MAYA_WOOD,
  type MayaBuildingKit, mayaWallFace } from "./maya-building-kit";
import { addMayaCarvedMotif, mayaOccupationCarving } from "./maya-carved-motifs";
import type { NationBody, WallRun } from "./nation-kit-classify";
import { alongWall, bodyCenter, doorGapOf, onWall, timberDoorFrame, wallNormal } from "./nation-kit-parts";

/** Lime-plastered stone civic buildings and timber/adobe working houses share the original openings. */
export const addMayaWall = (kit: MayaBuildingKit, wall: WallRun) => {
  const { add, centre, definition, detailed } = kit;
  const civic = MAYA_CIVIC_IDS.has(definition.id);
  const thickness = wallNormal(wall, centre).thickness;
  add({ position: onWall(wall, centre, .5, wall.base + wall.height / 2), shape: "box",
    size: alongWall(wall, wall.length, wall.height, thickness), stage: 1,
    surface: "plaster", tint: MAYA_PLASTER });
  if (!civic) {
    const count = Math.max(1, Math.round(wall.length / .45));
    for (let post = 0; post <= count; post++) add({
      position: onWall(wall, centre, .025 + .95 * post / count, wall.base + wall.height / 2),
      radialSegments: detailed ? 8 : 4, shape: "cylinder", size: [.05, wall.height + .015, .05],
      stage: 2, surface: "wood", tint: MAYA_WOOD
    });
    add({ position: onWall(wall, centre, .5, wall.base + wall.height - .035), shape: "box",
      size: alongWall(wall, wall.length, .07, thickness + .005), stage: 2, surface: "wood", tint: MAYA_WOOD });
  }

};

export const addMayaDoor = (kit: MayaBuildingKit) => {
  const { add, body, definition, original } = kit;
  if (!body.walls.length) return;
  const door = doorGapOf(original);
  if (!MAYA_CIVIC_IDS.has(definition.id)) {
    timberDoorFrame(add, door, "wood");
    if (kit.detailed) addMayaCarvedMotif(add, mayaOccupationCarving(definition.id),
      [(door.left + door.right) / 2, door.top + .075, door.z + .037],
      Math.min(.27, door.right - door.left), .105, .022);
    return;
  }
  const width = door.right - door.left;
  for (const side of [-1, 1]) add({ position: [side < 0 ? door.left - .055 : door.right + .055,
    door.top / 2 + .035, door.z], shape: "bevel-box", size: [.11, door.top + .07, .13],
    stage: 2, surface: "cut-stone", tint: MAYA_STONE });
  add({ position: [(door.left + door.right) / 2, door.top + .105, door.z], shape: "bevel-box",
    size: [width + .3, .15, .17], stage: 2, surface: "cut-stone", tint: MAYA_STONE });
};

/** Materials are architectural interpretations; tools, inventories and mechanisms stay authored. */
export const mayaKeptPart = (part: BuildingPart, gildedColumns = false): BuildingPart => {
  if (part.stock) return part;
  if (part.shape === "civic-column-shaft" || part.civicPorticoColumn) {
    if (gildedColumns) return { ...part, surface: "gold", tint: [.91, .76, .42], mayaGildedColumn: true };
    return { ...part, surface: "wood", tint: MAYA_WOOD };
  }
  if (part.surface === "mosaic") return { ...part, surface: "cut-stone", tint: MAYA_STONE };
  if (["stone", "cut-stone", "plaster"].includes(part.surface))
    return { ...part, surface: "plaster", tint: MAYA_PLASTER, worldUv: 1 };
  return part;
};

/** Interior furniture touching an outer wall must not leave an exactly coplanar exterior face. */
export const settleMayaInteriorFurniture = (part: BuildingPart, body: NationBody): BuildingPart => {
  if (part.stock || part.shape !== "box" || part.rotation || part.stage < 3 ||
    part.surface !== "wood" || part.size[1] < .15) return part;
  const centre = bodyCenter(body.walls), bounds = getRomanPartBounds(part);
  for (const wall of body.walls) {
    const { axis, face, sign } = mayaWallFace(wall, centre);
    if (part.position[1] < wall.base || part.position[1] > wall.base + wall.height ||
      part.position[wall.along] < wall.min[wall.along] || part.position[wall.along] > wall.max[wall.along]) continue;
    const edge = sign > 0 ? bounds.max[axis] : bounds.min[axis];
    if (Math.abs(edge - face) > .001 || sign * (part.position[axis] - face) >= 0) continue;
    const position: BuildingPart["position"] = [...part.position];
    position[axis] -= sign * .012;
    return { ...part, position };
  }
  return part;
};

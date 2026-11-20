import type { RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";
import { ROAD_DECORATIONS } from "../shared/settlement/road-decoration-catalog";
import type { BuildingPart, Point3 } from "./buildings/building-recipe";
import { chineseRoadPailouParts } from "./road-decoration-eastern";
import { japaneseRoadToriiParts } from "./road-decoration-japanese";
import { roadDecorationAdder, type RoadDecorationPart, type RoadDecorationRecipe } from "./road-decoration-recipe";

export type HangingLanternNation = "japanese" | "chinese";

export interface RoadLanternSuspension {
  bearing: Point3;
  hook: Point3;
  lanternTop: Point3;
  lantern: BuildingPart;
}

/** Private additive studies: no inventory IDs, offers or placement rules are registered here. */
export const createHangingLanternRoadRecipe = (nation: HangingLanternNation, detailed: boolean) => {
  const originalId = nation === "japanese" ? "japanese-timber-torii" : "chinese-pailou";
  const original = ROAD_DECORATIONS.find(definition => definition.id === originalId)!;
  const frameParts = nation === "japanese"
    ? japaneseRoadToriiParts(original, detailed) : chineseRoadPailouParts(original, detailed);
  // Find the real lower crossbeam, retaining its exact bearing height and width in both LODs.
  const beam = frameParts.find((part): part is BuildingPart => !("kind" in part) &&
    part.shape === "bevel-box" && part.size[0] > original.opening!.width && part.size[1] === .17)!;
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts);
  const suspensions: RoadLanternSuspension[] = [];
  const postOffset = nation === "japanese" ? .24 : .25;
  const height = nation === "japanese" ? .34 : .44;
  const width = nation === "japanese" ? .23 : .26;
  for (const side of [-1, 1]) {
    const x = side * (original.opening!.width / 2 + postOffset), y = beam.position[1];
    const bearing: Point3 = [x, y, 0], hook: Point3 = [x, y, .38];
    // A mortised arm enters the original crossbeam. The diagonal bears on the actual post.
    add({ shape: "bevel-box", position: [x, y, .19], size: [.055, .065, .44],
      surface: "wood", tint: [.62, .45, .27] });
    const braceRise = .23, braceRun = .30;
    add({ shape: "box", position: [x, y - braceRise / 2, braceRun / 2],
      rotation: [Math.atan2(braceRun, braceRise), 0, 0],
      size: [.035, Math.hypot(braceRise, braceRun) + .012, .035],
      surface: "wood", tint: [.62, .45, .27] });
    const drop = nation === "japanese" ? .09 : .13;
    const lanternTop: Point3 = [x, y - drop, hook[2]];
    add({ shape: "cylinder", position: [x, y - drop / 2, hook[2]],
      size: [.009, drop + .018, .009], radialSegments: detailed ? 6 : 4,
      surface: "iron", tint: [.24, .21, .17] });
    const lantern: BuildingPart = { shape: nation === "japanese" ? "paper-lantern" : "chinese-lantern",
      position: [x, lanternTop[1] - height / 2, lanternTop[2]], size: [width, height, width],
      stage: 4, compactGeometry: true, surface: "paint" };
    parts.push(lantern);
    suspensions.push({ bearing, hook, lanternTop, lantern });
  }
  const definition: RoadDecorationDefinition = { ...original, id: `${originalId}-hanging-study` };
  const fittings: RoadDecorationRecipe = { definition, parts, wind: 0 };
  const frame: RoadDecorationRecipe = { definition, parts: frameParts, wind: 0 };
  return { definition, fittings, frame, suspensions };
};

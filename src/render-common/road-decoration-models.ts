import type { RoadDecorationDefinition, RoadDecorationStoneFamily } from "../shared/settlement/road-decoration-catalog";
import { createClimberRoadRecipe } from "./road-decoration-climbers";
import { chineseRoadPailouParts, nubianRoadPortalParts, persianRoadPortalParts } from "./road-decoration-eastern";
import { createHangingLanternRoadRecipe } from "./road-decoration-hanging-lanterns";
import { japaneseRoadToriiParts, roadsideStoneLanternParts } from "./road-decoration-japanese";
import { japaneseBambooStandParts } from "./plants/japanese-bamboo-stand";
import { mayaRoadPortalParts } from "./road-decoration-maya";
import { createPlantDecorationRecipe } from "./road-decoration-plants";
import type { RoadDecorationRecipe } from "./road-decoration-recipe";
import { romanRoadArchParts } from "./road-decoration-roman";
import { floweringRoadPergolaParts, roadsideFlowerPotParts, vikingRoadPortalParts } from "./road-decoration-timber";
import { createWoodenRoadLanternRecipe } from "./road-decoration-wood-lanterns";
import { createWisteriaHeroFrame } from "./wisteria-hero-frame";

/** Staged content only: unsupported models cannot accidentally produce an empty purchasable object. */
export const createRoadDecorationRecipe = (definition: RoadDecorationDefinition,
  detailed: boolean, stoneFamily: RoadDecorationStoneFamily | undefined = definition.stone?.defaultFamily): RoadDecorationRecipe => {
  if (stoneFamily && !definition.stone?.families.includes(stoneFamily))
    throw new Error(`Unsupported stone finish for ${definition.id}: ${stoneFamily}`);
  const { family } = definition;
  if (family === "roman-column") return { definition, parts: [{
    kind: "roman-column", columnOrder: definition.variant as 0 | 1, position: [0, 0, 0],
    size: [.92, definition.variant === 1 ? 3.36 : 3.20, .92], surface: "cut-stone", tint: [1, 1, 1]
  }], wind: 0, stoneFamily };
  if (family === "wooden-lantern") {
    if (definition.nation !== "japanese" && definition.nation !== "chinese")
      throw new Error(`No wooden lantern for ${definition.nation}`);
    return { ...createWoodenRoadLanternRecipe(definition.nation, detailed), definition };
  }
  if (definition.hangingLanterns) {
    if (definition.nation !== "japanese" && definition.nation !== "chinese")
      throw new Error(`No hanging-lantern portal for ${definition.nation}`);
    const recipe = createHangingLanternRoadRecipe(definition.nation, detailed);
    return { definition, parts: [...recipe.frame.parts, ...recipe.fittings.parts], wind: 0 };
  }
  // Botanical surfaces are asynchronously supplied by the canonical production factory.
  // The pure recipe remains the exact supported architectural frame, never an unrelated proxy plant.
  if (definition.climber) return { definition, parts: createClimberRoadRecipe(definition.climber, detailed), wind: 0 };
  if (definition.wisteriaFrame) return { definition,
    parts: createWisteriaHeroFrame(definition.wisteriaFrame, !detailed), wind: 0 };
  if (definition.buildingBamboo) return { definition, parts: japaneseBambooStandParts(detailed), wind: 0 };
  if (family === "plant" || family === "tree") return { definition,
    parts: createPlantDecorationRecipe(definition, detailed).parts, wind: 0 };
  if (family === "roman-arch") return { definition, parts: romanRoadArchParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "torii") return { definition, parts: japaneseRoadToriiParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "stone-lantern") return { definition, parts: roadsideStoneLanternParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "maya-portal") return { definition, parts: mayaRoadPortalParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "pailou") return { definition, parts: chineseRoadPailouParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "persian-portal") return { definition, parts: persianRoadPortalParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "nubian-portal") return { definition, parts: nubianRoadPortalParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "timber-portal") return { definition, parts: vikingRoadPortalParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "pergola") return { definition, parts: floweringRoadPergolaParts(definition, detailed), wind: 0, stoneFamily };
  if (family === "flower-pot") return { definition, parts: roadsideFlowerPotParts(definition, detailed), wind: 0, stoneFamily };
  throw new Error(`Road-decoration model is not yet authored: ${definition.id}`);
};

export { roadDecorationModelReady } from "./road-decoration-readiness";

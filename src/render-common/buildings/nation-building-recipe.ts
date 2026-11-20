import {
  COMMANDER_LODGE_TYPE_ID, HARBOUR_TYPE_ID, HEADQUARTERS_TYPE_ID, MILL_TYPE_ID, TAVERN_TYPE_ID, WOODCUTTER_TYPE_ID
} from "../../shared/settlement/building-type-ids";
import type { BuildingFirstNation, SettlerNation, WorkerNation as PlayerNation } from "../workers/worker-unit";
import { advancedMaterialBase, advancedMaterialBaseDefinition, withAdvancedMaterialStocks } from "./advanced-material-buildings";
import type { BuildingDefinition } from "./building-catalog";
import { type BuildingPart, type BuildingRecipe,createRomanBuildingRecipe } from "./building-recipe";
import { getRomanRecipeBounds } from "./building-recipe-fit";
import { withRecipeTextureScale, withRomanMasonryTextureScale } from "./building-texture-scale";
import { withBuildingWindowFinish } from "./building-window-finish";
import { withBuildingWindowShadows } from "./building-window-shadows";
import { createCatapultTowerRecipe } from "./catapult-tower-recipe";
import { createChineseBuildingRecipe, withChinesePlasterPalette } from "./chinese-building-recipe";
import { clearChineseWindowMembers } from "./chinese-window-clearance";
import { decorateExpansionDrinkMaker } from "./expansion-drink-makers";
import { decorateExpansionDrinkProducer } from "./expansion-drink-producers";
import { decorateExpansionDrinkSign } from "./expansion-drink-signs";
import { withExpansionLodgeStandard } from "./expansion-lodge-standards";
import { createNationalFlaxWeaverRecipe } from "./flax-weaver-designs";
import { withHarbourTowerRoofOpenings } from "./harbour-tower-clearance";
import { withIndigenousBuildingPaint } from "./indigenous-building-paint";
import { createIndigenousBuildingRecipe } from "./indigenous-building-recipe";
import { withIndigenousTextileStyle } from "./indigenous-textile-styles";
import { createJapaneseBambooForester } from "./japanese-bamboo-forester";
import { clearJapaneseWorkshopWindows, JAPANESE_OPEN_WORKSHOPS } from "./japanese-workshop-windows";
import type { BuildingLevel } from "./levels/building-level";
import { findBodyLift, liftBuildingBody, RAISED_BAND_LEVEL } from "./levels/level-lift";
import { withLookoutSpyglassSign } from "./lookout-spyglass-sign";
import { withMayaStonePalette } from "./maya-building-kit";
import { createMayaBuildingRecipe } from "./maya-building-recipe";
import { withMayaMasonryLayout } from "./maya-masonry-layout";
import { MAYA_PLANT_ROOF_SURFACES, mayaRoofPlantStyle } from "./maya-plant-roof-profile";
import { createNationKitRecipe } from "./nation-architecture-kit";
import { applyCommanderLodgeDesign } from "./nation-commander-lodge-designs";
import { applyNationDrinkDesign } from "./nation-drink-designs";
import { withRoofFlagMount } from "./nation-flag-roof-mount";
import { addJapaneseDecor } from "./nation-japanese-decor";
import { createJapanesePagodaRecipe } from "./nation-japanese-headquarters";
import { createNationMillRecipe } from "./nation-mill-designs";
import { createResidenceSite, RESIDENCE_IDS } from "./nation-residence-kit";
import { createJapaneseResidence } from "./nation-residences-japanese";
import { createNubianResidence } from "./nation-residences-nubian";
import { createVikingResidence } from "./nation-residences-viking";
import { applyNationTavernDesign } from "./nation-tavern-designs";
import { addVikingDecor } from "./nation-viking-decor";
import { createNationWellRecipe } from "./nation-well-designs";
import { createNationWoodcutterRecipe } from "./nation-woodcutter-designs";
import { withNationDecorativeRacks } from "./national-decorative-weapons";
import { withNationalInteriorFloors } from "./national-interior-floors";
import { withNationalYardDecoration } from "./national-yard-decoration";
import { addNubianDecor } from "./nubian-decor";
import { createPersianBuildingRecipe } from "./persian-building-recipe";
import { applyRoofReviewPrototype } from "./roof-review-prototype";
import { createVikingGreatHallRecipe, isVikingGreatHall } from "./viking-headquarters";

/** Wall and terrace surfaces drawn to scale (bricks, boards, render), one tile per recipe unit. */
const NATION_TEXTURE_SCALE = {
  roundSurfaces: new Set<BuildingPart["surface"]>(["plaster"]),
  surfaces: new Set<BuildingPart["surface"]>(["plaster", "planks", "roof"]),
  tilesPerUnit: 1
};

/** Interior floors: the Roman mosaic becomes boards in timber halls and paving in mud-brick houses. */
const NATION_FLOOR: Readonly<Record<Exclude<SettlerNation, "roman">, BuildingPart["surface"]>> = {
  japanese: "planks", nubian: "stone", viking: "planks"
};

const withNationFloors = (parts: BuildingPart[], nation: Exclude<SettlerNation, "roman">) =>
  parts.map(part => part.surface === "mosaic" ? { ...part, surface: NATION_FLOOR[nation], worldUv: 1 } : part);

/** Each nation's own residences (small, medium, big) on the Roman plots and doors. */
const RESIDENCE_DESIGNS = {
  japanese: createJapaneseResidence, nubian: createNubianResidence, viking: createVikingResidence
} as const;

/** Buildings with their own nation design; every other building is rebuilt by the architecture kit. */
const createDesignedRecipe = (
  original: BuildingRecipe, definition: BuildingDefinition, nation: Exclude<SettlerNation, "roman">, detailed: boolean
) => {
  if (definition.id === 35) return createNationWellRecipe(original, nation, detailed);
  const flaxWeaver = createNationalFlaxWeaverRecipe(original, definition, nation, detailed);
  if (flaxWeaver) return flaxWeaver;
  if (definition.id === WOODCUTTER_TYPE_ID) return createNationWoodcutterRecipe(original, nation, detailed);
  if (definition.id === MILL_TYPE_ID) return createNationMillRecipe(original, definition, nation, detailed);
  if (nation === "japanese" && definition.id === HEADQUARTERS_TYPE_ID)
    return createJapanesePagodaRecipe(original, definition, detailed);
  if (nation === "viking" && isVikingGreatHall(definition.id))
    return createVikingGreatHallRecipe(original, definition, detailed);
  if (RESIDENCE_IDS.includes(definition.id))
    return RESIDENCE_DESIGNS[nation](original, createResidenceSite(original, definition, detailed));
  return null;
};

/**
 * Decor on the finished building: Nubian household decor on the walls (textiles, jars, hats,
 * shields, skulls); Japanese lanterns, bamboo, fans, shrine details and dragons.
 */
const addNationDecor = (recipe: BuildingRecipe, definition: BuildingDefinition, nation: Exclude<SettlerNation, "roman">,
  detailed: boolean, limit: ReturnType<typeof getRomanRecipeBounds>) => {
  if (nation === "nubian") return addNubianDecor(recipe, definition, detailed, limit);
  if (nation === "japanese") return addJapaneseDecor(recipe, definition, detailed, limit);
  return recipe;
};

/** Recipe-unit texture scale of a nation's walls and roofs (the Roman masonry scale for Rome). */
export const withNationTextureScale = (parts: BuildingPart[], nation: PlayerNation) => {
  const surfaced = parts.map(part => part.shape === "bamboo-leaves" ? { ...part, surface: "leaf" as const } : part);
  return nation === "roman" ? withRomanMasonryTextureScale(surfaced) : withRecipeTextureScale(surfaced, NATION_TEXTURE_SCALE);
};

/** National production yards replace the inherited Roman occupation props. */
const finishExpansionRecipe = (recipe: BuildingRecipe, definition: BuildingDefinition,
  nation: BuildingFirstNation, detailed: boolean) => {
  const producer = decorateExpansionDrinkProducer(recipe, definition.id, nation, detailed);
  const maker = decorateExpansionDrinkMaker(producer, definition.id, nation, detailed);
  const signed = decorateExpansionDrinkSign(maker, definition.id, nation, detailed);
  const built = withNationDecorativeRacks(signed, nation, detailed);
  const furnished = withNationalYardDecoration(built, definition, nation, detailed);
  const painted = nation === "indigenous" ? withIndigenousTextileStyle(furnished, definition.id) : furnished;
  const standard = definition.id === COMMANDER_LODGE_TYPE_ID
    ? withExpansionLodgeStandard(painted, nation, detailed) : painted;
  return { ...standard, parts: withNationTextureScale(standard.parts, nation) };
};

/** The Roman plan a nation builds on; from level 3 its walls rise by the raised band. */
export const createLevelPlanRecipe = (definition: BuildingDefinition, detailed: boolean, level: BuildingLevel,
  occupationRoofs = false) => {
  const plan = createRomanBuildingRecipe(definition, detailed, occupationRoofs);
  if (level < RAISED_BAND_LEVEL) return { lift: null, plan };
  const lift = findBodyLift(definition, occupationRoofs ? createRomanBuildingRecipe(definition, detailed, false) : plan);
  return { lift, plan: lift ? liftBuildingBody(plan, lift) : plan };
};

/**
 * Architecture changes on and above the walls; all gameplay/door/stock anchors remain canonical.
 * `level` (1-5) only raises the walls (level 3+); the level additions are dressed on afterwards.
 */
const createUnfinishedNationBuildingRecipe = (
  definition: BuildingDefinition, nation: PlayerNation, detailed = true, level: BuildingLevel = 1
): BuildingRecipe => {
  if (definition.id === 16) return createCatapultTowerRecipe(nation, detailed);
  const base = advancedMaterialBaseDefinition(definition);
  if (base !== definition) {
    const specialist = withAdvancedMaterialStocks(createUnfinishedNationBuildingRecipe(base, nation, detailed, level),
      definition.id, detailed, nation !== "indigenous" && nation !== "japanese");
    if (nation === "maya") return withMayaStonePalette(specialist);
    return nation === "chinese" ? withChinesePlasterPalette(specialist) : specialist;
  }
  const original = createLevelPlanRecipe(definition, detailed, level, nation === "roman").plan;
  if(nation === "japanese" && definition.id === 20) return createJapaneseBambooForester(original,detailed,level);
  if (nation === "chinese") {
    const built = createChineseBuildingRecipe(original, definition, detailed);
    return finishExpansionRecipe(built, definition, nation, detailed);
  }
  if (nation === "persian") {
    const built = createPersianBuildingRecipe(original, definition, detailed);
    return finishExpansionRecipe(built, definition, nation, detailed);
  }
  if (nation === "maya") {
    const built = createMayaBuildingRecipe(original, definition, detailed);
    return finishExpansionRecipe(built, definition, nation, detailed);
  }
  if (nation === "indigenous") {
    const built = createIndigenousBuildingRecipe(original, definition, detailed);
    return finishExpansionRecipe(built, definition, nation, detailed);
  }
  if (definition.id === COMMANDER_LODGE_TYPE_ID) {
    const shell = nation === "roman" ? original : createNationKitRecipe(original, definition, nation, detailed);
    const lodge = applyCommanderLodgeDesign(shell, nation, detailed);
    return { ...lodge, parts: withNationTextureScale(lodge.parts, nation) };
  }
  if (nation === "roman") return original;
  const designed = createDesignedRecipe(original, definition, nation, detailed);
  const kit = designed ?? createNationKitRecipe(original, definition, nation, detailed);
  const furnished = definition.id === TAVERN_TYPE_ID ? applyNationTavernDesign(kit, nation, detailed) : kit;
  const built = applyNationDrinkDesign(furnished, definition.id, nation, detailed);
  const recipe = addNationDecor(built, definition, nation, detailed, getRomanRecipeBounds(definition, original));
  // Viking ornaments: the HQ ridge flag, weapon trophies, helmets and longship carvings.
  const decorated = nation === "viking"
    ? addVikingDecor(recipe, original, definition, detailed, getRomanRecipeBounds(definition, original)) : recipe;
  const mounted = [0, 1, 2].includes(definition.id) && (nation === "viking" || nation === "nubian")
    ? withRoofFlagMount(decorated, detailed) : decorated;
  const nationalRacks = withNationDecorativeRacks(mounted, nation, detailed);
  const parts = withNationFloors(nationalRacks.parts, nation);
  return { ...decorated, parts: withRecipeTextureScale(parts, NATION_TEXTURE_SCALE) };
};

/** Apply finish once, after every national structure and tier-copy dispatch has completed. */
export const createNationBuildingRecipe = (
  definition: BuildingDefinition, nation: PlayerNation, detailed = true, level: BuildingLevel = 1
): BuildingRecipe => {
  const unfinished = createUnfinishedNationBuildingRecipe(definition, nation, detailed, level);
  const baseId = advancedMaterialBase(definition.id) ?? definition.id;
  // Owner scope override: retain original national covers outside Maya/Indigenous and two
  // Roman timber workshops. Research/prototype vocabulary never overrides this production gate.
  const replaceMainCover = nation === "maya" || nation === "indigenous" ||
    nation === "roman" && [17, 20].includes(definition.id);
  const redesigned = replaceMainCover
    ? applyRoofReviewPrototype(unfinished, baseId, nation, detailed, 1).recipe : unfinished;
  const recipe = { ...redesigned, parts: redesigned.parts.map(part => {
    if (part.shape !== "occupation-roof") return part;
    if (part.surface === "palm-thatch") return { ...part, plantRoofStyle: "palm" as const };
    if (!["straw", "roof-thatch"].includes(part.surface)) return part;
    const plantRoofStyle = nation === "maya" ? mayaRoofPlantStyle(baseId) : "reed" as const;
    const surface = nation === "maya" ? MAYA_PLANT_ROOF_SURFACES[plantRoofStyle] : part.surface;
    return { ...part, plantRoofStyle, surface };
  }) };
  const surfaced=nation === "japanese" && [4,9].includes(definition.id)
    ? {...recipe,parts:recipe.parts.map(part=>part.surface === "plaster" ?
      {...part,surface:"japanese-white-stone" as const,worldUv:1}:part)}:recipe;
  const finished = withIndigenousBuildingPaint(withLookoutSpyglassSign(withBuildingWindowShadows(withBuildingWindowFinish(
    nation === "maya" ? withMayaMasonryLayout(surfaced) : surfaced, nation)), definition.id, nation),definition.id,nation);
  const opened = nation === "japanese" && (definition.id === 0 || JAPANESE_OPEN_WORKSHOPS.includes(definition.id))
    ? clearJapaneseWorkshopWindows(finished) : finished;
  const furnished = withNationalInteriorFloors(nation === "chinese" ? clearChineseWindowMembers(opened) : opened,
    nation, definition.id, detailed);
  return nation === "japanese" && definition.id === HARBOUR_TYPE_ID
    ? { ...furnished, parts: withHarbourTowerRoofOpenings(furnished.parts) } : furnished;
};

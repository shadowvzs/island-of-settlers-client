import type { WorkerNation } from "../../workers/worker-unit";
import { advancedMaterialBase } from "../advanced-material-buildings";
import type { BuildingDefinition } from "../building-catalog";
import type { BuildingPart, BuildingRecipe } from "../building-recipe";
import { getRomanPartBounds } from "../building-recipe-fit";
import { withBuildingWindowShadows } from "../building-window-shadows";
import { clearChineseWindowMembers } from "../chinese-window-clearance";
import { addIndigenousTentLevel } from "../indigenous-building-levels";
import { addIndigenousQuarryLevel, isIndigenousQuarrySite } from "../indigenous-quarry-levels";
import { clearJapaneseWorkshopWindows, JAPANESE_OPEN_WORKSHOPS } from "../japanese-workshop-windows";
import {
  createLevelPlanRecipe, createNationBuildingRecipe, withNationTextureScale
} from "../nation-building-recipe";
import { addPersianCurvedLevel } from "../persian-building-levels";
import { applyRoofUpgradeReview } from "../roof-review-prototype";
import { clearYaguraWindowRails } from "../yagura-wall-openings";
import type { BuildingLevel } from "./building-level";
import { addLevelChimney } from "./level-chimney";
import { addJapaneseCrown, JAPANESE_DORMER } from "./level-crown-japanese";
import { addNubianCrown, addNubianRoofPiece } from "./level-crown-nubian";
import { addRomanCrown, ROMAN_DORMER } from "./level-crown-roman";
import { addVikingCrown, VIKING_DORMER } from "./level-crown-viking";
import { addDoorHood } from "./level-door-hood";
import { addDormer } from "./level-dormer";
import { addDressedLevel, addRaisedBand } from "./level-dressing";
import { addExpansionCrown } from "./level-expansion-crowns";
import { createLevelKit, heightCap, type LevelKit } from "./level-kit";
import { levelProgressionOf, type LevelStep, type LevelSteps } from "./level-progression";
import { analyseLevelSite, type LevelSite } from "./level-site";
import { addShaftLantern, addSideCanopy, addWallLantern } from "./level-wall-pieces";
import { WELL_LEVEL_STEPS } from "./level-well";
import { addLanternPost } from "./level-yard-posts";
import { addYardProps } from "./level-yard-props";

/** Nation pieces of levels 4 (roof piece) and 5 (crown and banner). */
const NATION_LEVELS: Readonly<Record<WorkerNation, { roofPiece: (kit: LevelKit) => void;
  crown: (kit: LevelKit) => void }>> = {
  maya: { crown: addExpansionCrown, roofPiece: addSideCanopy },
  persian: { crown: addExpansionCrown, roofPiece: addSideCanopy },
  chinese: { crown: addExpansionCrown, roofPiece: addSideCanopy },
  indigenous: { crown: () => undefined, roofPiece: addSideCanopy },
  japanese: { crown: addJapaneseCrown, roofPiece: kit => addDormer(kit, JAPANESE_DORMER) },
  nubian: { crown: addNubianCrown, roofPiece: addNubianRoofPiece },
  roman: { crown: addRomanCrown, roofPiece: kit => addDormer(kit, ROMAN_DORMER) },
  viking: { crown: addVikingCrown, roofPiece: kit => addDormer(kit, VIKING_DORMER) }
};

/** What each level adds on top of the previous one (level 3's wall raise happens in the plan). */
const LEVEL_STEPS: LevelSteps = {
  2: addDressedLevel,
  3: kit => { addRaisedBand(kit); addLevelChimney(kit); },
  4: kit => { NATION_LEVELS[kit.site.nation].roofPiece(kit); addDoorHood(kit); addYardProps(kit); },
  5: kit => NATION_LEVELS[kit.site.nation].crown(kit)
};

/**
 * Alternatives, tried in turn, for a level whose usual pieces found no room (towers, mines,
 * cramped roofs and doors): wall-mounted first, then free-standing in the yard.
 */
const FALLBACK_STEPS: Readonly<Record<LevelStep, readonly ((kit: LevelKit) => void)[]>> = {
  2: [addWallLantern, addLanternPost], 3: [addWallLantern, addLanternPost],
  4: [addSideCanopy, addLanternPost, addShaftLantern],
  5: []
};

const LEVEL_ORDER: readonly LevelStep[] = [2, 3, 4, 5];

/** How far a single strip (plinth, band) may be pulled back inside the plot line. */
const NUDGE_LIMIT = .06;

/** Pulls a part back inside the plot line: shifted, or (a strip overrunning both ends) shortened. */
const nudgeInside = (part: BuildingPart, site: LevelSite): BuildingPart | null => {
  const { max, min } = getRomanPartBounds(part), position: BuildingPart["position"] = [...part.position];
  const size: BuildingPart["size"] = [...part.size];
  for (const [axis, extent] of [[0, site.limit.extentX], [2, site.limit.extentZ]] as const) {
    const over = max[axis]! - extent, under = -extent - min[axis]!;
    if (over <= 0 && under <= 0) continue;
    if (Math.max(over, under) > NUDGE_LIMIT) return null;
    if (over > 0 && under > 0 && !part.rotation) {
      size[axis] -= over + under;
      position[axis] += (under - over) / 2;
      continue;
    }
    position[axis] += over > 0 ? -over : under;
  }
  return { ...part, position, size };
};

type Bounds = ReturnType<typeof getRomanPartBounds>;
/** Parts closer than this touch (as the support checks count them). */
const TOUCH = .012;

const touches = (a: Bounds, b: Bounds) => [0, 1, 2].every(axis =>
  a.min[axis]! - TOUCH < b.max[axis]! && a.max[axis]! + TOUCH > b.min[axis]!);

/**
 * Safety net for unusual plans: an addition must rest on the ground, the building or another
 * resting addition; anything left hanging (and what hangs from it) is left out.
 */
const restingOnly = (added: readonly BuildingPart[], site: LevelSite) => {
  const standing = site.parts.map(part => getRomanPartBounds(part));
  const pending = added.map(part => ({ bounds: getRomanPartBounds(part), part }));
  const resting: BuildingPart[] = [];
  const rests = (entry: typeof pending[number]) =>
    entry.bounds.min[1] <= .001 || standing.some(bounds => touches(bounds, entry.bounds));
  for (let next = pending.filter(rests); next.length; next = pending.filter(rests)) for (const entry of next) {
    pending.splice(pending.indexOf(entry), 1);
    standing.push(entry.bounds); resting.push(entry.part);
  }
  return added.filter(part => resting.includes(part));
};

/** Additions stay inside the plot envelope and the 130 % height cap, resting on the building. */
const settle = (added: readonly BuildingPart[], site: LevelSite) => restingOnly(added.flatMap(part => {
  if (getRomanPartBounds(part).max[1] > heightCap(site)) return [];
  const inside = nudgeInside(part, site);
  return inside ? [inside] : [];
}), site);

export interface LeveledRecipe { recipe: BuildingRecipe; additions: readonly BuildingPart[] }

/** One level's pieces, settled on the building as it stands. */
const runStep = (step: (kit: LevelKit) => void, site: LevelSite) => {
  const kit = createLevelKit(site);
  if (isIndigenousQuarrySite(site)) addIndigenousQuarryLevel(kit, step);
  else step(kit);
  return settle(kit.added, site);
};

const createLeveledRecipe = (definition: BuildingDefinition, nation: WorkerNation, detailed: boolean,
  level: BuildingLevel): LeveledRecipe => {
  const built = createNationBuildingRecipe(definition, nation, detailed, level);
  if (level === 1) return { additions: [], recipe: nation==="japanese"&&[4,9].includes(definition.id)?clearYaguraWindowRails(built):built };
  if(nation==="japanese"&&definition.id===20)
    return {additions:built.parts.filter(part=>part.bambooUpgrade),recipe:built};
  const { lift, plan } = createLevelPlanRecipe(definition, detailed, level);
  const baseline = leveledBuildingRecipe(definition, nation, detailed, 1);
  const site = analyseLevelSite({ baseline, built, definition, detailed, lift, nation, plan });
  const additions: BuildingPart[] = [];
  const progression = levelProgressionOf(nation, definition.id);
  let steps = progression?.steps ?? LEVEL_STEPS;
  if (definition.style === "well") steps = WELL_LEVEL_STEPS;
  const textileIndigenous = nation === "indigenous" && definition.style !== "well" && !isIndigenousQuarrySite(site);
  for (const step of LEVEL_ORDER.filter(next => next <= level)) {
    const curvedPersian = nation === "persian" && built.parts.some(part => part.shape === "persian-room") &&
      definition.style !== "well";
    let decorate = steps[step];
    if (textileIndigenous) decorate = (kit: LevelKit) => addIndigenousTentLevel(kit, step);
    else if (curvedPersian) decorate = (kit: LevelKit) => addPersianCurvedLevel(kit, step);
    const existingStep = decorate;
    if (step === 4 && !progression) decorate = kit => {
      const current: BuildingRecipe = { ...built, parts: kit.site.parts };
      const upgraded = applyRoofUpgradeReview(current, advancedMaterialBase(definition.id) ?? definition.id,
        nation, detailed).recipe;
      const roofAdditions = upgraded.parts.slice(current.parts.length);
      // A monitor is one weatherproof assembly. Per-part clipping can keep its timber walls
      // while dropping the cap above the height limit, leaving an open, unfinished roof stub.
      const acceptedRoof = settle(roofAdditions, site);
      const completeRoof = roofAdditions.length > 0 && acceptedRoof.length === roofAdditions.length;
      if (completeRoof) for (const part of acceptedRoof) kit.add(part);
      if (!completeRoof) existingStep(kit);
      else { addDoorHood(kit); addYardProps(kit); }
    };
    let settled = runStep(decorate, site);
    for (const fallback of FALLBACK_STEPS[step]) if (!textileIndigenous && !settled.length) settled = runStep(fallback, site);
    const textured = withNationTextureScale(definition.id === 16
      ? settled.filter(part => getRomanPartBounds(part).max[1] < 1.60) : settled, nation);
    // The solid wooden jamb fills each wrap: omit its buried inner wall and redundant annular caps.
    // Outer profile/roundness stays identical; this funds visible rough binder geometry.
    if(definition.id===16&&nation==="indigenous")for(const part of textured)
      if(part.shape==="ring"&&["rope","hide"].includes(part.surface)&&Math.max(...part.size)<.1) {
        part.shape="cylinder";
        if(!detailed)part.radialSegments=3;
      }
    site.parts.push(...textured);
    additions.push(...textured);
  }
  const finished=withBuildingWindowShadows({ ...built, parts: site.parts });
  if (nation === "japanese" && (definition.id === 0 || JAPANESE_OPEN_WORKSHOPS.includes(definition.id))) return {
    additions: clearJapaneseWorkshopWindows(finished, additions).parts,
    recipe: clearJapaneseWorkshopWindows(finished)
  };
  if(nation==="japanese"&&[4,9].includes(definition.id))return {
    additions:clearYaguraWindowRails(finished,additions).parts,recipe:clearYaguraWindowRails(finished)};
  if (nation === "chinese") return {
    additions: clearChineseWindowMembers(finished, additions).parts,
    recipe: clearChineseWindowMembers(finished)
  };
  return { additions, recipe:finished };
};

const recipes = new Map<string, LeveledRecipe>();

/** The cache key of one leveled recipe (type, nation, level, detail). */
export const leveledRecipeKey = (typeId: number, nation: WorkerNation, level: BuildingLevel, detailed: boolean) =>
  `${typeId}:${nation}:${level}:${detailed ? 1 : 0}`;

/** Whether the recipe is cached, so building it on this thread costs no recipe generation. */
export const hasLeveledRecipe = (key: string) => recipes.has(key);

/**
 * Adopts a recipe generated elsewhere (the building recipe worker: the same deterministic code,
 * structured-cloned). A recipe this thread already holds is kept, so its users never see a new object.
 */
export const seedLeveledRecipe = (key: string, leveled: LeveledRecipe) => {
  if (!recipes.has(key)) recipes.set(key, leveled);
};

const cachedLeveledRecipe = (definition: BuildingDefinition, nation: WorkerNation, detailed: boolean,
  level: BuildingLevel) => {
  const key = leveledRecipeKey(definition.id, nation, level, detailed);
  let leveled = recipes.get(key);
  if (!leveled) {
    leveled = createLeveledRecipe(definition, nation, detailed, level);
    recipes.set(key, leveled);
  }
  return leveled;
};

/**
 * The building of a nation at a level (1-5) and detail: its level 1 recipe with the level
 * additions on the fixed footprint, door, approaches and stock contacts. Cached per (type, nation,
 * level, detail): a level change rebuilds one model, never per frame.
 */
export const leveledBuildingRecipe = (definition: BuildingDefinition, nation: WorkerNation, detailed: boolean,
  level: BuildingLevel): BuildingRecipe => cachedLeveledRecipe(definition, nation, detailed, level).recipe;

/** The cached recipe and level additions (the recipe worker posts both). */
export const leveledRecipeEntry = cachedLeveledRecipe;

/** The parts levels 2 up to `level` added (review counts and contract tests). */
export const buildingLevelAdditions = (definition: BuildingDefinition, nation: WorkerNation, detailed: boolean,
  level: BuildingLevel) => cachedLeveledRecipe(definition, nation, detailed, level).additions;

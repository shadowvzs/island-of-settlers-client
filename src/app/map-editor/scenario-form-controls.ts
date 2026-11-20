import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import type { FieldOption } from "./section-store";

const labeled = (pairs: readonly (readonly [string, EditorText])[]): readonly FieldOption[] =>
  pairs.map(([value, label]) => ({ label, value }));

export const SCENARIO_KINDS = labeled([
  ["home", M.option.scenarioKind.home],
  ["adventure", M.option.scenarioKind.adventure],
  ["colony", M.option.scenarioKind.colony]
]);
export const SCENARIO_NATIONS = labeled([
  ["roman", M.option.nation.roman],
  ["viking", M.option.nation.viking],
  ["nubian", M.option.nation.nubian],
  ["japanese", M.option.nation.japanese]
]);
export const SCENARIO_THEMES = labeled([
  ["forest", M.option.scenarioTheme.forest],
  ["tropical", M.option.scenarioTheme.tropical],
  ["winter", M.option.scenarioTheme.winter],
  ["desert", M.option.scenarioTheme.desert],
  ["swamp", M.option.scenarioTheme.swamp]
]);
export const SCENARIO_OBJECTIVES = labeled([
  ["capture", M.option.objective.capture],
  ["defeat", M.option.objective.defeat]
]);
export const GROUP_FORMATIONS = labeled([
  ["block", M.option.formation.block],
  ["line", M.option.formation.line],
  ["column", M.option.formation.column],
  ["wedge", M.option.formation.wedge]
]);
export const GROUP_FACINGS = labeled([
  ["manual", M.option.facing.manual],
  ["toward landing", M.option.facing.towardLanding]
]);
export const TROOPS = labeled([
  ["shield", M.option.troop.shield],
  ["heavy", M.option.troop.heavy],
  ["archer", M.option.troop.archer]
]);
export const troopLabel = (type: string): EditorText =>
  M.option.troop[type as keyof typeof M.option.troop] ?? type;

export const BUILDING_APPEARANCES = labeled([
  ["military", M.option.buildingAppearance.military],
  ["tent-0", M.option.buildingAppearance.tent0],
  ["tent-1", M.option.buildingAppearance.tent1],
  ["tent-2", M.option.buildingAppearance.tent2],
  ["lodge-0", M.option.buildingAppearance.lodge0],
  ["lodge-1", M.option.buildingAppearance.lodge1],
  ["lodge-2", M.option.buildingAppearance.lodge2]
]);
/** Enemy buildings by type id, named after the building; type 0 is an AI faction's authored depot. */
export const ENEMY_BUILDINGS: readonly FieldOption[] = [
  { label: M.option.buildingAppearance.enemyHeadquarters, value: "0" },
  ...["1", "2", "4", "9"].map(value => ({ label: getBuildingDefinition(Number(value)).name, value })),
    { label: M.option.buildingAppearance.banditCatapult, value: "bandit-catapult" },
    { label: M.option.buildingAppearance.pirateCatapult, value: "pirate-catapult" }
];

/** The Map tab's authored scenario fields and their first values (before the map's scenario shows). */
export const createScenarioMapFields = () => ({
  claim: "0", expiry: "0", hqRotation: "0", kind: "home", nation: "roman", objective: "capture", reward: "0",
  theme: "forest"
});

/** The Units tab's enemy group / building fields and their first values. */
export const createEnemyFormFields = () => ({
  building: "1", catapultStones: "6", count: "1", defenders: "0", faction: "1", facing: "manual", formation: "block", group: "0",
  model: "military", rank: "0", spacing: "1", troop: "shield", unitRotation: "0"
});

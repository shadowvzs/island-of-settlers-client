import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import type { ScenarioBuilding } from "../../shared/world/map-scenario";
import type { EditorStore } from "./editor-store";
import { MAP_EDITOR_MESSAGES as M } from "./messages";
import type { ScenarioEditor } from "./scenario-editor";

export const scenarioBuildingName = (entry: Pick<ScenarioBuilding, "catapult" | "type">) => {
  if (entry.type === 0) return M.option.buildingAppearance.enemyHeadquarters;
  if (!entry.catapult) return getBuildingDefinition(entry.type).name;
  if (entry.catapult.variant === "bandit") return M.option.buildingAppearance.banditCatapult;
  return M.option.buildingAppearance.pirateCatapult;
};

/** Marker selection uses the same production tab/tool/selection path as the object list. */
export const createCatapultMarkerSelection = (store: EditorStore, editor: ScenarioEditor) => (id: number) => {
  store.setTab("units");
  editor.activate("select", "units");
  editor.select("units", `building:${id}`);
};

import type { ScenarioPoint } from "../../shared/world/map-scenario";
import { type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import type { FieldOption } from "./section-store";

export type ScenarioSelectionScope = "map" | "units";

/** An authored scenario object: its selection id, list label and position. */
export type ScenarioEntry = [string, EditorText, ScenarioPoint];

export const isScenarioSelectionInScope = (id: string, scope: ScenarioSelectionScope) =>
  scope === "map" ? id === "hq" || id === "landing" : id.startsWith("unit:") || id.startsWith("building:");

/** Names of a tab's selection controls (the HQ and landing on Map, units and camps on Units). */
export const SCENARIO_SELECTION_LABELS = {
  map: {
    list: M.scenario.selection.mapLabel,
    move: M.scenario.selection.mapMove,
    placeholder: M.scenario.selection.mapPlaceholder,
    remove: M.scenario.selection.mapRemove,
    rotate: M.scenario.selection.mapRotate,
    select: M.scenario.selection.mapSelect
  },
  units: {
    list: M.scenario.selection.unitsLabel,
    move: M.scenario.selection.unitsMove,
    placeholder: M.scenario.selection.unitsPlaceholder,
    remove: M.scenario.selection.unitsRemove,
    rotate: M.scenario.selection.unitsRotate,
    select: M.scenario.selection.unitsSelect
  }
} as const;

/** What a tab's selection controls show: its objects, its selection and which actions apply. */
export interface ScenarioSelectionView {
  moveDisabled: boolean;
  options: readonly FieldOption[];
  removeDisabled: boolean;
  rotateDisabled: boolean;
  selected: string;
}

/** The list's options: a placeholder before the objects; none (the list hides) without objects. */
const toSelectionOptions = (objects: readonly FieldOption[], placeholder: EditorText): readonly FieldOption[] => {
  if (!objects.length) return [];
  return [{ label: placeholder, value: "" }, ...objects];
};

/** Separate controls share one selected object; tabs never act on a hidden selection. */
export const toScenarioSelectionView = (
  entries: readonly ScenarioEntry[], selected: string, scope: ScenarioSelectionScope
): ScenarioSelectionView => {
  const active = isScenarioSelectionInScope(selected, scope);
  const objects = entries.filter(([id]) => isScenarioSelectionInScope(id, scope))
    .map(([value, label]) => ({ label, value }));
  return {
    moveDisabled: !active,
    options: toSelectionOptions(objects, SCENARIO_SELECTION_LABELS[scope].placeholder),
    removeDisabled: !active,
    rotateDisabled: !active || selected === "landing",
    selected: active ? selected : ""
  };
};

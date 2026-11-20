import { GARRISON_TROOPS } from "../../shared/settlement/military-garrison-rules";
import type { ScenarioBuilding } from "../../shared/world/map-scenario";
import { scenarioGarrison, scenarioGarrisonCapacity, validScenarioGarrison } from "../../shared/world/scenario-garrison";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { troopLabel } from "./scenario-form-controls";
import { createSectionStore } from "./section-store";

const SHIELD_DEFENDERS = "shield defenders";
export const GARRISON_MODES = [SHIELD_DEFENDERS, "authored composition"];

/** One count field per troop type and rank: its field name and label. */
export const GARRISON_ROWS = GARRISON_TROOPS.flatMap(type => [0, 1, 2].map(rank => ({
  label: editorMessage(M.scenario.garrisonRow, { rank: rank + 1, type: troopLabel(type) }), name: `${type}:${rank}`, rank, type
})));

const ROW_VALUES = Object.fromEntries(GARRISON_ROWS.map(row => [row.name, "0"]));

/** Each field authors actual troops; exposed posts are assigned by shared runtime garrison slots. */
export const createScenarioGarrisonControls = () => {
  const section = createSectionStore<Record<string, string | EditorText>>({
    ...ROW_VALUES, mode: SHIELD_DEFENDERS, summary: M.scenario.garrisonTitle
  });
  const read = (entry: Pick<ScenarioBuilding, "bandit" | "defenders" | "type">) => {
    if (section.get().mode === SHIELD_DEFENDERS) return { defenders: entry.defenders, garrison: undefined };
    if (!section.reportValidity(...GARRISON_ROWS.map(row => row.name))) return null;
    const garrison = GARRISON_ROWS
      .map(row => ({ type: row.type, rank: row.rank, count: section.number(row.name, 0, 12) }))
      .filter(row => row.count > 0);
    const total = garrison.reduce((sum, row) => sum + row.count, 0);
    const capacity = scenarioGarrisonCapacity(entry);
    if (total > capacity || !validScenarioGarrison({ ...entry, defenders: total, garrison } as ScenarioBuilding))
      return null;
    return { defenders: total, garrison };
  };
  const show = (entry: ScenarioBuilding) => {
    const counts = Object.fromEntries(GARRISON_ROWS.map(row => [row.name, String(scenarioGarrison(entry)
      .find(group => group.type === row.type && group.rank === row.rank)?.count ?? 0)]));
    section.update({
      ...counts,
      mode: entry.garrison === undefined ? SHIELD_DEFENDERS : GARRISON_MODES[1]!,
      summary: editorMessage(M.scenario.garrisonSummary, { capacity: scenarioGarrisonCapacity(entry) })
    });
  };
  return { read, section, show };
};

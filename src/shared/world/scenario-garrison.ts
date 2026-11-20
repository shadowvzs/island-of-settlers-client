import { banditCampPlan } from "../../render-common/buildings/bandit-camp-plan";
import { GARRISON_CAPACITIES } from "../balance/military";
import { GARRISON_TROOPS, type GarrisonTroop } from "../settlement/military-garrison-rules";
import type { ScenarioBuilding } from "./map-scenario";

export interface ScenarioGarrisonGroup { type: GarrisonTroop; rank: number; count: number }
export const scenarioGarrisonCapacity = (entry: Pick<ScenarioBuilding, "bandit" | "type">) =>
  entry.bandit === undefined ? GARRISON_CAPACITIES[entry.type] ?? 0 : banditCampPlan(entry.bandit).capacity;

/** Old maps retain their exact rank-zero shield defenders when no authored roster exists. */
export const scenarioGarrison = (
  entry: Pick<ScenarioBuilding, "defenders" | "garrison"> & { type?: number }
): ScenarioGarrisonGroup[] => {
  if (entry.garrison) return entry.garrison;
  if (entry.type === 16 && entry.defenders > 0) return [
    { type: "heavy", rank: 0, count: 1 },
    ...entry.defenders > 1 ? [{ type: "shield" as const, rank: 0, count: entry.defenders - 1 }] : []
  ];
  return [{ type: "shield", rank: 0, count: entry.defenders }];
};

export const validScenarioGarrison = (entry: ScenarioBuilding) => {
  const capacity = scenarioGarrisonCapacity(entry);
  if (!Number.isSafeInteger(entry.defenders) || entry.defenders < 0 || entry.defenders > capacity) return false;
  if (entry.garrison === undefined) return true;
  if (!Array.isArray(entry.garrison) || entry.garrison.length > 9) return false;
  const seen = new Set<string>();
  let total = 0;
  for (const group of entry.garrison) {
    if (!group || !GARRISON_TROOPS.includes(group.type) || !Number.isSafeInteger(group.rank) ||
      group.rank < 0 || group.rank > 2 || !Number.isSafeInteger(group.count) || group.count < 1 ||
      group.count > capacity || seen.has(`${group.type}:${group.rank}`)) return false;
    seen.add(`${group.type}:${group.rank}`); total += group.count;
  }
  if (entry.type === 16 && (entry.garrison.some(group => group.type === "archer") ||
    (total > 0 && !entry.garrison.some(group => group.type === "heavy")))) return false;
  return total === entry.defenders && total <= capacity;
};

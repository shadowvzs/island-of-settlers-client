import { isActiveResidence, residenceEffect } from "../../shared/settlement/residences";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { SettlementResidenceSummary } from "../settlement-ui/types";

type ResidenceSimulation = Pick<SettlementSimulation, "home" | "talentModifiers">;

/** Details-window data of a completed own residence (owner 2026-10-21); undefined for anything else. */
export const residenceSummary = (
  simulation: ResidenceSimulation, building: SettlementBuilding
): SettlementResidenceSummary | undefined => {
  if (!isActiveResidence(building)) return undefined;
  const talents = simulation.talentModifiers();
  return {
    ...residenceEffect(building, talents),
    home: simulation.home()?.colonyHome ? "harbour" : "headquarters",
    talentAdjusted: talents.populationLimit > 0 || talents.settlerGrowthSpeed > 0
  };
};

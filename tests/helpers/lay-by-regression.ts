import { DMath } from "../../src/shared/math/deterministic-math";
import type { SettlementBuilding, SettlementPoint } from "../../src/shared/settlement/settlement-types";

/** The prototype put every flag bay 0.8 inward, toward the building centre. */
const LEGACY_INWARD_BAY_OFFSET = 0.8;

/**
 * The old inward-offset bay, kept only as the comparison point for the lay-by regression tests. It is
 * intentionally not production geometry: the shared search must reject this point on real plots.
 */
export const legacyInwardBay = (building: SettlementBuilding): SettlementPoint => {
  const dx = building.x - building.access.x, dz = building.z - building.access.z;
  const length = DMath.hypot(dx, dz) || 1;
  const offset = Math.min(LEGACY_INWARD_BAY_OFFSET, length * 0.45);
  return {
    x: building.access.x + dx / length * offset,
    z: building.access.z + dz / length * offset
  };
};

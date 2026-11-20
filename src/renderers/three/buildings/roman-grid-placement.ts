import type { Group } from "three";

import type { BuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { getRomanBuildingGridMetrics } from "../../../render-common/buildings/building-grid-metrics";

/** Shared authoring envelopes keep simulation entrances and both LOD model scales identical. */
export const getRomanGridPlacement = (definition: BuildingDefinition, _mechanism: Group) =>
  getRomanBuildingGridMetrics(definition);

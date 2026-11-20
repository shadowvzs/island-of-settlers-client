import { buildingEntry, fillPathTokens } from "@shared/catalog";

import type { WorkerNation } from "../workers/worker-nation";

/** The headquarters' icon template is every building's (content catalog `building:*` icon, `{nation}-{code}`). */
const HEADQUARTERS_CODE = 0;

/** One actual canonical model thumbnail per nation/type; shared by UI, exporters and catalog. */
export const nationalBuildingIconPath = (nation: WorkerNation, type: number) => {
  const icon = buildingEntry(type)?.icon ?? buildingEntry(HEADQUARTERS_CODE)!.icon!;
  return `assets/${fillPathTokens(icon.path, { code: type, nation })}`;
};

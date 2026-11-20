import {
  DEBUG_BUILD_ALL_TYPES, type DebugBuildResult
} from "../../shared/settlement/settlement-debug-build-all";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";

/** Work per slice, so the page keeps drawing frames while the town is raised. */
const SLICE_MS = 12;
/** A frozen/coarse clock must still yield so input and rendering get their next turn. */
const MAX_ADVANCES_PER_SLICE = 8;

export interface DebugBuildAllReport {
  built: number;
  skipped: Array<{ reason: string; typeId: number }>;
}

interface DebugBuildAllRun {
  /** The stepped search for one type (see `debugRaiseBuildingSteps`). */
  raise(typeId: number): Generator<void, DebugBuildResult>;
  onDone(report: DebugBuildAllReport): void;
  onRaised(building: SettlementBuilding): void;
}

/**
 * "Build every building", ordinary buildings before military sites and mines, the searches advanced a slice at a time between
 * frames. Each type is placed with the real rules; skipped types are reported with their reason.
 */
export const runDebugBuildAll = (
  { onDone, onRaised, raise }: DebugBuildAllRun,
  schedule: (next: () => void) => void = next => setTimeout(next, 0),
  now = () => performance.now()
) => {
  const report: DebugBuildAllReport = { built: 0, skipped: [] };
  let index = 0, typeId = 0, search: Generator<void, DebugBuildResult> | null = null;
  const record = (result: DebugBuildResult) => {
    search = null;
    if (!result.ok) { report.skipped.push({ reason: result.reason, typeId }); return; }
    report.built++;
    onRaised(result.building);
  };
  const slice = () => {
    const started = now();
    let advances = 0;
    while (advances++ < MAX_ADVANCES_PER_SLICE && now() - started < SLICE_MS) {
      if (!search && index === DEBUG_BUILD_ALL_TYPES.length) { onDone(report); return; }
      if (!search) { typeId = DEBUG_BUILD_ALL_TYPES[index++]!; search = raise(typeId); }
      const step = search.next();
      if (step.done) record(step.value);
    }
    schedule(slice);
  };
  slice();
};

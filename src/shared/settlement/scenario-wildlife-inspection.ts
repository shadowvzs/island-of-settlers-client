import type { ResourceTarget } from "./settlement-types";

export const MAX_INSPECTION_PREY = 4096;
export interface ScenarioWildlifeSnapshot {
  source: "native-current-pool";
  targets: ResourceTarget[];
  overflow: boolean;
}
/** Copy only bounded values from the native live provider; no pool/manager/closure crosses the worker. */
export const createScenarioWildlifeSnapshot = (targets: readonly ResourceTarget[]): ScenarioWildlifeSnapshot =>
  targets.length > MAX_INSPECTION_PREY
    ? { source: "native-current-pool", targets: [], overflow: true }
    : { source: "native-current-pool", targets: targets.map(({ id, kind, x, z }) => ({ id, kind, x, z })),
      overflow: false };

/** Validate the serializable worker boundary before installing it as a native target provider. */
export const validScenarioWildlife = (snapshot: ScenarioWildlifeSnapshot | undefined,
  world: { cellsX: number; cellsZ: number }) => {
  if (!snapshot || snapshot.source !== "native-current-pool" || snapshot.overflow ||
    !Array.isArray(snapshot.targets) || snapshot.targets.length > MAX_INSPECTION_PREY) return false;
  const ids = new Set<number>();
  return snapshot.targets.every(target => {
    if (!target || typeof target !== "object") return false;
    if (!Number.isSafeInteger(target.id) || target.id < 0 || ids.has(target.id) || target.kind !== "wildlife" ||
      !Number.isFinite(target.x) || !Number.isFinite(target.z) || target.x < 0 || target.z < 0 ||
      target.x >= world.cellsX || target.z >= world.cellsZ) return false;
    ids.add(target.id); return true;
  });
};

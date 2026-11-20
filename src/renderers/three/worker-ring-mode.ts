/**
 * C02 rollback switch for the ground rings: `?rings=individual` (dev params) or
 * `globalThis.__workerRings = "individual"` at runtime draws one selection/contact ring mesh per
 * worker (the pre-C02 path). The default keeps both ring kinds in one `InstancedMesh` each.
 */
export type WorkerRingMode = "individual" | "instanced";

interface WorkerRingGlobal { __workerRings?: WorkerRingMode }

export const setWorkerRingMode = (mode: WorkerRingMode) => {
  (globalThis as WorkerRingGlobal).__workerRings = mode;
};

export const individualWorkerRings = () =>
  (globalThis as WorkerRingGlobal).__workerRings === "individual";

export const readWorkerRingMode = (value: string | null): WorkerRingMode =>
  value === "individual" ? "individual" : "instanced";

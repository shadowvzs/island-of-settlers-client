/**
 * C06 rollback switch: `?crowd=skinned` (dev params) or `globalThis.__crowdMode = "skinned"` at
 * runtime keeps every character on the per-actor skinned path. The default poses the far crowd
 * (LOD3 below CHARACTER_CROWD_PIXELS) on the GPU from baked bone-matrix textures.
 */
export type CrowdMode = "gpu" | "skinned";

interface CrowdModeGlobal { __crowdMode?: CrowdMode }

export const setCrowdMode = (mode: CrowdMode) => { (globalThis as CrowdModeGlobal).__crowdMode = mode; };

export const crowdGpuEnabled = () => (globalThis as CrowdModeGlobal).__crowdMode !== "skinned";

export const readCrowdMode = (value: string | null): CrowdMode => (value === "skinned" ? "skinned" : "gpu");

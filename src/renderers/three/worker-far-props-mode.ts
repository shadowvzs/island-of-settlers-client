import type { WorkerFrame } from "../../render-common/workers/worker-unit";

/**
 * C06b rollback switch for the far props: `?farprops=exact` (dev params) or
 * `globalThis.__farProps = "exact"` at runtime keeps the pre-C06b prop path on GPU crowd members
 * (hand IK contacts and forced world updates). The default skips the work that only shapes the
 * skinned body — which the GPU crowd does not draw — and reads the baked bone matrices directly.
 */
export type FarPropsMode = "far" | "exact";

interface FarPropsGlobal { __farProps?: FarPropsMode }

export const setFarPropsMode = (mode: FarPropsMode) => { (globalThis as FarPropsGlobal).__farProps = mode; };

export const farPropsEnabled = () => (globalThis as FarPropsGlobal).__farProps !== "exact";

export const readFarPropsMode = (value: string | null): FarPropsMode =>
  (value === "exact" ? "exact" : "far");

/**
 * C06b cadence: the far crowd's props refresh on every second due pose. The baked body still
 * animates every frame on the GPU; below 30 px a prop one pose behind its hand is under a pixel,
 * and root-following loads (the expensive far cases) barely move in the skeleton at all.
 */
export const FAR_PROPS_CADENCE = 2;

/** Whether the far-prop update at `tick` places the props (the other ticks keep their placement). */
export const farPropPlacementDue = (tick: number) => tick % FAR_PROPS_CADENCE === 0;

/**
 * Poses whose far props may hold their previous placement: a carried load rides the chest/back and
 * a standing actor's idle breathing barely moves the hands. Locomotion and the contact-work clips
 * swing the arms too far for a held prop to trail the hand by one pose, so they place every pose.
 * `holdable` alone is not enough: the caller also forces a placement when the pose family changes
 * or when the visible prop has never been placed (a load finishing, a job switch).
 */
const HOLDABLE_ACTIONS: ReadonlySet<WorkerFrame["action"]> = new Set(["carry_back", "carry_shoulder", "carry_overhead_boat", "idle_breathe"]);

export const farPropHoldable = (frame: Pick<WorkerFrame, "action" | "wareTransfer">) =>
  frame.wareTransfer === undefined && HOLDABLE_ACTIONS.has(frame.action);

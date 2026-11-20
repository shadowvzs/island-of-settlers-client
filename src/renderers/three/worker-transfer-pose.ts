import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";

type TransferFrame = Pick<WorkerFrame, "wareTransfer" | "workerJob" | "y">;
type TransferMaterialAction = "idle_breathe" | "pickup_material" | "putdown_material" | "boat_lift" | "boat_putdown";

/** Elevated stock is reached by the existing prop/hand IK, without a ground-reaching leg clip. */
export const workerTransferMaterialAction = (frame: TransferFrame): TransferMaterialAction => {
  const transfer = frame.wareTransfer;
  if (!transfer) return "idle_breathe";
  if (transfer.ware === "boat") return transfer.direction === "pickup" ? "boat_lift" : "boat_putdown";
  if (["water", "stone", "marble", "bread"].includes(transfer.ware)) return "idle_breathe";
  // Compare against the actor's feet, so terrain elevation cannot turn a ground pickup into a table pickup.
  if (transfer.target.y - frame.y >= WORKER_HEIGHT / 2) return "idle_breathe";
  return transfer.direction === "pickup" ? "pickup_material" : "putdown_material";
};

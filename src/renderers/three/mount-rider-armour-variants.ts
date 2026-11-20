import vikingCommanderMountedArmour from "../../../assets/mounts/viking-commander-mounted-armour.glb?url";
import type { WorkerNation } from "../../render-common/workers/worker-unit";

/** This gear was fitted to the literal mounted Commander. Ordinary riders/standing armour retain their files. */
export const mountedRiderArmourModel = (nation: WorkerNation, rank: "centurion" | "soldier",
  bodyId: string, ordinary: string) => {
  if (nation === "viking" && rank === "centurion" && bodyId === "viking-woman-blue") return vikingCommanderMountedArmour;
  return ordinary;
};

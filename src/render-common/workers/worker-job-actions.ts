import type { PalmHarvestPhase } from "../../shared/settlement/plantation-harvest";
import { getWareCarryAction, resolveWareId } from "../wares/ware-catalog";
import { DRINK_GROWER_ACTIONS, DRINK_MAKER_ACTIONS } from "./drink-work-actions";
import type { StandingAction, WorkerFrame } from "./worker-unit";

const workActions: Record<string, StandingAction> = {
  // Between feeds the keeper watches the animals eat; the put-down is only played at a feed.
  "Pig breeder": "look_around",
  Builder: "build_hammer",
  Leveler: "dig",
  Geologist: "build_hammer",
  Scout: "spyglass_scan",
  Woodcutter: "chop_tree",
  Forester: "plant_seedling",
  Farmer: "harvest_wheat",
  "Rice farmer": "harvest_wheat",
  Fisher: "fish_wait",
  Winegrower: "dig",
  Charburner: "dig",
  Miner: "build_hammer",
  Stonemason: "build_hammer",
  Armorer: "build_hammer",
  Metalworker: "build_hammer",
  Shipwright: "build_hammer",
  Butcher: "build_hammer",
  Skinner: "build_hammer"
};
/**
 * Palm harvest: the grower shakes the trunk with both palms on it (push_trunk), watches the nuts
 * drop, then gathers them with the pick-up clip.
 */
const PALM_HARVEST_ACTIONS: Record<PalmHarvestPhase, StandingAction> = {
  drop: "look_around", gather: "pickup_material", shake: "push_trunk"
};

/** The grain farmer and the Japanese rice farmer share the sowing and harvest clips. */
export const isFarmerJob = (job: string | undefined) =>
  job === "Farmer" || job === "Rice farmer" || job === "Flax grower";

/** Only existing, verified worker-generation clips. Unsupported jobs keep their honest idle pose. */
export const getJobAction = (
  job: string,
  action: string,
  ware?: string | null,
  fieldWork?: WorkerFrame["fieldWork"],
  palmHarvest?: PalmHarvestPhase | null
): WorkerFrame["action"] => {
  if (palmHarvest) return PALM_HARVEST_ACTIONS[palmHarvest];
  // A queued carrier keeps holding its cargo instead of making it disappear while waiting.
  if (ware && action === "idle") return getWareCarryAction(ware);
  if (action === "walk") return "walk";
  if (action === "carry") return getWareCarryAction(ware ?? "flour");
  if (action === "chop") return "chop_tree";
  if (action === "plant") return "plant_seedling";
  if (["fish_cast", "fish_wait", "fish_reel"].includes(action)) return action as StandingAction;
  if (isFarmerJob(job) && action === "work" && fieldWork === "sow") return "idle_breathe";
  // Hand-pull, gather and carry is one flax clip; drying bundles are gathered at the same contact.
  if (job === "Flax grower" && action === "work") return "harvest_flax";
  if (job === "Weaver" && action === "work") return "weave_loom";
  if (action === "work" && fieldWork === "harvest" && DRINK_GROWER_ACTIONS[job]) return DRINK_GROWER_ACTIONS[job];
  if (action === "work" && fieldWork === "sow" && DRINK_GROWER_ACTIONS[job]) return "plant_seedling";
  if (action === "work" && DRINK_MAKER_ACTIONS[job]) return DRINK_MAKER_ACTIONS[job];
  if (action === "work" && fieldWork === "harvest") {
    if (job === "Beekeeper") return "lift_honeycomb";
    if (job === "Winegrower") return "pick_grapes";
  }
  if (action === "work") return workActions[job] ?? "idle_breathe";
  return "idle_breathe";
};

export interface WorkerHeldProp {
  id: string;
  source: "pack" | "ware" | "tool";
}
/** Carried ware, or the default load of a shoulder (logs) or back (flour) carry. */
const getCarriedWareId = (carryingWare: string | null | undefined, action: string) => {
  if (carryingWare) return resolveWareId(carryingWare) ?? carryingWare;
  return action === "carry_shoulder" ? "logs" : "flour";
};

export const getWorkerHeldProp = (
  frame: Pick<WorkerFrame, "action" | "carryingWare" | "combat" | "fieldWork" | "workerJob" | "workerTool"
    | "wareTransfer" | "fisherBasket">
): WorkerHeldProp | null => {
  if (frame.fisherBasket) return { id: "fisher_basket", source: "ware" };
  if (frame.action === "boat_lift" && frame.carryingWare === "boat") return { id: "boat", source: "ware" };
  if (frame.wareTransfer)
    return {
      id: resolveWareId(frame.wareTransfer.ware) ?? frame.wareTransfer.ware,
      source: "ware"
    };
  if (frame.action === "carry_shoulder" || frame.action === "carry_back" || frame.action === "carry_overhead_boat")
    return {
      id: getCarriedWareId(frame.carryingWare, frame.action),
      source: "ware"
    };
  if (frame.action === "harvest_flax") return { id: "flax_bundle", source: "pack" };
  if (frame.action === "weave_loom") return { id: "weaver_shuttle", source: "pack" };
  if (isFarmerJob(frame.workerJob) && frame.fieldWork === "sow") return null;
  if (frame.action === "spyglass_scan") return { id: "spyglass", source: "tool" };
  if (frame.action === "chop_tree") return { id: "axe", source: "pack" };
  if (frame.action === "harvest_wheat") return { id: "scythe", source: "pack" };
  if (frame.action === "dig") return { id: "shovel", source: "pack" };
  if (frame.action === "plant_seedling") return { id: frame.workerJob === "Forester" ? "shovel" : "seedling", source: "pack" };
  if (frame.action.startsWith("fish_")) return { id: "fishing_rod", source: "pack" };
  if (frame.action !== "build_hammer") {
    if (!frame.workerTool || !["walk", "run", "idle_breathe"].includes(frame.action)) return null;
    const id = resolveWareId(frame.workerTool) ?? frame.workerTool;
    const packTools: Record<string, string> = {
      axe: "axe",
      hammer: "hammer",
      shovel: "shovel",
      scythe: "scythe",
      fishingRod: "fishing_rod"
    };
    return packTools[id] ? { id: packTools[id], source: "pack" } : { id, source: "tool" };
  }
  if (frame.workerJob === "Miner" || frame.workerJob === "Stonemason")
    return { id: "pickaxe", source: "tool" };
  if (frame.workerJob === "Butcher" || frame.workerJob === "Skinner")
    return { id: "cleaver", source: "tool" };
  return { id: "hammer", source: "pack" };
};

/**
 * Issued military equipment stays equipped; it is not a transported stock load. Swordsmen carry
 * a shield; archers only their bow, also in close quarters (owner decision 2026-10-12).
 */
export const getWorkerSecondaryProp = (
  frame: Pick<WorkerFrame, "action" | "combat" | "workerJob" | "workerTool">
): WorkerHeldProp | null => {
  if (frame.workerJob !== "Soldier" || !["walk", "run", "idle_breathe"].includes(frame.action)) return null;
  return !frame.combat?.doorMelee && frame.workerTool === "sword" ? { id: "shield", source: "tool" } : null;
};

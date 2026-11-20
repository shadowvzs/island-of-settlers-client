import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { UnitDecisionReasonCode } from "../../shared/settlement/unit-decision-diagnostics";

/** Localized Observe-window captions of every unit decision reason. */
export const UNIT_DECISION_MESSAGES: Record<UnitDecisionReasonCode, MessageDescriptor> = {
  "blocked-door": msg({ id: "settlement.unitReason.blockedDoor", message: "Blocked at the door" }),
  "building-paused": msg({ id: "settlement.unitReason.buildingPaused", message: "Building paused" }),
  "commander-order": msg({ id: "settlement.unitReason.commanderOrder",
    message: "Following a commander order" }),
  "fighting": msg({ id: "settlement.unitReason.fighting", message: "Fighting" }),
  "inactive": msg({ id: "settlement.workerPhase.inactive", message: "Inactive" }),
  "no-claim": msg({ id: "settlement.unitReason.noClaim", message: "No transport claim" }),
  "no-path": msg({ id: "settlement.unitReason.noPath", message: "No path to the target" }),
  "no-work": msg({ id: "settlement.unitReason.noWork", message: "No work available" }),
  "queued": msg({ id: "settlement.unitReason.queued", message: "Waiting in a queue" }),
  "resting": msg({ id: "settlement.unitReason.resting", message: "Resting" }),
  "retreating": msg({ id: "settlement.unitReason.retreating", message: "Retreating" }),
  "search-budget": msg({ id: "settlement.unitReason.searchBudget",
    message: "Path search budget exhausted" }),
  "tool-missing": msg({ id: "settlement.unitReason.toolMissing", message: "Waiting for a tool" }),
  "waiting": msg({ id: "settlement.unitReason.waiting", message: "Waiting" }),
  "waiting-for-storage": msg({ id: "settlement.unitReason.waitingForStorage",
    message: "Waiting for storage space" }),
  "waiting-for-ware": msg({ id: "settlement.unitReason.waitingForWare",
    message: "Waiting for materials" }),
  "walking": msg({ id: "settlement.unitReason.walking", message: "Walking" }),
  "working": msg({ id: "settlement.unitReason.working", message: "Working" })
};

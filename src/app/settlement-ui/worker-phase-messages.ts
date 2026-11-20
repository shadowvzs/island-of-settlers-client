import { msg } from "@lingui/core/macro";

/** Read-only worker phase captions; they describe the existing fixed-tick phase, not a second clock. */
export const WORKER_PHASE_MESSAGES = {
  clock: {
    construction: msg({ id: "settlement.workerPhase.construction", message: "Building" }),
    growth: msg({ id: "settlement.workerPhase.growth", message: "Growing" }),
    handling: msg({ id: "settlement.workerPhase.handling", message: "Handling" }),
    inactive: msg({ id: "settlement.workerPhase.inactive", message: "Inactive" }),
    other: msg({ id: "settlement.workerPhase.other", message: "Active" }),
    rest: msg({ id: "settlement.workerPhase.rest", message: "Resting" }),
    travel: msg({ id: "settlement.workerPhase.travel", message: "Walking" }),
    wait: msg({ id: "settlement.workerPhase.wait", message: "Waiting" }),
    work: msg({ id: "settlement.workerPhase.work", message: "Working" })
  },
  rate: msg({ id: "settlement.workerPhase.rate", message: "{percent}% work rate" }),
  remaining: msg({ id: "settlement.workerPhase.remaining", message: "{seconds}s left" })
} as const;

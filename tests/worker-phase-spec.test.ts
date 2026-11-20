import { describe, expect, it } from "vitest";

import { PRODUCTION_SPEED_FACTOR, WARE_TRANSFER_SECONDS, WORKER_REST_SECONDS } from "../src/shared/balance/economy";
import { talentModifiers, type TalentRanks } from "../src/shared/progression/talents";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { workerPhaseSpec } from "../src/shared/settlement/worker-phase-spec";
import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

const talents = (ranks: TalentRanks) => ({ talents: talentModifiers(ranks) });
const building = { construction: 1, input: {}, output: {}, typeId: 35, uid: 3, worker: 1 } as SettlementBuilding;
const actor = (extra: Partial<SettlementActor>) => ({
  action: "work", building: 3, job: "Carpenter", phase: "work", timer: 4, uid: 1, ...extra
} as SettlementActor);
const context = (extra: Partial<SettlementContext> = {}) => ({
  buildings: [building], playerNation: "roman", ...talents({ constructionSpeed: 5, productionSpeed: 5 }), ...extra
} as unknown as SettlementContext);

describe("read-only worker phase specification", () => {
  it("reports the exact rate shares, authored time and progress of in-place work", () => {
    const spec = workerPhaseSpec(context(), actor({ productionSeconds: 8, timer: 6 }));
    expect(spec).toMatchObject({ clock: "work", rateApplies: true, authoredSeconds: 8, remainingSeconds: 6, progress: .25 });
    expect(spec.rate).toBeCloseTo(1.1 * PRODUCTION_SPEED_FACTOR);
    expect(spec.levelShare).toBe(0);
    expect(spec.talentShare).toBeCloseTo(.1);
    expect(spec.ownership).toBe("none");
    expect(spec.wake).toBe("timer");
  });

  it("separates travel, handling, rest, waiting and external growth", () => {
    expect(workerPhaseSpec(context(), actor({ phase: "outbound", timer: 0 })))
      .toMatchObject({ clock: "travel", rateApplies: false, wake: "arrival" });
    const handling = workerPhaseSpec(context(), actor({ phase: "inputPickup", timer: WARE_TRANSFER_SECONDS, ware: "logs" }));
    expect(handling).toMatchObject({ authoredSeconds: WARE_TRANSFER_SECONDS, clock: "handling",
      ownership: "carrying", wake: "transfer" });
    expect(workerPhaseSpec(context(), actor({ phase: "rest", timer: WORKER_REST_SECONDS })))
      .toMatchObject({ authoredSeconds: WORKER_REST_SECONDS, clock: "rest", rateApplies: true });
    expect(workerPhaseSpec(context(), actor({ phase: "inside", timer: 0 })))
      .toMatchObject({ clock: "wait", rateApplies: false, wake: "retry" });
    expect(workerPhaseSpec(context(), actor({ phase: "waitTreeFall", timer: 0 })))
      .toMatchObject({ clock: "growth", rateApplies: false, wake: "growth" });
  });

  it("reports construction hammering and the construction talent, not a production rate", () => {
    const spec = workerPhaseSpec(context(), actor({ action: "work", phase: "builderWork", uid: 9 }));
    expect(spec).toMatchObject({ clock: "construction", rateApplies: true, ownership: "construction-supplies",
      talentShare: .15, levelShare: 0 });
    expect(spec.rate).toBeCloseTo(1.20); // talent .15 + Roman construction .05
  });

  it("classifies retired and unknown phases without a rate or timer claim", () => {
    expect(workerPhaseSpec(context(), actor({ phase: "retired", timer: 0 })))
      .toMatchObject({ clock: "inactive", rateApplies: false, wake: "none" });
    expect(workerPhaseSpec(context(), actor({ phase: "customPhase", timer: 0 })))
      .toMatchObject({ clock: "other", rateApplies: false });
  });

  it("reads the real simulation's assigned worker without advancing it", () => {
    const { advance, building, simulation } = workshopUpgradeFixture(35, {});
    advance(30, () => building.worker !== undefined);
    expect(building.worker).toBeDefined();
    const spec = simulation.workerPhase(building.worker!);
    expect(spec?.phase).toBeTruthy();
    expect(["work", "rest", "travel", "wait", "handling", "other"]).toContain(spec!.clock);
  });
});

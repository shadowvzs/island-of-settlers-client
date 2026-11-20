import { describe, expect, it } from "vitest";

import { validateNavalPassengers } from "../src/shared/settlement/settlement-naval-validation";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";

const passengerSave = (phase: string) => ({
  actors: [{ uid: 3, job: "Soldier", phase, navalOrder: 7, visible: true, ware: null, tool: "sword" }],
  naval: { fleet: { orders: [], ships: [{ id: 1, orderId: 7, passengers: [3], cargo: {} }] } }
}) as unknown as SettlementSaveV1;

describe("owned ship boarding save references", () => {
  it.each(["navalToShip", "navalBoarding", "navalDeckWalk", "navalAboard", "navalDisembark", "navalLanding",
    "navalLandingEnter"])(
    "accepts %s only with its owned ship receipt", phase => {
      const saved = passengerSave(phase);
      expect(validateNavalPassengers(saved)).toBeNull();
      saved.naval.fleet.ships[0]!.passengers = [];
      expect(validateNavalPassengers(saved)).toBe("Unowned passenger reservation");
    });

  it("rejects a boarding phase held only by a queued order", () => {
    const saved = passengerSave("navalBoarding");
    saved.naval.fleet.ships = [];
    saved.naval.fleet.orders = [{ id: 7, passengers: [3], cargo: {} }] as never;
    expect(validateNavalPassengers(saved)).toBe("Invalid passenger identity or reservation");
  });

  it("rejects an unreserved deck actor and preserves older hidden aboard receipts", () => {
    const saved = passengerSave("navalAboard");
    saved.actors[0]!.navalOrder = undefined;
    expect(validateNavalPassengers(saved)).toBe("Invalid passenger identity or reservation");
    saved.actors[0]!.navalOrder = 7;
    saved.actors[0]!.visible = false;
    expect(validateNavalPassengers(saved)).toBeNull();
  });
});


it.each(["navalFerry", "navalBoarding", "navalAboard", "navalLandingEnter"])(
  "requires exactly one owned spyglass-equipped Scout during exploration in %s", phase => {
    const saved = passengerSave(phase);
    saved.world = { cellsX: 64, cellsZ: 64, seed: 1 };
    saved.actors = [{ ...saved.actors[0]!, job: "Scout", tool: "spyglass" }];
    const receipt = saved.naval.fleet.ships[0]!;
    receipt.passengers = [3];
    receipt.exploration = { cursor: 0, points: [{ x: 48, z: 40 }], returning: false };
    expect(validateNavalPassengers(saved)).toBeNull();
    saved.actors[0]!.tool = "bow";
    expect(validateNavalPassengers(saved)).toBe("Invalid passenger identity or reservation");
    saved.actors[0]!.tool = undefined;
    expect(validateNavalPassengers(saved)).toBe("Invalid exploration receipt or scout crew");
    saved.actors[0]!.tool = "spyglass";
    saved.actors.push({ ...saved.actors[0]!, uid: 4 });
    receipt.passengers = [3, 4];
    expect(validateNavalPassengers(saved)).toBe("Invalid exploration receipt or scout crew");
  }
);

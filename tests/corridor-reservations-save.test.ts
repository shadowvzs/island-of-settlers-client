import { describe, expect, it } from "vitest";

import {
  acquireCorridor, clearCorridorReservations, corridorReservation,
  restoreCorridorReservations, saveCorridorReservations
} from "../src/shared/settlement/settlement-corridor-reservations";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

const context = {
  navigationRevision: 1, buildings: [],
  options: { roads: { revision: 2 }, world: { buildRevision: 3, terrainRevision: 4 } }
} as unknown as SettlementContext;
const actor = { uid: 1, phase: "walk" } as unknown as SettlementActor;

describe("corridor reservation persistence", () => {
  it("round-trips reservations through the save representation", () => {
    clearCorridorReservations(context);
    expect(acquireCorridor(context, actor, [{ x: 0, z: 0 }, { x: 4, z: 0 }]).ok).toBe(true);
    const saved = saveCorridorReservations(context);
    clearCorridorReservations(context);
    expect(corridorReservation(context, actor.uid)).toBeUndefined();
    restoreCorridorReservations(context, saved);
    expect(corridorReservation(context, actor.uid)).toMatchObject({
      actor: actor.uid, phase: "walk", revision: "1/2/3/4/0"
    });
  });

  it("ignores malformed saved entries", () => {
    restoreCorridorReservations(context, [
      [1, "walk", "revision", 600, ["1,1"]],
      ["bad", "walk", "revision", 600, ["1,1"]] as never
    ]);
    expect(corridorReservation(context, 1)?.cells).toEqual(["1,1"]);
  });
});

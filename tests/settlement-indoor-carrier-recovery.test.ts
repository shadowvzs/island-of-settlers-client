import { expect, it } from "vitest";

import { recoverUndepartedCarrier } from "../src/shared/settlement/settlement-indoor-carrier-recovery";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

const fixture = () => {
  const actor = { uid: 7, x: 10, z: 10.5, job: "Carrier", home: 0, building: 8,
    visible: false, phase: "home", path: [{ x: 10, z: 13 }], pathIndex: 0, timer: 50 } as SettlementActor;
  const context = { actors: [actor], buildings: [{ uid: 0, typeId: 29, construction: 1,
    inventory: {}, doorThreshold: { x: 10, z: 10.5 } }] } as SettlementContext;
  return { actor, context };
};

it("repairs an already-saved empty indoor return without changing its person, position or goods", () => {
  const { actor, context } = fixture();
  expect(recoverUndepartedCarrier(context, actor)).toBe(true);
  expect(actor).toMatchObject({ uid: 7, x: 10, z: 10.5, home: 0, building: 0,
    visible: false, phase: "inside", path: [], action: "idle", timer: 0 });
});

it.each([false, true])("restores exactly the cargo still inside its own home, visible=%s", visible => {
  const { actor, context } = fixture();
  Object.assign(actor, { visible, phase: visible ? "returnBlockedCarrier" : "home", ware: "stone",
    wareUnits: 2, navigationReturnCargo: true });
  expect(recoverUndepartedCarrier(context, actor)).toBe(true);
  expect(context.buildings[0]!.inventory.stone).toBe(2);
  expect(actor).toMatchObject({ uid: 7, x: 10, z: 10.5, visible: false, phase: "inside", ware: null });
  expect(actor.navigationReturnCargo).toBeUndefined();
  expect(recoverUndepartedCarrier(context, actor)).toBe(false);
  expect(context.buildings[0]!.inventory.stone).toBe(2);
});

it.each<Partial<SettlementActor>>([
  { visible: true }, { x: 11 },
  { visible: true, x: 11, phase: "returnBlockedCarrier", ware: "stone", navigationReturnCargo: true }, { ware: "stone" }, { navigationReturnCargo: true },
  { delivery: { source: 8, destination: 0, ware: "stone" } }, { phase: "pickup" }, { job: "Builder" }
])("preserves an outside, loaded, claimed or unrelated actor: %j", override => {
  const { actor, context } = fixture();
  Object.assign(actor, override);
  const before = structuredClone(actor);
  expect(recoverUndepartedCarrier(context, actor)).toBe(false);
  expect(actor).toEqual(before);
});

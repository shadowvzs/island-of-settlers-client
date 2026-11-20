import { expect, it } from "vitest";

import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { shipRegisterManifest } from "../src/shared/settlement/ship-register-manifest";

it("keeps off-map outbound troops visible after their actor records leave home", () => {
  const manifest = { cargo: { planks: 4 }, jobs: { Soldier: 3, Builder: 1 }, troops: { archer: 2, shield: 1 } };
  const ship = { phase: "away", timer: 200, cargo: {}, passengers: [],
    colony: { voyageSeconds: 150, arrived: false, manifest } } as unknown as NavalShip;
  const context = { actors: [] } as unknown as SettlementContext;
  expect(shipRegisterManifest(ship, context)).toEqual(manifest);
  ship.timer = 100;
  expect(shipRegisterManifest(ship, context)).toEqual({ cargo: {}, jobs: {}, troops: {} });
});

it("shows the fetched homeward load only after collection", () => {
  const ship = { phase: "away", timer: 200, cargo: {}, passengers: [],
    colony: { voyageSeconds: 150, homeward: { cargo: { stone: 8 },
      troops: [{ type: "archer", hp: 56.25, rank: 0 }] } } } as unknown as NavalShip;
  const context = { actors: [] } as unknown as SettlementContext;
  expect(shipRegisterManifest(ship, context).cargo).toEqual({});
  ship.timer = 100;
  expect(shipRegisterManifest(ship, context)).toEqual({ cargo: { stone: 8 }, jobs: { Soldier: 1 }, troops: { archer: 1 } });
});

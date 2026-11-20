import { describe, expect, it } from "vitest";

import type { SettlementFieldFrame } from "../src/shared/settlement/settlement-field-cycles";
import { createPlacementSession, PLACEMENT_SIZE } from "./helpers/placement-session";

const WOODCUTTER = 17;

const stubble = (x: number, z: number): SettlementFieldFrame => ({
  id: z * PLACEMENT_SIZE + x, kind: "grain", x: x + .5, z: z + .5,
  owner: 0, progress: 0, state: "stubble", step: 0
});

describe("building placement over farm plots", () => {
  it("refuses a building over bare stubble so the farm keeps its sowable land", () => {
    const { simulation } = createPlacementSession();
    expect(simulation.validatePlacement(WOODCUTTER, 55, 55, 0)).toBeNull();
    const saved = simulation.saveState();
    saved.fields = [stubble(55, 55)];
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.validatePlacement(WOODCUTTER, 55, 55, 0))
      .toMatch(/overlaps an active crop or charcoal site/);
  });

  it("still allows a plot clear of every field site", () => {
    const { simulation } = createPlacementSession();
    const saved = simulation.saveState();
    saved.fields = [stubble(55, 55)];
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.validatePlacement(WOODCUTTER, 58, 55, 0)).toBeNull();
  });
});

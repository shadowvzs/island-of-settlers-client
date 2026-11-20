import { describe, expect, it, vi } from "vitest";

import { createShoreShellPicking } from "../src/app/settlement/shore-shell-picking";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { WorldData } from "../src/shared/world/world-data";

const world = { cellsX: 8, cellsZ: 8, heights: new Float32Array(81) } as unknown as WorldData;

const createFixture = (drawsShells: boolean) => {
  const refreshFieldCover = vi.fn();
  const collectShoreShell = vi.fn((index: number) =>
    ({ event: { index }, from: { x: 2, z: 2 }, to: { x: 6, z: 6 } }));
  const simulation = {
    collectShoreShell,
    movedShoreShells: () => [],
    shoreShellPositions: () => [{ x: 2, z: 2 }, { x: 5, z: 1 }]
  } as unknown as SettlementSimulation;
  const renderer = {
    drawsShoreShells: () => drawsShells,
    mapEdit: { refreshFieldCover },
    // Plain top-down projection: 100 px per cell, depth by z.
    projectToViewport: (x: number, _y: number, z: number) => ({ depth: z, x: x * 100, y: z * 100 })
  } as unknown as Parameters<typeof createShoreShellPicking>[0]["renderer"];
  return { collectShoreShell, picking: createShoreShellPicking({ renderer, simulation, world }), refreshFieldCover };
};

describe("shore shell picking", () => {
  it("collects the shell under the pointer and redraws its old and new place", () => {
    const { collectShoreShell, picking, refreshFieldCover } = createFixture(true);
    expect(picking.pick(505, 95)).toBe(1);
    expect(picking.click(205, 198)).toBe(true);
    expect(collectShoreShell).toHaveBeenCalledWith(0);
    expect(refreshFieldCover).toHaveBeenCalledTimes(2);
    expect(picking.click(400, 400)).toBe(false);
  });

  it("collects nothing where the preset draws no shells (Minimal)", () => {
    const { collectShoreShell, picking } = createFixture(false);
    expect(picking.click(200, 200)).toBe(false);
    expect(collectShoreShell).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";

import { projectToScreen, unprojectToPlane } from "../src/render-common/iso-projection";

describe("iso projection", () => {
  it("round trips through the plane at a height", () => {
    const { screenX, screenY } = projectToScreen(12.5, 3, 40.25);
    const back = unprojectToPlane(screenX, screenY, 3);
    expect(back.x).toBeCloseTo(12.5, 6);
    expect(back.z).toBeCloseTo(40.25, 6);
  });

  it("draws a cell as a 2:1 diamond", () => {
    const right = projectToScreen(1, 0, 0);
    const down = projectToScreen(1, 0, 1);
    expect(right.screenX * 2).toBeCloseTo(projectToScreen(1, 0, -1).screenX, 6);
    expect(down.screenX).toBeCloseTo(0, 6);
    expect(Math.abs(projectToScreen(1, 0, -1).screenX) / down.screenY).toBeCloseTo(2, 6);
  });
});

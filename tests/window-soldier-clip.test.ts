import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import {
  garrisonSlots, garrisonWindowFrame, placeGarrisonSlot
} from "../src/render-common/buildings/military-garrison-slots";
import {
  placeWindowSoldier, WINDOW_HEAD_SIDE_TOLERANCE
} from "../src/render-common/buildings/window-soldier-head-envelope";
import { WINDOW_HEAD_CENTRE_MARGIN } from "../src/render-common/buildings/window-soldier-lean-fit";
import { windowSoldierPose } from "../src/render-common/buildings/window-soldier-pose";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { windowShadowMaterial } from "../src/renderers/three/buildings/window-shadow-material";
import { WINDOW_SOLDIER_NATIONS, WINDOW_SOLDIER_TYPES, windowSoldierAudit } from "../tools/bench/window-soldier-audit";

const BUILDING = { rotation: 0, x: 10, y: 1, z: 20 };
/** Steepest drawn lean: a steeper figure reads as falling out of the window. */
const MAX_LEAN = .85 + 1e-9;

describe("window soldier clip", () => {
  const rows = windowSoldierAudit();
  const label = (row: (typeof rows)[number]) =>
    `${row.nation}/${row.type}/w${row.index}/${row.detailed ? "high" : "minimal"}/${row.rank}`;

  it("measures every window slot of every nation, both presets and every rank", () => {
    expect(rows.length).toBeGreaterThan(500);
    expect(new Set(rows.map(row => row.nation))).toEqual(new Set(WINDOW_SOLDIER_NATIONS.filter(nation =>
      WINDOW_SOLDIER_TYPES.some(type => garrisonSlots(type, nation).some(slot => slot.kind === "window")))));
  });

  it("never puts the helmet into the wall above the opening", () => {
    for (const row of rows) expect(row.helmetTopClearance, label(row)).toBeGreaterThanOrEqual(-1e-9);
  });

  it("keeps the head in front of the window insert, never behind it", () => {
    for (const row of rows)
      expect(row.headCentreProud, label(row)).toBeGreaterThanOrEqual(WINDOW_HEAD_CENTRE_MARGIN - 1e-9);
  });

  it("keeps ordinary helmets between the jambs (only wide ceremonial crests are exceptions)", () => {
    for (const row of rows.filter(entry => entry.rank !== "centurion"))
      expect(row.sideClearance, label(row)).toBeGreaterThanOrEqual(-WINDOW_HEAD_SIDE_TOLERANCE - 1e-9);
  });

  it("leans the figure out over the sill without tipping it out of the window", () => {
    for (const row of rows) {
      expect(row.lean, label(row)).toBeGreaterThan(0);
      expect(row.lean, label(row)).toBeLessThanOrEqual(MAX_LEAN);
    }
  });

  it("never lets the transparent window insert hide a figure standing in front of it", () => {
    const material = windowShadowMaterial(new MeshStandardMaterial());
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.opacity).toBe(.5);
  });

  it("keeps the shared simulation slot untouched: only the drawn window soldier moves", () => {
    for (const nation of WINDOW_SOLDIER_NATIONS as WorkerNation[]) for (const typeId of WINDOW_SOLDIER_TYPES)
      for (const detailed of [true, false]) for (const slot of garrisonSlots(typeId, nation, detailed)) {
        const shared = placeGarrisonSlot(slot, BUILDING);
        const text = `${nation}/${typeId}/${detailed}/${slot.kind}`;
        expect(shared.y, text).toBeCloseTo(BUILDING.y + slot.position[1], 9);
        const frame = garrisonWindowFrame(slot);
        if (!frame) continue;
        expect(slot.kind, text).toBe("window");
        const fit = windowSoldierPose(frame, nation, "soldier");
        const drawn = placeWindowSoldier(shared, BUILDING.y, frame, fit);
        const outwardX = Math.sin(slot.yaw), outwardZ = Math.cos(slot.yaw);
        const across = (drawn.x - BUILDING.x) * outwardX + (drawn.z - BUILDING.z) * outwardZ;
        expect(across, text).toBeCloseTo(fit.feetOutward, 9);
        expect(drawn.y, text).toBeCloseTo(BUILDING.y + fit.rootY, 9);
        expect(drawn.yaw, text).toBe(shared.yaw);
      }
  });
});

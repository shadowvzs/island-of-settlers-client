import { Matrix4 } from "three";
import { expect, it, vi } from "vitest";

import { createThreeHiveCombs } from "../src/renderers/three/settlement/three-hive-combs";

it("replaces the middle table comb with one held instance and clears it on release", () => {
  const context = {
    beginPath() {},
    closePath() {},
    fill() {},
    fillRect() {},
    lineTo() {},
    moveTo() {},
    createRadialGradient: () => ({ addColorStop() {} })
  };
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => context, width: 0, height: 0 })
  });
  try {
    const combs = createThreeHiveCombs(false),
      bench = new Matrix4(),
      hand = new Matrix4().makeTranslation(1, 2, 3);
    combs.begin();
    combs.pushHeld(bench, hand);
    combs.commit();
    expect(combs.mesh.count).toBe(0);
    expect(combs.remaining.count).toBe(1);
    expect(combs.held.count).toBe(1);
    const matrix = new Matrix4();
    combs.held.getMatrixAt(0, matrix);
    expect(matrix.elements).toEqual(hand.elements);
    combs.begin();
    combs.push(bench);
    combs.commit();
    expect(combs.mesh.count).toBe(1);
    expect(combs.held.visible).toBe(false);
    expect(combs.remaining.visible).toBe(false);
    combs.begin();
    combs.commit();
    expect(combs.mesh.visible).toBe(false);
    expect(combs.mesh.castShadow).toBe(false);
    expect(combs.held.castShadow).toBe(false);
    combs.dispose();
  } finally {
    vi.unstubAllGlobals();
  }
});

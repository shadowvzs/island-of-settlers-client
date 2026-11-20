import { expect, it } from "vitest";

import { createFellingSimulation } from "../src/render-common/felling/felling-simulation";
import { createTreeGrowth } from "../src/render-common/growth/tree-growth";

it("restores planted ages, grown trees and editor removals without restarting sprouts", () => {
  const growth = createTreeGrowth([1, 2], 7, () => true);
  growth.start();
  growth.update(40);
  growth.plant(3);
  growth.update(55);
  growth.remove([2]);
  const saved = JSON.parse(JSON.stringify(growth.saveState()));
  const restored = createTreeGrowth([], 7, () => true);
  restored.loadState(saved);
  expect([...restored.frame.growing()]).toEqual([...growth.frame.growing()]);
  restored.update(90);
  growth.update(90);
  expect(restored.saveState()).toEqual(growth.saveState());
  restored.restore([2]);
  growth.restore([2]);
  expect(restored.saveState()).toEqual(growth.saveState());
});

it("resumes real tree chopping/falling timing and removes its harvested prop once", () => {
  const body = { x: 0, y: 0, z: 0, canopyRadius: 1, canopyHeight: 2 };
  let removed = 0;
  const felling = createFellingSimulation(() => body, 5);
  felling.update(10);
  felling.fell(1);
  felling.update(13.2);
  const saved = JSON.parse(JSON.stringify(felling.saveState()));
  const restored = createFellingSimulation(
    () => body,
    5,
    () => removed++
  );
  restored.loadState(saved);
  expect(restored.frame.getState(1).chop).toEqual(felling.frame.getState(1).chop);
  expect(restored.getPhase(1)).toBe("falling");
  restored.update(20);
  restored.update(21);
  expect(removed).toBe(1);
  expect([...restored.frame.felledIds()]).toEqual([]);
});

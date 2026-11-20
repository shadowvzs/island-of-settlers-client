import { OrthographicCamera } from "three";
import { describe, expect, it } from "vitest";

import {
  characterShadowScore,
  createShadowCasterSelection,
  type ShadowCaster
} from "../src/renderers/three/character-shadow-casters";

const caster = () => {
  const state = { casting: false };
  const item: ShadowCaster & { state: typeof state } = { setCaster: on => { state.casting = on; }, state };
  return item;
};

describe("character sun shadow caster budget", () => {
  it("lets every candidate cast while the budget allows", () => {
    const selection = createShadowCasterSelection();
    const items = [caster(), caster()];
    selection.begin();
    items.forEach((item, index) => selection.offer(item, index + 1));
    expect(selection.select(4)).toBe(2);
    expect(items.map(item => item.state.casting)).toEqual([true, true]);
  });

  it("keeps the highest scores within the budget, ties in offer order, and grows past 64", () => {
    const selection = createShadowCasterSelection();
    const items = Array.from({ length: 100 }, caster);
    selection.begin();
    items.forEach((item, index) => selection.offer(item, index === 99 ? 49 : index));
    expect(selection.select(50)).toBe(50);
    const chosen = items.flatMap((item, index) => item.state.casting ? [index] : []);
    // 50..98 (49 casters) plus the tie of 49 offered first (index 49, not index 99).
    expect(chosen).toEqual(Array.from({ length: 50 }, (_, index) => index + 49));
  });

  it("switches previous casters off on a later, smaller frame and casts nothing on budget 0", () => {
    const selection = createShadowCasterSelection();
    const items = [caster(), caster(), caster()];
    selection.begin();
    items.forEach((item, index) => selection.offer(item, index));
    selection.select(3);
    selection.begin();
    items.forEach((item, index) => selection.offer(item, index));
    expect(selection.select(1)).toBe(1);
    expect(items.map(item => item.state.casting)).toEqual([false, false, true]);
    selection.begin();
    items.forEach(item => selection.offer(item, 5));
    expect(selection.select(0)).toBe(0);
    expect(items.some(item => item.state.casting)).toBe(false);
  });

  it("weights the projected size down towards the screen edge", () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, .1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    expect(characterShadowScore(camera, 0, 0, 0, 90)).toBeCloseTo(90);
    expect(characterShadowScore(camera, 10, 10, 0, 90)).toBeCloseTo(30);
  });
});

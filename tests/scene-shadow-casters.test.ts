import { BoxGeometry, Group, Mesh, Scene } from "three";
import { describe, expect, it, vi } from "vitest";

import { createSceneShadowCasters } from "../src/renderers/three/three-scene-shadow-casters";
import { SHADOW_CASTER_LAYER } from "../src/renderers/three/three-shadows";

describe("island-scene vehicle sun casters", () => {
  it("marks visible castShadow meshes and casts a root-only scene, leaving the island scene", () => {
    const scene = new Scene();
    const ships = new Group(), empty = new Group();
    const hull = Object.assign(new Mesh(new BoxGeometry()), { castShadow: true });
    const ring = new Mesh(new BoxGeometry());
    const hidden = Object.assign(new Mesh(new BoxGeometry()), { castShadow: true, visible: false });
    ships.add(hull, ring, hidden);
    ships.position.x = 4;
    scene.add(ships, empty);
    const cast = vi.fn((target: Scene) => {
      expect(target).not.toBe(scene);
      expect(target.matrixWorldAutoUpdate).toBe(false);
      expect(target.children).toEqual([ships]);
    });
    createSceneShadowCasters([ships, empty])(cast);
    expect(cast).toHaveBeenCalledOnce();
    expect(ships.parent).toBe(scene);
    expect(scene.children).toEqual([ships, empty]);
    expect(hull.layers.isEnabled(SHADOW_CASTER_LAYER)).toBe(true);
    expect(hull.layers.isEnabled(0)).toBe(true);
    expect(ring.layers.isEnabled(SHADOW_CASTER_LAYER)).toBe(false);
    expect(hidden.layers.isEnabled(SHADOW_CASTER_LAYER)).toBe(false);
    expect(hull.matrixWorld.elements[12]).toBe(4);
  });

  it("skips the pass when no root holds anything", () => {
    const scene = new Scene(), carts = new Group();
    scene.add(carts);
    const cast = vi.fn();
    createSceneShadowCasters([carts])(cast);
    expect(cast).not.toHaveBeenCalled();
  });
});

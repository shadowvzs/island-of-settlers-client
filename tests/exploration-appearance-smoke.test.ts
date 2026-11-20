import { Group, Sprite, Texture } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createExplorationSmokeAdapter,
  createExplorationSmokeModel,
  EXPLORATION_SMOKE_COLORS,
  EXPLORATION_SMOKE_MAX_PARTICLES
} from "../src/renderers/three/exploration/exploration-smoke";

const frame = (progress: number, kind: "arrival" | "departure" = "arrival") => ({
  kind,
  progress,
  x: 4,
  y: 2,
  z: 7
});

describe("exploration arrival/departure smoke", () => {
  it("keeps every particle inside the bounded upward swirl", () => {
    const model = createExplorationSmokeModel({ seed: 12 });
    const burst = model.burst("arrival", { x: 4, y: 2, z: 7 });
    expect(burst.active).toBe(true);
    expect(burst.count).toBeGreaterThan(0);
    expect(burst.count).toBeLessThanOrEqual(EXPLORATION_SMOKE_MAX_PARTICLES);

    for (const progress of [0, 0.15, 0.5, 0.9, 0.999]) {
      const sample = model.update(frame(progress));
      expect(sample.count).toBeLessThanOrEqual(EXPLORATION_SMOKE_MAX_PARTICLES);
      for (const particle of sample.particles.slice(0, sample.count)) {
        expect(Math.hypot(particle.x - 4, particle.z - 7)).toBeLessThanOrEqual(0.551);
        expect(particle.y).toBeGreaterThanOrEqual(2);
        expect(particle.y).toBeLessThanOrEqual(3.801);
        expect(particle.scale).toBeGreaterThan(0);
        expect(particle.opacity).toBeGreaterThanOrEqual(0);
        expect(particle.opacity).toBeLessThanOrEqual(1);
      }
    }
    expect(model.update(frame(1)).active).toBe(false);
  });

  it("uses deterministic presentation randomness and never calls gameplay Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const first = createExplorationSmokeModel({ seed: 77 });
    const second = createExplorationSmokeModel({ seed: 77 });
    const different = createExplorationSmokeModel({ seed: 78 });
    const a = first.burst("departure", { x: 1, y: 0, z: 2 });
    const b = second.burst("departure", { x: 1, y: 0, z: 2 });
    expect(b.particles.slice(0, b.count)).toEqual(a.particles.slice(0, a.count));
    expect(first.update(frame(0.4, "departure")).particles.slice(0, a.count))
      .toEqual(second.update(frame(0.4, "departure")).particles.slice(0, a.count));
    const c = different.burst("departure", { x: 1, y: 0, z: 2 });
    expect(c.particles.slice(0, c.count)).not.toEqual(a.particles.slice(0, a.count));
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it("keeps distinct pale blue-white arrival and departure colours", () => {
    const channels = (color: number) => ({
      b: color & 0xff,
      g: (color >> 8) & 0xff,
      r: (color >> 16) & 0xff
    });
    for (const color of [EXPLORATION_SMOKE_COLORS.arrival, EXPLORATION_SMOKE_COLORS.departure]) {
      const { b, g, r } = channels(color);
      expect(b).toBeGreaterThanOrEqual(g);
      expect(g).toBeGreaterThanOrEqual(r);
      expect(b - r).toBeGreaterThan(20);
    }
    expect(EXPLORATION_SMOKE_COLORS.arrival).not.toBe(EXPLORATION_SMOKE_COLORS.departure);
  });

  it("clears immediately without a simulation timer and can be disposed twice", () => {
    let time = 0;
    const model = createExplorationSmokeModel({ now: () => time, seed: 5 });
    model.burst("arrival", { x: 0, y: 0, z: 0 });
    expect(model.tick().active).toBe(true);
    time = 2_000;
    expect(model.tick().active).toBe(false);
    expect(model.update(frame(0.5)).active).toBe(true);
    expect(model.update(null).active).toBe(false);
    model.dispose();
    model.dispose();
    expect(model.update(frame(0.5)).active).toBe(false);
  });

  it("pools bounded sprites, renders the sample and releases materials and texture once", () => {
    const parent = new Group();
    const adapter = createExplorationSmokeAdapter({ parent, seed: 9 });
    expect(parent.children).toHaveLength(1);
    expect(adapter.stats()).toMatchObject({ active: false, disposed: false, drawn: 0,
      pooled: EXPLORATION_SMOKE_MAX_PARTICLES });

    adapter.burst("arrival", { x: 0, y: 1, z: 0 });
    adapter.update(frame(0.5));
    expect(adapter.stats().drawn).toBe(26);
    const root = parent.children[0]!;
    const sprites = root.children.filter((child): child is Sprite => child instanceof Sprite);
    expect(sprites).toHaveLength(EXPLORATION_SMOKE_MAX_PARTICLES);
    const materials = sprites.map(sprite => sprite.material);
    const textures = new Set<Texture>();
    for (const material of materials) if (material.map) textures.add(material.map);
    expect(textures.size).toBe(1);
    const materialDisposals = materials.map(material => vi.spyOn(material, "dispose"));
    const textureDisposals = [...textures].map(texture => vi.spyOn(texture, "dispose"));

    adapter.dispose();
    adapter.dispose();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of textureDisposals) expect(dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(adapter.stats()).toMatchObject({ active: false, disposed: true, drawn: 0, pooled: 0 });
  });
});

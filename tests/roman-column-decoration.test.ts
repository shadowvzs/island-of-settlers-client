import { Box3, type DataTexture,Mesh } from "three";
import { expect, it, vi } from "vitest";

import { createRomanColumnDecoration, createRomanColumnGeometry } from "../src/renderers/three/roman-column-decoration";
import { createRomanEggCarving, createRomanFlutedShaft } from "../src/renderers/three/roman-column-geometry";

it.each([0, 1] as const)("keeps order%s grounded, inside canonical bounds and within every LOD budget", order => {
  for (const [detailed, tier, cap] of [[true, "near", 6500], [false, "near", 1800],
    [false, "far", 700]] as const) {
    const model = createRomanColumnDecoration(order, detailed, "limestone", tier);
    try {
      expect(model.root.children).toHaveLength(1);
      const mesh = model.root.children[0] as Mesh;
      const position = mesh.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index++) {
        const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
        expect(Number.isFinite(x + y + z)).toBe(true);
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(.46);
        expect(y).toBeGreaterThanOrEqual(-1e-6);
        expect(y).toBeLessThanOrEqual(order === 0 ? 3.20 : 3.36);
      }
      expect(new Box3().setFromObject(model.root).min.y).toBeCloseTo(0);
      expect(model.triangles).toBeLessThanOrEqual(cap);
      expect(mesh.geometry.getAttribute("normal").count).toBe(position.count);
      expect(mesh.geometry.getAttribute("uv").count).toBe(position.count);
    } finally { model.dispose(); }
  }
});

it("models concave flute depth and true entasis rather than relying on texture stripes", () => {
  const geometry = createRomanFlutedShaft("high", false), position = geometry.getAttribute("position");
  const middle = Array.from({ length: 81 }, (_, side) => {
    const index = 4 * 81 + side;
    return Math.hypot(position.getX(index), position.getZ(index));
  });
  expect(Math.max(...middle) - Math.min(...middle)).toBeGreaterThan(.017);
  expect(Math.max(...middle)).toBeGreaterThan(.202);
  geometry.dispose();
});

it("shares mineral maps by finish, keeps distinct stone families and releases once per owner", () => {
  const first = createRomanColumnDecoration(0, true, "marble");
  const second = createRomanColumnDecoration(1, true, "marble");
  const limestone = createRomanColumnDecoration(0, true, "limestone");
  const material = (model: typeof first) => (model.root.children[0] as Mesh).material as
    import("three").MeshStandardMaterial;
  const map = material(first).map as DataTexture, released = vi.fn();
  map.addEventListener("dispose", released);
  expect(material(second).map).toBe(map);
  expect(material(limestone).map).not.toBe(map);
  expect(material(first).normalMap).not.toBeNull();
  expect(material(first).roughnessMap).not.toBeNull();
  first.dispose(); first.dispose(); expect(released).not.toHaveBeenCalled();
  second.dispose(); expect(released).toHaveBeenCalledTimes(1);
  limestone.dispose();
});


it("embeds every Ionic egg into the curved echinus while retaining visible carved relief", () => {
  for (const detail of ["high", "minimal"] as const) for (let index = 0; index < 7; index++) {
    const geometry = createRomanEggCarving(index, detail), position = geometry.getAttribute("position");
    let supported = 0, relief = 0;
    for (let vertex = 0; vertex < position.count; vertex++) {
      const y = position.getY(vertex);
      const supportingRadius = y < 2.945 ? .23 + (y - 2.91) / .035 * .02 : .25;
      const offset = Math.hypot(position.getX(vertex), position.getZ(vertex)) - supportingRadius;
      if (offset < -.002) supported++;
      if (offset > .002) relief++;
    }
    expect(supported).toBeGreaterThan(0);
    expect(relief).toBeGreaterThan(0);
    geometry.dispose();
  }
});


it("keeps the Ionic painted neck band's visible surface clear of the supporting stone", () => {
  for (const detail of ["high", "minimal", "far"] as const) {
    const geometry = createRomanColumnGeometry(1, detail);
    const color = geometry.getAttribute("color"), position = geometry.getAttribute("position");
    const visibleRadii: number[] = [];
    for (let index = 0; index < position.count; index++) {
      if (Math.abs(color.getX(index) - .87) > .001) continue;
      const radius = Math.hypot(position.getX(index), position.getZ(index));
      // Inner returns penetrate their bearing. Only the outer cylindrical face is exposed.
      if (radius > .196) visibleRadii.push(radius);
    }
    expect(visibleRadii.length).toBeGreaterThan(0);
    expect(Math.min(...visibleRadii) - .195).toBeGreaterThan(.0029);
    geometry.dispose();
  }
});

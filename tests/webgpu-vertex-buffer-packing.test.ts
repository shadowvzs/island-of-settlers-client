import { BufferAttribute, BufferGeometry, Group, type InterleavedBufferAttribute, Mesh } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { createVertexBufferPacker } from "../src/renderers/three/webgpu/vertex-buffer-packing";

const VERTICES = 3;

/** The ground chunk layout: position, normal, a float water attribute and seven unorm8 vec4s. */
const createGroundGeometry = () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(VERTICES * 3), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(VERTICES * 3), 3));
  const packedNames = ["splatA", "splatB", "splatC", "shading", "surface", "theme", "variant"];
  for (const [index, name] of packedNames.entries()) {
    const values = Uint8Array.from({ length: VERTICES * 4 }, (_, item) => index * 16 + item);
    geometry.setAttribute(name, new BufferAttribute(values, 4, true));
  }
  geometry.setAttribute("water", new BufferAttribute(new Float32Array(VERTICES * 4), 4));
  geometry.setIndex([0, 1, 2]);
  geometry.computeBoundingSphere();
  return geometry;
};

const vertexBuffers = (geometry: BufferGeometry) => new Set(Object.values(geometry.attributes)
  .map(attribute => (attribute as InterleavedBufferAttribute).data ?? attribute)).size;

const readVertex = (attribute: BufferAttribute | InterleavedBufferAttribute, vertex: number) =>
  [attribute.getX(vertex), attribute.getY(vertex), attribute.getZ(vertex), attribute.getW(vertex)];

describe("WebGPU vertex buffer packing", () => {
  it("swaps an over-limit geometry for a packed twin and restores the source", () => {
    const scene = new Group();
    const source = createGroundGeometry();
    const mesh = new Mesh(source);
    scene.add(mesh);
    const packer = createVertexBufferPacker(8);
    expect(vertexBuffers(source)).toBe(10);

    const restore = packer.swapIn(scene);
    const twin = mesh.geometry;
    expect(twin).not.toBe(source);
    expect(vertexBuffers(twin)).toBeLessThanOrEqual(8);
    expect(twin.getAttribute("position")).toBe(source.getAttribute("position"));
    expect(twin.index).toBe(source.index);
    const variant = twin.getAttribute("variant") as InterleavedBufferAttribute;
    const sourceVariant = source.getAttribute("variant") as BufferAttribute;
    expect(variant.normalized).toBe(true);
    expect(readVertex(variant, 2)).toEqual(readVertex(sourceVariant, 2));
    restore();
    expect(mesh.geometry).toBe(source);
  });

  it("re-copies an edited source attribute and mirrors the draw range", () => {
    const scene = new Group();
    const source = createGroundGeometry();
    const mesh = new Mesh(source);
    scene.add(mesh);
    const packer = createVertexBufferPacker(8);
    packer.swapIn(scene)();

    const theme = source.getAttribute("theme") as BufferAttribute;
    theme.setXYZW(1, .2, .4, .6, .8);
    theme.needsUpdate = true;
    source.setDrawRange(0, 2);
    const restore = packer.swapIn(scene);
    const packedTheme = mesh.geometry.getAttribute("theme") as InterleavedBufferAttribute;
    expect(readVertex(packedTheme, 1)).toEqual(readVertex(theme, 1));
    expect(readVertex(packedTheme, 1)[0]).toBeCloseTo(.2, 2);
    expect(mesh.geometry.drawRange.count).toBe(2);
    restore();
  });

  it("leaves geometries within the limit untouched", () => {
    const scene = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
    scene.add(new Mesh(geometry));
    const packer = createVertexBufferPacker(8);
    expect(packer.twinOf(geometry)).toBeNull();
    packer.swapIn(scene);
    expect((scene.children[0] as Mesh).geometry).toBe(geometry);
  });

  it("returns the same synced twin for every draw of one source", () => {
    const source = createGroundGeometry();
    const packer = createVertexBufferPacker(8);
    const twin = packer.twinOf(source);
    expect(twin).not.toBeNull();
    expect(packer.twinOf(source)).toBe(twin);
    source.dispose();
    expect(packer.twinOf(source)).not.toBe(twin);
  });
});

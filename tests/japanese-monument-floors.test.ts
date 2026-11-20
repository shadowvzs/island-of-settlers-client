import { readFileSync } from "node:fs";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { finishJapaneseMonumentFloor } from "../src/renderers/three/buildings/japanese-monument-floor";

const loadFixture = (quality: "high" | "minimal") => {
  const bytes = readFileSync(new URL(`../assets/monuments/japanese-continuous-${quality}.glb`, import.meta.url));
  const length = bytes.readUInt32LE(12), document = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = bytes.subarray(28 + length);
  const values = (id: number) => {
    const accessor = document.accessors[id], view = document.bufferViews[accessor.bufferView];
    const width: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const size = width[accessor.type]!, itemBytes = accessor.componentType === 5123 ? 2 : 4;
    return Array.from({ length: accessor.count * size }, (_, at) => {
      const vertex = Math.floor(at / size), component = at % size;
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) +
        vertex * (view.byteStride ?? size * itemBytes) + component * itemBytes;
      if (accessor.componentType === 5126) return binary.readFloatLE(offset);
      return itemBytes === 2 ? binary.readUInt16LE(offset) : binary.readUInt32LE(offset);
    });
  };
  const root = new Group(), material = new MeshStandardMaterial(), sources: BufferGeometry[] = [];
  for (const node of document.nodes) {
    if (node.name === "Anchor.Interior") {
      const anchor = new Object3D(); anchor.name = node.name; anchor.matrix.fromArray(node.matrix);
      anchor.matrix.decompose(anchor.position, anchor.quaternion, anchor.scale); root.add(anchor);
    }
    if (!["Architecture.vermilion", "Architecture.stone"].includes(node.name)) continue;
    for (const primitive of document.meshes[node.mesh].primitives) {
      const geometry = new BufferGeometry();
      for (const [sourceName, name, size] of [["POSITION", "position", 3], ["NORMAL", "normal", 3],
        ["TEXCOORD_0", "uv", 2]] as const) {
        const accessor = primitive.attributes[sourceName];
        if (accessor !== undefined) geometry.setAttribute(name, new Float32BufferAttribute(values(accessor), size));
      }
      geometry.setIndex(values(primitive.indices)); sources.push(geometry);
      const mesh = new Mesh(geometry, material); mesh.name = node.name; root.add(mesh);
    }
  }
  return { root, sources, material };
};

const area = (geometry: BufferGeometry) => {
  const positions = geometry.getAttribute("position"), index = geometry.index;
  const count = index?.count ?? positions.count;
  let result = 0;
  for (let at = 0; at < count; at += 3) {
    const points = [0, 1, 2].map(step => new Vector3().fromBufferAttribute(positions,
      index ? index.getX(at + step) : at + step));
    result += points[1]!.sub(points[0]!).cross(points[2]!.sub(points[0]!)).length() / 2;
  }
  return result;
};

it.each(["high", "minimal"] as const)("fits boards to the actual %s hall while preserving porch, steps and source", quality => {
  const fixture = loadFixture(quality), floorMaterial = new MeshStandardMaterial();
  const stone = fixture.root.getObjectByName("Architecture.stone") as Mesh;
  const source = stone.geometry, originalPositions = Array.from(source.getAttribute("position").array);
  const originalIndices = Array.from(source.index!.array), onSourceDispose = vi.fn(), onMaterialDispose = vi.fn();
  source.addEventListener("dispose", onSourceDispose); floorMaterial.addEventListener("dispose", onMaterialDispose);
  const owned = finishJapaneseMonumentFloor(fixture.root, floorMaterial);
  try {
    expect(owned).toHaveLength(2);
    const floor = stone.getObjectByName("JapaneseInteriorFloor") as Mesh;
    expect(floor.userData.japaneseInteriorFloor).toBe(true);
    expect(floor.material).toBe(floorMaterial);
    expect(Array.from(floor.geometry.getAttribute("color").array).every(value => value === 1)).toBe(true);
    // The supplied hall's authored octagon has circumradius2.69, not a rounded2.485apothem.
    const apothem = 2.69 * Math.cos(Math.PI / 8);
    const positions = floor.geometry.getAttribute("position"), uv = floor.geometry.getAttribute("uv");
    for (let at = 0; at < positions.count; at++) {
      expect(positions.getY(at)).toBeCloseTo(.33, 6);
      expect(uv.getX(at)).toBeCloseTo(positions.getX(at), 6);
      expect(uv.getY(at)).toBeCloseTo(positions.getZ(at), 6);
      for (let side = 0; side < 8; side++) expect(positions.getX(at) * Math.cos(side * Math.PI / 4) +
        positions.getZ(at) * Math.sin(side * Math.PI / 4)).toBeLessThanOrEqual(apothem + .00001);
    }
    expect(area(floor.geometry)).toBeCloseTo(8 * apothem ** 2 * Math.tan(Math.PI / 8), 4);
    expect(area(stone.geometry) + area(floor.geometry)).toBeCloseTo(area(source), 4);
    expect(stone.geometry.boundingBox!.max.x).toBe(Array.from(source.getAttribute("position").array).reduce((best, value, at) =>
      at % 3 === 0 ? Math.max(best, Number(value)) : best, -Infinity));
    expect(Array.from(source.getAttribute("position").array)).toEqual(originalPositions);
    expect(Array.from(source.index!.array)).toEqual(originalIndices);
    expect(onSourceDispose).not.toHaveBeenCalled(); expect(onMaterialDispose).not.toHaveBeenCalled();
    const oldTriangles = source.index!.count / 3;
    const newTriangles = (stone.geometry.getAttribute("position").count + positions.count) / 3;
    expect(newTriangles - oldTriangles).toBeLessThan(96);
  } finally {
    owned.forEach(geometry => geometry.dispose()); fixture.sources.forEach(geometry => geometry.dispose());
    fixture.material.dispose(); floorMaterial.dispose();
  }
});

it("does not reinterpret an unknown supplied hall or borrow ownership of its materials", () => {
  const fixture = loadFixture("minimal"), floorMaterial = new MeshStandardMaterial();
  fixture.root.getObjectByName("Architecture.vermilion")!.removeFromParent();
  const stone = fixture.root.getObjectByName("Architecture.stone") as Mesh, original = stone.geometry;
  expect(finishJapaneseMonumentFloor(fixture.root, floorMaterial)).toEqual([]);
  expect(stone.geometry).toBe(original);
  fixture.sources.forEach(geometry => geometry.dispose()); fixture.material.dispose(); floorMaterial.dispose();
});

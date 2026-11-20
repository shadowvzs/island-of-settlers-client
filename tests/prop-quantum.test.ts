import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  decodePropPositionTicks, fitsU16Ticks, isExactPropPosition, isExactPropRotation, isExactPropScale,
  propPhase, propPositionTicks, propRotationTicks, propScaleTicks, quantisePropPosition,
  quantisePropRotation, quantisePropScale
} from "../src/shared/world/prop-quantum";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { type MapSaveInput, writeMapFile, writeMapParts } from "../src/shared/world/save/map-writer";
import { cachedWorld } from "./helpers/cached-worlds";
import { huntingWorld } from "./helpers/hunting-world";

const input: MapSaveInput = { animals: [], name: "quantised props", savedAt: 1, source: "test" };
const setProps = (world: ReturnType<typeof huntingWorld>, values: [number, number, number, number][]) => {
  world.props.count = values.length;
  for (const [index, [x, z, rotation, scale]] of values.entries()) {
    world.props.x[index] = x;
    world.props.z[index] = z;
    world.props.rotation[index] = rotation;
    world.props.scale[index] = scale;
    world.props.y[index] = 2;
    world.props.types[index] = 1;
    world.props.form[index] = 0;
    world.props.phase[index] = 0;
  }
};

describe("prop quantization", () => {
  it("uses the documented grids and rejects off-grid values", () => {
    expect(quantisePropPosition(1.2345)).toBe(Math.round(1.2345 * 64) / 64);
    expect(quantisePropRotation(1.2345)).toBe(Math.round(1.2345 / (Math.PI * 2 / 65536)) * (Math.PI * 2 / 65536));
    expect(quantisePropScale(1.2345)).toBe(Math.round(1.2345 * 4096) / 4096);
    expect(isExactPropPosition(1.5)).toBe(true);
    expect(isExactPropPosition(1.5001)).toBe(false);
    expect(isExactPropRotation(Math.fround(Math.PI / 2))).toBe(true);
    expect(isExactPropScale(1.25)).toBe(true);
    expect(fitsU16Ticks(propPositionTicks(1000))).toBe(true);
    expect(fitsU16Ticks(propPositionTicks(1024))).toBe(false);
    expect(decodePropPositionTicks(propPositionTicks(1.5))).toBe(1.5);
    expect(fitsU16Ticks(propRotationTicks(Math.PI * 2))).toBe(false);
    expect(fitsU16Ticks(propScaleTicks(1.25))).toBe(true);
  });

  it("round-trips quantised props as u16 chunks without changing the decoded state", async () => {
    const world = huntingWorld(32);
    const values: [number, number, number, number][] = [[1.5, 2.25, 0, 1.25], [3.125, 4.5, Math.PI / 2, 0.75]];
    setProps(world, values);
    const header = JSON.parse(new TextDecoder().decode(writeMapParts(world, input).header));
    expect(header.chunks.filter((chunk: { name: string }) => ["props.x", "props.z", "props.rotation", "props.scale"].includes(chunk.name))
      .map((chunk: { type: string }) => chunk.type)).toEqual(["u16", "u16", "u16", "u16"]);
    const loaded = await readMapFile(await writeMapFile(world, input));
    expect(loaded.world.props.count).toBe(2);
    expect(Array.from(loaded.world.props.x.slice(0, 2))).toEqual([1.5, 3.125]);
    expect(Array.from(loaded.world.props.z.slice(0, 2))).toEqual([2.25, 4.5]);
    expect(Array.from(loaded.world.props.rotation.slice(0, 2))).toEqual([0, world.props.rotation[1]]);
    expect(Array.from(loaded.world.props.scale.slice(0, 2))).toEqual([1.25, 0.75]);
  });

  it("generates spatially ordered, quantised props and omits the derived phase layer", async () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 1234 });
    expect(world.props.count).toBeGreaterThan(10);
    for (let index = 1; index < world.props.count; index += 1) {
      const previous = index - 1;
      const row = Math.floor(world.props.z[index]!) - Math.floor(world.props.z[previous]!);
      expect(row > 0 || (row === 0 && world.props.x[index]! >= world.props.x[previous]!)).toBe(true);
    }
    for (let index = 0; index < world.props.count; index += 1) {
      expect(isExactPropPosition(world.props.x[index]!)).toBe(true);
      expect(isExactPropPosition(world.props.z[index]!)).toBe(true);
      expect(isExactPropRotation(world.props.rotation[index]!)).toBe(true);
      expect(isExactPropScale(world.props.scale[index]!)).toBe(true);
    }
    const header = JSON.parse(new TextDecoder().decode(writeMapParts(world, input).header));
    expect(header.chunks.some((chunk: { name: string }) => chunk.name === "props.phase")).toBe(false);
    for (const name of ["props.x", "props.z", "props.rotation", "props.scale"]) {
      expect(header.chunks.find((chunk: { name: string }) => chunk.name === name)!.type).toBe("u16");
    }
    const loaded = await readMapFile(await writeMapFile(world, input));
    for (let index = 0; index < loaded.world.props.count; index += 1)
      expect(loaded.world.props.phase[index]).toBeCloseTo(propPhase(world.seed, index), 6);
  });

  it("falls back to f32 for one off-grid value while keeping the other layers quantised", async () => {
    const world = huntingWorld(32);
    setProps(world, [[1.5, 2.25, 0, 1.25], [0.1, 4.5, Math.PI / 2, 0.75]]);
    const chunks = JSON.parse(new TextDecoder().decode(writeMapParts(world, input).header)).chunks;
    expect(chunks.find((chunk: { name: string }) => chunk.name === "props.x")!.type).toBe("f32");
    expect(chunks.find((chunk: { name: string }) => chunk.name === "props.z")!.type).toBe("u16");
    const loaded = await readMapFile(await writeMapFile(world, input));
    expect(loaded.world.props.x[0]).toBe(1.5);
    expect(loaded.world.props.x[1]).toBeCloseTo(0.1, 6);
    expect(Array.from(loaded.world.props.z.slice(0, 2))).toEqual([2.25, 4.5]);
  });
});

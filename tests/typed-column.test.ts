import { describe, expect, it } from "vitest";

import { decodeTypedColumn, encodeTypedColumn } from "../src/render-common/wildlife/manager/typed-column";

describe("typed save columns", () => {
  it("round-trips every array type bit-exactly, Infinity and NaN included", () => {
    const floats = Float32Array.from([0, -1.5, Infinity, -Infinity, NaN, 3.4e38, 1e-40]);
    const decodedFloats = decodeTypedColumn(encodeTypedColumn(floats), Float32Array, floats.length);
    expect([...new Uint32Array(decodedFloats.buffer)]).toEqual([...new Uint32Array(floats.buffer)]);
    const cases: [ArrayLike<number>, Uint8ArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor |
      Int32ArrayConstructor | Uint32ArrayConstructor][] = [
      [Uint8Array.from([0, 1, 255]), Uint8Array],
      [Int16Array.from([-32768, 0, 32767]), Int16Array],
      [Uint16Array.from([0, 65535]), Uint16Array],
      [Int32Array.from([-2147483648, 7, 2147483647]), Int32Array],
      [Uint32Array.from([0, 4294967295]), Uint32Array]
    ];
    for (const [values, constructor] of cases) {
      const column = encodeTypedColumn(values as never);
      expect(column.length).toBe(values.length);
      expect([...decodeTypedColumn(column, constructor)]).toEqual([...(values as unknown as number[])]);
    }
    expect(decodeTypedColumn(encodeTypedColumn(new Int32Array(0)), Int32Array).length).toBe(0);
  });

  it("rejects the wrong type, length, shape or byte count", () => {
    const column = encodeTypedColumn(Int32Array.from([1, 2, 3]));
    expect(() => decodeTypedColumn(column, Float32Array)).toThrow("Invalid wildlife column");
    expect(() => decodeTypedColumn(column, Int32Array, 2)).toThrow("length");
    expect(() => decodeTypedColumn({ ...column, length: 4 }, Int32Array)).toThrow("bytes");
    expect(() => decodeTypedColumn({ ...column, bytes: "@@" }, Int32Array)).toThrow("bytes");
    expect(() => decodeTypedColumn(null, Int32Array)).toThrow("Invalid wildlife column");
    expect(() => decodeTypedColumn({ ...column, type: "f64" }, Int32Array)).toThrow("Invalid wildlife column");
  });
});

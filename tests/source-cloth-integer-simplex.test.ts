import { Uint16BufferAttribute, Vector4 } from "three";
import { describe, expect, it } from "vitest";

import { integerClothSimplex } from "../tools/analysis/source-cloth-integer-simplex";

describe("original normalized Uint16 cloth representation", () => {
  it("preserves the exact integer simplex through Three writes and repeated loader normalization", () => {
    const controls = [[1, 0, 0, 0], [.5, .5, 0, 0], [.1, .2, .3, .4],
      ...Array.from({ length: 200 }, (_, at) => {
        const values = [Math.sin(at + .3) ** 2, Math.cos(at * .7 + .2) ** 2, .031, (at % 7) / 7];
        const sum = values.reduce((sum, value) => sum + value, 0);
        return values.map(value => value / sum);
      })];
    for (const values of controls) {
      const { integers, weights } = integerClothSimplex(values);
      expect(integers.reduce((sum, value) => sum + value, 0)).toBe(65535);
      expect(integerClothSimplex(weights).integers).toEqual(integers);
      const attribute = new Uint16BufferAttribute(new Uint16Array(4), 4, true);
      attribute.setXYZW(0, ...weights as [number, number, number, number]);
      for (let pass = 0; pass < 3; pass++) {
        const vector = new Vector4().fromBufferAttribute(attribute, 0);
        vector.multiplyScalar(1 / vector.manhattanLength());
        attribute.setXYZW(0, vector.x, vector.y, vector.z, vector.w);
        expect([...attribute.array]).toEqual(integers);
      }
    }
  });

  it("rejects wrong ownership shape or invalid skin weights rather than changing storage semantics", () => {
    expect(() => integerClothSimplex([.5, .5])).toThrow(/exactly four weight slots/);
    expect(() => integerClothSimplex([1.1, -.1, 0, 0])).toThrow(/finite and nonnegative/);
    expect(() => integerClothSimplex([.2, .2, .2, .2])).toThrow(/normalized four-weight simplex/);
    expect(() => integerClothSimplex([NaN, 0, 0, 1])).toThrow(/finite and nonnegative/);
    expect(integerClothSimplex([.5, .5, 0, 0]).integers).toEqual([32768, 32767, 0, 0]);
  });
});

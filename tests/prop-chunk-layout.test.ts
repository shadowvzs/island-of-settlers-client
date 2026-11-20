import { describe, expect, it } from "vitest";

import {
  createPropChunkLayout,
  planPropChunkLayout
} from "../src/renderers/three/props/prop-chunk-layout";

/** 5 x 5 chunk grid, every chunk holds `chunk % 3 + 1` instances. */
const CHUNKS_X = 5;
const ALL = Array.from({ length: 25 }, (_, chunk) => chunk);
const countOf = (chunk: number) => chunk % 3 + 1;
const mask = (chunks: number[]) => {
  const visible = new Uint8Array(25);
  for (const chunk of chunks) visible[chunk] = 1;
  return visible;
};
/** The visible square of chunk rows/columns from..to (inclusive). */
const square = (from: number, to: number) =>
  ALL.filter(chunk => {
    const x = chunk % CHUNKS_X, z = Math.floor(chunk / CHUNKS_X);
    return x >= from && x <= to && z >= from && z <= to;
  });
const total = (chunks: number[]) => chunks.reduce((sum, chunk) => sum + countOf(chunk), 0);

describe("prop chunk layout", () => {
  it("lays out every visible chunk contiguously, centre first", () => {
    const layout = createPropChunkLayout();
    const rewrite = planPropChunkLayout(layout, ALL, mask(square(1, 3)), countOf, CHUNKS_X);
    expect(rewrite).toEqual({ fromIndex: 0, fromOffset: 0 });
    expect(layout.order[0]).toBe(12);
    expect(layout.count).toBe(total(square(1, 3)));
    let offset = 0;
    for (const chunk of layout.order) {
      expect(layout.offsets.get(chunk)).toBe(offset);
      offset += countOf(chunk);
    }
  });

  it("zooming in after a zoom out only shrinks the count: nothing is rewritten", () => {
    const layout = createPropChunkLayout();
    planPropChunkLayout(layout, ALL, mask(square(1, 3)), countOf, CHUNKS_X);
    const zoomOut = planPropChunkLayout(layout, ALL, mask(square(0, 4)), countOf, CHUNKS_X);
    expect(zoomOut.fromOffset).toBe(total(square(1, 3)));
    const zoomIn = planPropChunkLayout(layout, ALL, mask(square(1, 3)), countOf, CHUNKS_X);
    expect(zoomIn.fromOffset).toBe(total(square(1, 3)));
    expect(layout.count).toBe(total(square(1, 3)));
  });

  it("rewrites from the first dirty or emptied chunk and keeps the prefix", () => {
    const layout = createPropChunkLayout();
    const visible = mask(square(1, 3));
    planPropChunkLayout(layout, ALL, visible, countOf, CHUNKS_X);
    const before = [...layout.order];
    layout.dirty.add(before[3]!);
    const rewrite = planPropChunkLayout(layout, ALL, visible, countOf, CHUNKS_X);
    expect(rewrite.fromIndex).toBe(3);
    expect(rewrite.fromOffset).toBe(total(before.slice(0, 3)));
    expect(layout.order.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(new Set(layout.order)).toEqual(new Set(before));
    expect(layout.dirty.size).toBe(0);
  });

  it("an unchanged visible set rewrites nothing", () => {
    const layout = createPropChunkLayout();
    const visible = mask(square(1, 3));
    planPropChunkLayout(layout, ALL, visible, countOf, CHUNKS_X);
    const rewrite = planPropChunkLayout(layout, ALL, visible, countOf, CHUNKS_X);
    expect(rewrite.fromOffset).toBe(layout.count);
  });
});

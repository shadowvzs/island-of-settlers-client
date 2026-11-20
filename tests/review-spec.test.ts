import { describe, expect, it } from "vitest";

import { compareLayout, reviewLayout } from "../tools/review/review-manifest";
import { normaliseSpec, sceneKey, subjectShots } from "../tools/review/review-spec";

const spec = normaliseSpec({
  name: "sample",
  subjects: [
    { kind: "building", level: 5, nation: "roman", typeId: 20 },
    { item: "climbing-rose-red", kind: "decoration" }
  ],
  views: ["iso-close", "possessed-close"],
  yaws: [0, 2]
}, "/specs");

describe("TOOL-3 review spec", () => {
  it("fills defaults and resolves no output into the repository", () => {
    expect(spec.presets).toEqual(["high", "minimal"]);
    expect(spec.out.startsWith("/specs")).toBe(false);
    expect(spec.zoom.close).toBeGreaterThan(spec.zoom.normal);
  });

  it("rejects unknown presets and incomplete subjects", () => {
    expect(() => normaliseSpec({ name: "x", presets: ["ultra" as "high"], subjects: spec.subjects })).toThrow(/preset/);
    expect(() => normaliseSpec({ name: "x", subjects: [{ kind: "position" } as never] })).toThrow(/subject 0/);
  });

  it("expands iso views per quarter and possessed views once", () => {
    const keys = subjectShots(spec, 0, "minimal").map(shot => shot.key);
    expect(keys).toEqual(["roman-20-l5-r0-minimal-iso-close-y0", "roman-20-l5-r0-minimal-iso-close-y2",
      "roman-20-l5-r0-minimal-possessed-close"]);
  });

  it("stages buildings per nation and decorations on the island query", () => {
    expect(sceneKey(spec.subjects[0]!, spec)).toBe("building:roman");
    expect(sceneKey(spec.subjects[1]!, spec)).toBe(`island:${spec.query}`);
  });

  it("lays out one row per subject and preset, and before/after row pairs", () => {
    const layout = reviewLayout(spec, "/out");
    expect(layout.rows.map(row => row.heading)).toEqual(["roman #20 L5 r0 · high", "roman #20 L5 r0 · minimal",
      "climbing-rose-red · high", "climbing-rose-red · minimal"]);
    expect(layout.columns).toBe(3);
    const pairs = compareLayout(spec, "/out", "/before").rows;
    expect(pairs).toHaveLength(8);
    expect(pairs[0]!.cells[0]!.path).toBe("/before/shots/roman-20-l5-r0-high-iso-close-y0.png");
    expect(pairs[1]!.heading).toBe("roman #20 L5 r0 · high · after");
  });
});

import { expect, it } from "vitest";

import { type GalleryCase,galleryCaseKey } from "../tools/bench/building-gallery-plan";
import { galleryRevisionFiles, galleryRevisionTargets } from "../tools/bench/building-gallery-revision-plan";

it("refreshes every shared-framing level and explicit renderer-only scope without replacing unchanged families", () => {
  const cases: GalleryCase[] = [];
  for (const nation of ["roman", "japanese"] as const) for (const id of [7, 17, 20])
    for (const quality of ["high", "minimal"] as const) for (const level of [1, 2, 3, 4, 5] as const)
      cases.push({ id, level, name: "Fixture", nation, quality });
  const before = Object.fromEntries(cases.map(entry => [galleryCaseKey(entry), "original"]));
  const after = { ...before, "japanese-20-high-l5": "changed" };
  const result = galleryRevisionTargets(cases, before, after,
    [{ ids: [7], justification: "Roman imported renderer changed without recipe changes", nations: ["roman"] }]);
  expect(result.changedRecipes.map(galleryCaseKey)).toEqual(["japanese-20-high-l5"]);
  expect(result.targeted).toHaveLength(15);
  expect(result.targeted.every(entry => entry.nation === "roman" && entry.id === 7 ||
    entry.nation === "japanese" && entry.id === 20 && entry.quality === "high")).toBe(true);
  expect(result.targeted.filter(entry => entry.nation === "japanese").map(entry => entry.level)).toEqual([1, 2, 3, 4, 5]);
  expect(() => galleryRevisionTargets(cases, before, {}, [])).toThrow("Missing recipe");
  expect(() => galleryRevisionTargets(cases, before, before,
    [{ ids: [99], justification: "Typo", nations: ["roman"] }])).toThrow("Forced renderer scope matches no canonical cases");
});

it("keeps same-path revision certificates and baselines separate from original evidence", () => {
  const files = galleryRevisionFiles("owner-r2");
  expect(files.certificate).toBe("revisions/owner-r2/certificate.json");
  expect(files.baseline).not.toBe("preparation-source-snapshot.json");
  expect(files.baseReport).not.toBe("report.json");
  expect(files.baseIndex).toBe("owner-r2-previous-index.html");
  expect(() => galleryRevisionFiles("../assets")).toThrow("Unsafe gallery revision ID");
});

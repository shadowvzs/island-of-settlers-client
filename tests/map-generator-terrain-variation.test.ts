import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { createIslandFormDraft, DEFAULT_ISLAND_CHOICE, formatIslandChoice, parseIslandChoice,
  readIslandChoice, toWorldOptions, updateIslandDraft, writeIslandQuery } from "../src/app/map-generator/helpers";
import { IslandForm } from "../src/app/map-generator/island-form";

it("maps five persisted levels to explicit engine relief and keeps omitted legacy options omitted", () => {
  expect([0, 1, 2, 3, 4].map(terrainVariation => toWorldOptions({ ...DEFAULT_ISLAND_CHOICE, terrainVariation }).terrainVariation))
    .toEqual([0, .5, 1, 1.5, 2]);
  const { terrainVariation: _omitted, ...legacy } = DEFAULT_ISLAND_CHOICE;
  expect(toWorldOptions(legacy)).not.toHaveProperty("terrainVariation");
  expect(readIslandChoice(new URLSearchParams(), legacy)).not.toHaveProperty("terrainVariation");
  expect(createIslandFormDraft(legacy).terrainVariation).toBe(2);
  for (const terrainVariation of [0, 1, 2, 3, 4])
    expect(parseIslandChoice(formatIslandChoice({ ...DEFAULT_ISLAND_CHOICE, terrainVariation })).terrainVariation).toBe(terrainVariation);
});

it("clamps URL and draft edits, preserves query precedence, and never mutates the active choice", () => {
  const stored = { ...DEFAULT_ISLAND_CHOICE, terrainVariation: 1 };
  expect(readIslandChoice(new URLSearchParams("terrainVariation=99"), stored).terrainVariation).toBe(4);
  expect(readIslandChoice(new URLSearchParams("terrainVariation=-2"), stored).terrainVariation).toBe(0);
  expect(readIslandChoice(new URLSearchParams("terrainVariation=2.6"), stored).terrainVariation).toBe(3);
  expect(readIslandChoice(new URLSearchParams("terrainVariation=no"), stored).terrainVariation).toBe(1);
  const draft = createIslandFormDraft(stored), updated = updateIslandDraft(draft, { terrainVariation: 99 });
  expect(updated.terrainVariation).toBe(4); expect(draft.terrainVariation).toBe(1); expect(stored.terrainVariation).toBe(1);
  expect(updateIslandDraft(draft, { terrainVariation: Number.NaN }).terrainVariation).toBe(2);
  expect(writeIslandQuery(new URLSearchParams("seed=7&terrainVariation=4"), DEFAULT_ISLAND_CHOICE).toString()).toBe("seed=7");
});

it("renders both relief extremes without coupling them to mountain count", () => {
  for (const [terrainVariation, label] of [[0, "Flat"], [4, "Very hilly"]] as const) {
    const markup = renderToStaticMarkup(createElement(IslandForm, {
      initial: { ...DEFAULT_ISLAND_CHOICE, terrainVariation, mountains: 3 }, onRecreate: () => undefined }));
    expect(markup).toContain(`<span>Terrain variation: ${label}</span>`);
    expect(markup).toContain("<span>Mountains: Many</span>");
  }
});

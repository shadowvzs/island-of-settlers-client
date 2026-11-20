import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { DEFAULT_ISLAND_CHOICE, formatIslandChoice, parseIslandChoice, peaksOf, peakUpliftFor, readIslandChoice,
  toWorldOptions, writeIslandQuery } from "../src/app/map-generator/helpers";
import { IslandForm } from "../src/app/map-generator/island-form";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  TERRAIN_GENERATOR_VERSION, validGenerationProvenance
} from "../src/shared/world/generation/generation-provenance";

it("reads ?peakUplift= as a clamped 0..1 strength over the stored choice", () => {
  expect(readIslandChoice(new URLSearchParams("peakUplift=1"), DEFAULT_ISLAND_CHOICE).peakUplift).toBe(1);
  expect(readIslandChoice(new URLSearchParams("peakUplift=3"), DEFAULT_ISLAND_CHOICE).peakUplift).toBe(1);
  expect(readIslandChoice(new URLSearchParams("peakUplift=0"), DEFAULT_ISLAND_CHOICE)).not.toHaveProperty("peakUplift");
  const stored = { ...DEFAULT_ISLAND_CHOICE, peakUplift: .5 };
  expect(readIslandChoice(new URLSearchParams(), stored).peakUplift).toBe(.5);
});

it("round-trips the peaks through the query and the generator options", () => {
  const tall = { ...DEFAULT_ISLAND_CHOICE, peakUplift: peakUpliftFor("tall") };
  expect(parseIslandChoice(formatIslandChoice(tall)).peakUplift).toBe(1);
  expect(toWorldOptions(tall).peakUplift).toBe(1);
  const classic = { ...DEFAULT_ISLAND_CHOICE, peakUplift: peakUpliftFor("classic") };
  expect(peaksOf(classic)).toBe("classic");
  expect(peaksOf(tall)).toBe("tall");
  // terrain-seed-v8: Tall is the default, so only Classic is written.
  expect(writeIslandQuery(new URLSearchParams(), tall).get("peakUplift")).toBeNull();
  expect(writeIslandQuery(new URLSearchParams(), classic).get("peakUplift")).toBe("0");
  expect(peaksOf(DEFAULT_ISLAND_CHOICE)).toBe("tall");
});

it("validates the provenance option inside 0..1", () => {
  const provenance = (peakUplift: number) => ({ version: 1,
    generatorVersion: TERRAIN_GENERATOR_VERSION, options: { ...DEFAULT_WORLD_OPTIONS, peakUplift } });
  for (const amount of [0, .5, 1]) expect(validGenerationProvenance(provenance(amount))).toBe(true);
  for (const amount of [-.1, 1.5, NaN]) expect(validGenerationProvenance(provenance(amount))).toBe(false);
});

it("renders the peaks radio group with the stored choice checked", () => {
  const markup = renderToStaticMarkup(createElement(IslandForm,
    { initial: { ...DEFAULT_ISLAND_CHOICE, peakUplift: 1 }, onRecreate: () => undefined }));
  expect(markup).toContain("Peaks");
  expect(markup).toMatch(/checked=""[^>]*\/>Tall/);
});

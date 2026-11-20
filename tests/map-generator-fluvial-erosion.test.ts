import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { DEFAULT_ISLAND_CHOICE, fluvialErosionFor, formatIslandChoice, parseIslandChoice, readIslandChoice,
  reliefOf, toWorldOptions, writeIslandQuery } from "../src/app/map-generator/helpers";
import { IslandForm } from "../src/app/map-generator/island-form";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  TERRAIN_GENERATOR_VERSION, validGenerationProvenance
} from "../src/shared/world/generation/generation-provenance";

it("reads ?fluvialErosion= as a clamped 0..1 strength over the Eroded default (terrain-seed-v8)", () => {
  expect(readIslandChoice(new URLSearchParams("fluvialErosion=1"), DEFAULT_ISLAND_CHOICE).fluvialErosion).toBe(1);
  expect(readIslandChoice(new URLSearchParams("fluvialErosion=0.6"), DEFAULT_ISLAND_CHOICE).fluvialErosion).toBe(.6);
  expect(readIslandChoice(new URLSearchParams("fluvialErosion=7"), DEFAULT_ISLAND_CHOICE).fluvialErosion).toBe(1);
  expect(readIslandChoice(new URLSearchParams("fluvialErosion=0"), DEFAULT_ISLAND_CHOICE)).not.toHaveProperty("fluvialErosion");
  expect(readIslandChoice(new URLSearchParams(), DEFAULT_ISLAND_CHOICE).fluvialErosion).toBe(1);
  const stored = { ...DEFAULT_ISLAND_CHOICE, fluvialErosion: .5 };
  expect(readIslandChoice(new URLSearchParams(), stored).fluvialErosion).toBe(.5);
  expect(readIslandChoice(new URLSearchParams("fluvialErosion=0"), stored)).not.toHaveProperty("fluvialErosion");
});

it("round-trips the strength through the query and writes Massif explicitly", () => {
  const choice = { ...DEFAULT_ISLAND_CHOICE, fluvialErosion: .75 };
  expect(parseIslandChoice(formatIslandChoice(choice)).fluvialErosion).toBe(.75);
  expect(writeIslandQuery(new URLSearchParams("fluvialErosion=1"), DEFAULT_ISLAND_CHOICE).toString()).toBe("");
  expect(toWorldOptions(choice).fluvialErosion).toBe(.75);
  expect(toWorldOptions(DEFAULT_ISLAND_CHOICE).fluvialErosion).toBe(1);
  const massif = { ...DEFAULT_ISLAND_CHOICE, fluvialErosion: 0 };
  expect(writeIslandQuery(new URLSearchParams(), massif).get("fluvialErosion")).toBe("0");
  expect(parseIslandChoice(formatIslandChoice(massif))).not.toHaveProperty("fluvialErosion");
  expect(toWorldOptions(massif)).not.toHaveProperty("fluvialErosion");
});

it("validates the provenance option inside 0..1", () => {
  const provenance = (fluvialErosion: number) => ({ version: 1,
    generatorVersion: TERRAIN_GENERATOR_VERSION, options: { ...DEFAULT_WORLD_OPTIONS, fluvialErosion } });
  for (const amount of [0, .3, 1]) expect(validGenerationProvenance(provenance(amount))).toBe(true);
  for (const amount of [-.1, 1.5, NaN, Infinity]) expect(validGenerationProvenance(provenance(amount))).toBe(false);
});

it("maps the form's Massif/Eroded relief to the carving strength", () => {
  expect(reliefOf(DEFAULT_ISLAND_CHOICE)).toBe("eroded");
  expect(reliefOf({})).toBe("massif");
  expect(reliefOf({ fluvialErosion: .4 })).toBe("eroded");
  expect(fluvialErosionFor("eroded")).toBe(1);
  expect(fluvialErosionFor("massif")).toBe(0);
  expect(toWorldOptions({ ...DEFAULT_ISLAND_CHOICE, fluvialErosion: fluvialErosionFor("massif") }))
    .not.toHaveProperty("fluvialErosion");
});

it("renders the relief radio group with the stored relief checked", () => {
  const markup = renderToStaticMarkup(createElement(IslandForm,
    { initial: { ...DEFAULT_ISLAND_CHOICE, fluvialErosion: 1 }, onRecreate: () => undefined }));
  expect(markup).toContain("Mountain relief");
  // Two relief radios and two peak radios (MC-04).
  expect(markup.match(/type="radio"/g)).toHaveLength(4);
  expect(markup).toMatch(/checked=""[^>]*\/>Eroded/);
});

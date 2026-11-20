import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { cliffBandsFor, DEFAULT_ISLAND_CHOICE, formatIslandChoice, parseIslandChoice, readIslandChoice,
  toWorldOptions } from "../src/app/map-generator/helpers";
import { IslandForm } from "../src/app/map-generator/island-form";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  TERRAIN_GENERATOR_VERSION, validGenerationProvenance
} from "../src/shared/world/generation/generation-provenance";

it("keeps tall cliff bands off by default and reads ?cliffBands=", () => {
  expect(DEFAULT_ISLAND_CHOICE.cliffBands).toBeUndefined();
  expect(toWorldOptions(DEFAULT_ISLAND_CHOICE)).not.toHaveProperty("cliffBands");
  expect(readIslandChoice(new URLSearchParams("cliffBands=1"), DEFAULT_ISLAND_CHOICE).cliffBands).toBe(1);
  expect(readIslandChoice(new URLSearchParams("cliffBands=0"), DEFAULT_ISLAND_CHOICE)).not.toHaveProperty("cliffBands");
});

it("round-trips the option through the stored query and the generator options", () => {
  const banded = { ...DEFAULT_ISLAND_CHOICE, cliffBands: cliffBandsFor(true) };
  expect(parseIslandChoice(formatIslandChoice(banded)).cliffBands).toBe(1);
  expect(toWorldOptions(banded).cliffBands).toBe(1);
  expect(cliffBandsFor(false)).toBe(0);
});

it("validates the provenance option inside 0..1", () => {
  const provenance = (cliffBands: number) => ({ version: 1,
    generatorVersion: TERRAIN_GENERATOR_VERSION, options: { ...DEFAULT_WORLD_OPTIONS, cliffBands } });
  for (const amount of [0, 1]) expect(validGenerationProvenance(provenance(amount))).toBe(true);
  for (const amount of [-1, 2]) expect(validGenerationProvenance(provenance(amount))).toBe(false);
});

it("renders the cliff band checkbox", () => {
  const markup = renderToStaticMarkup(createElement(IslandForm,
    { initial: { ...DEFAULT_ISLAND_CHOICE, cliffBands: 1 }, onRecreate: () => undefined }));
  // The shared checkbox wraps its caption in a truncating text span since 17d56794b (owner 2026-11-07).
  expect(markup).toMatch(/<input[^>]*checked=""[^>]*\/><span class="settings-panel__check-text">Tall cliff bands/);
});

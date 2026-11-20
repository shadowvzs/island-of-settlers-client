import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import { type CurrentIsland,getMapPanelRows } from "../src/app/map-generator/current-island-helpers";
import {
  createIslandFormDraft,
  DEFAULT_ISLAND_CHOICE,
  getIslandCountOptions,
  getIslandFormState,
  type IslandChoice,
  readSeedField,
  updateIslandDraft
} from "../src/app/map-generator/helpers";
import { IslandForm } from "../src/app/map-generator/island-form";
import { MapPanel } from "../src/app/map-generator/map-panel";
import { createTestI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;
const ARCHIPELAGO = { ...DEFAULT_ISLAND_CHOICE, islandCount: 4, landform: "archipelago" as const, size: 256 };
const render = (initial: IslandChoice = ARCHIPELAGO) =>
  renderToStaticMarkup(createElement(IslandForm, { initial, onRecreate: noop }));
const selectOf = (markup: string, label: string) => markup
  .match(new RegExp(`<label class="settings-panel__select">${label}<select aria-label="${label}">(.*?)</select>`))?.[1];

describe("map generator form helpers", () => {
  it("offers island counts up to the playable maximum and clamps the draft on resize", () => {
    expect(getIslandCountOptions(64, 64)).toEqual([{ label: "1", value: 1 }]);
    expect(getIslandCountOptions(512, 512)).toHaveLength(36);
    const draft = createIslandFormDraft({ ...ARCHIPELAGO, islandCount: 36, size: 512 });
    expect(draft.islandCount).toBe(36);
    const small = updateIslandDraft(draft, { height: 64, width: 64 });
    expect(small.islandCount).toBe(1);
    expect(getIslandFormState(small).similarSizesDisabled).toBe(true);
  });

  it("starts from a clamped draft with explicit dimensions", () => {
    const draft = createIslandFormDraft({ ...ARCHIPELAGO, islandCount: 99, size: 192 });
    expect(draft).toMatchObject({ height: 192, islandCount: 4, width: 192 });
  });

  it("always drafts a home island: colonies come from expeditions, not the generator", () => {
    const draft = createIslandFormDraft({ ...ARCHIPELAGO, colonyResourceTier: 2 });
    expect("colonyResourceTier" in draft).toBe(false);
  });

  it("reads an empty seed as random", () => {
    expect(readSeedField("", Number.NaN)).toBeUndefined();
    expect(readSeedField("42", 42)).toBe(42);
  });

  it("adds the load time to the current island rows once known", () => {
    const island: CurrentIsland = {
      choice: DEFAULT_ISLAND_CHOICE, height: 128, landform: "peninsula", seed: 7, size: 192
    };
    expect(getMapPanelRows(island).map(([label]) => label)).not.toContain("Loaded in");
    expect(getMapPanelRows(island, 2345).at(-1)).toEqual(["Loaded in", "2.3 s"]);
  });
});

describe("map generator form markup", () => {
  it("renders the labelled selects the e2e drivers query, with values from the choice", () => {
    const markup = render({ ...ARCHIPELAGO, height: 128, theme: "snowy", themeLayout: "latitude", width: 512 });
    expect(selectOf(markup, "Landform")).toContain('<option value="1" selected="">Islands</option>');
    expect(selectOf(markup, "Theme")).toContain('<option value="3" selected="">Snowy</option>');
    expect(selectOf(markup, "Themes")).toContain('<option value="3" selected="">Latitude bands</option>');
    expect(selectOf(markup, "Width")).toContain('<option value="4" selected="">512</option>');
    expect(selectOf(markup, "Height")).toContain('<option value="1" selected="">128</option>');
    expect(selectOf(markup, "Number of islands")).toContain('<option value="3" selected="">4</option>');
    expect(markup).toContain("Mostly similar island sizes");
  });

  it("renders the level sliders with `Name:` captions and the optional seed spinbutton", () => {
    const markup = render({ ...ARCHIPELAGO, forest: 3, mountains: 0, rivers: 2 });
    expect(markup).toContain("<span>Rivers: Normal</span>");
    expect(markup).toContain("<span>Forest: Many</span>");
    expect(markup).toContain("<span>Mountains: None</span>");
    expect(markup).toContain("<span>Terrain variation: Natural (default)</span>");
    expect(markup).toMatch(/<label>Seed \(optional\)<input aria-label="Seed \(optional\)" max="4294967295" min="0"/);
    expect(markup).toContain('type="number"');
    expect(markup).toMatch(/<button title="Generate an island[^"]*" type="button">Recreate island<\/button>/);
  });

  it("hides the island count for other landforms and offers no colony resource preset", () => {
    const markup = render({ ...DEFAULT_ISLAND_CHOICE, colonyResourceTier: 1, landform: "peninsula" });
    expect(markup).not.toContain("Number of islands");
    expect(markup).not.toContain("Mostly similar island sizes");
    expect(markup).not.toContain("Resource preset");
    expect(markup).not.toContain("Colony");
  });

  it("renders the panel sections with the current island and its load time", () => {
    const island: CurrentIsland = {
      choice: DEFAULT_ISLAND_CHOICE, height: 64, landform: "peninsula", seed: 9, size: 64
    };
    const loadTime = createExternalStore<number | undefined>(1500);
    const markup = renderToStaticMarkup(createElement(MapPanel, {
      initial: DEFAULT_ISLAND_CHOICE, island, loadTime, onRecreate: noop
    }));
    expect(markup).toContain("</svg>Current island</h2>");
    expect(markup).toContain("<dt>Seed</dt><dd>9</dd>");
    expect(markup).toContain("<dt>Loaded in</dt><dd>1.5 s</dd>");
    expect(markup).toContain("</svg>New island</h2>");
    expect(markup).toContain('<div class="settings-panel__island">');
  });
  it("renders the map generator in the selected Hungarian language", () => {
    const i18n = createTestI18n("hu");
    const markup = renderToStaticMarkup(createElement(IslandForm, {
      i18n, initial: ARCHIPELAGO, onRecreate: noop
    }));
    expect(markup).toContain("<span>Folyók: Ki</span>");
    expect(markup).toContain("<span>Erdő: Kevés</span>");
    expect(markup).toContain("<span>Hegységek: Normál</span>");
    expect(markup).toContain("<span>Terepváltozatosság: Természetes (alapértelmezett)</span>");
    expect(markup).toContain(">Sziget újragenerálása</button>");
    expect(markup).toContain('aria-label="Mag (nem kötelező)"');

    const island: CurrentIsland = {
      choice: { ...DEFAULT_ISLAND_CHOICE, theme: "snowy", landform: "peninsula" }, height: 128, landform: "peninsula", seed: 9, size: 128
    };
    expect(getMapPanelRows(island, 1500, i18n)).toEqual([
      ["Mag", "9"], ["Méret", "128 x 128"], ["Terepforma", "Félsziget"], ["Téma", "Havas"],
      ["Erőforrások", "Otthon · 0. szint — fenyő/pálma puhafa és kő"], ["Folyók", "Nem"],
      ["Erdő", "Kevés"], ["Hegységek", "Normál"], ["Terepváltozatosság", "Természetes (alapértelmezett)"], ["Betöltés", "1.5 s"]
    ]);
  });

});

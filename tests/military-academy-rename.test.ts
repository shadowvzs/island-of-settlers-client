import { buildingEntry } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";

const oldNames = /(^|\b)(Tavern|Kocsma|Taverna)(\b|$)/i;
const flatten = (value: unknown): unknown[] => Array.isArray(value)
  ? value.flatMap(flatten)
  : value && typeof value === "object"
    ? Object.values(value).flatMap(flatten)
    : [value];
const translatedText = (catalog: unknown) =>
  flatten(catalog).filter((value): value is string => typeof value === "string");

describe("Military Academy rename", () => {
  it("uses the new building name in the catalogue and both translations", () => {
    expect(getBuildingDefinition(40).name).toBe("Military Academy");
    expect(translatedText(english).filter(value => oldNames.test(value))).toEqual([]);
    expect(translatedText(hungarian).filter(value => oldNames.test(value))).toEqual([]);
  });

  it("uses the new name in the content catalog entry and every nation name variant", () => {
    const entry = buildingEntry(40)!;
    expect(entry.text.name.en).toBe("Military Academy");
    expect(Object.values(entry.text.variants ?? {}).filter(text => oldNames.test(text.en))).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { setupI18n } from "@lingui/core";
import { describe, expect, it, vi } from "vitest";

import { readSelection } from "../src/app/components/use-store-selector";
import { getBuildingLevelLabel } from "../src/app/settlement-ui/building-details/construction-helpers";
import { getPlacementStrip, selectPlacement } from "../src/app/settlement-ui/hud/helpers";
import { SETTLEMENT_MESSAGES } from "../src/app/settlement-ui/messages";

interface DraftEntry { hu: string; id: string; message: string }

const draft: DraftEntry[] = JSON.parse(readFileSync(
  new URL("../../docs/localization-drafts/i18n-settlement-ui.json", import.meta.url), "utf8"));

const collectDescriptors = (value: unknown, found: { id: string; message?: string }[] = []) => {
  if (value && typeof value === "object" && "id" in value && "message" in value) {
    found.push(value as { id: string; message?: string });
    return found;
  }
  if (value && typeof value === "object") for (const entry of Object.values(value)) collectDescriptors(entry, found);
  return found;
};

// i18n-dedupe (2026-11-10) reuses one canonical id at several message sites; the draft lists each id once.
const descriptors = [...new Map(collectDescriptors(SETTLEMENT_MESSAGES)
  .map(descriptor => [descriptor.id, descriptor] as const)).values()];

describe("settlement UI localization draft", () => {
  it("has one draft entry for every new settlement message", () => {
    expect(descriptors).toHaveLength(draft.length);
    expect(new Set(draft.map(entry => entry.id)).size).toBe(draft.length);
    expect(draft.map(entry => entry.id)).toEqual(descriptors.map(entry => entry.id));
    expect(draft.map(entry => entry.message)).toEqual(descriptors.map(entry => entry.message));
  });

  it("keeps every Hungarian draft entry and its named placeholders", () => {
    for (const entry of draft) {
      expect(entry.hu.trim(), entry.id).not.toBe("");
      // Check named ICU arguments, not the nested English plural branch text.
      for (const match of entry.message.matchAll(/\{\s*([a-zA-Z][\w]*)/g))
        expect(entry.hu, `${entry.id} keeps {${match[1]}}`).toContain(match[1]!);
    }
  });

  it("resolves helper copy through the active locale instead of a frozen module string", () => {
    const i18n = setupI18n({ locale: "hu", messages: { hu: {
      "settlement.details.level": "Szint: {level}",
      "settlement.hud.placement.sendJob": "Küldés: {job}"
    } } });
    expect(getPlacementStrip(selectPlacement({ surveyJob: "Geologist" }), i18n).name).toBe("Küldés: Geologist");
    expect(getBuildingLevelLabel({ completed: true } as never, i18n).text).toBe("Szint: 1");
    expect(getPlacementStrip(selectPlacement({ surveyJob: "Geologist" })).name).toBe("Send Geologist");
  });

  it("invalidates a cached selection when the locale revision changes", () => {
    const snapshot = { value: 1 };
    const select = vi.fn(() => "label");
    const first = readSelection(null, snapshot, select, Object.is, true, "en");
    readSelection(first, snapshot, select, Object.is, true, "en");
    expect(select).toHaveBeenCalledTimes(1);
    readSelection(first, snapshot, select, Object.is, true, "hu");
    expect(select).toHaveBeenCalledTimes(2);
  });
});

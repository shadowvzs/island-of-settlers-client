import { readFileSync } from "node:fs";
import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { debugExpeditionMessage } from "../src/app/settlement/debug-expedition-message";
import { SETTLEMENT_DEBUG_MESSAGES } from "../src/app/settlement/debug-messages";
import { buildAllMessage } from "../src/app/settlement/debug-tool-messages";
import {
  getHostileGarrisonRows, getHostileTooltipView
} from "../src/app/settlement/hostile-building-tooltip-helpers";
import { messages as hungarian } from "../src/locales/hu/messages";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";

interface DraftEntry { hu: string; id: string; message: string }

const draft: DraftEntry[] = JSON.parse(readFileSync(
  new URL("../../docs/localization-drafts/i18n-debug-controls.json", import.meta.url), "utf8"));

const collectDescriptors = (value: unknown, found: { id: string; message?: string }[] = []) => {
  if (value && typeof value === "object" && "id" in value && "message" in value) {
    found.push(value as { id: string; message?: string });
    return found;
  }
  if (value && typeof value === "object") for (const entry of Object.values(value)) collectDescriptors(entry, found);
  return found;
};

const descriptors = collectDescriptors(SETTLEMENT_DEBUG_MESSAGES);
const i18n = setupI18n({ locale: "hu", messages: {
  hu: { ...hungarian, ...Object.fromEntries(draft.map(entry => [entry.id, entry.hu])) }
} });

describe("settlement debug localization draft", () => {
  it("has one draft entry for every new debug message", () => {
    expect(descriptors).toHaveLength(draft.length);
    expect(new Set(draft.map(entry => entry.id)).size).toBe(draft.length);
    const byId = new Map(draft.map(entry => [entry.id, entry]));
    for (const descriptor of descriptors) {
      expect(byId.get(descriptor.id)?.message, descriptor.id).toBe(descriptor.message);
    }
  });

  it("keeps every Hungarian draft entry and its named placeholders", () => {
    for (const entry of draft) {
      expect(entry.hu.trim(), entry.id).not.toBe("");
      // Argument names only: ICU plural branches such as `{# tile}` are translated text.
      for (const [, name] of entry.message.matchAll(/\{(\w+)[,}]/g))
        expect(entry.hu, `${entry.id} keeps {${name}}`).toContain(`{${name}`);
    }
  });
});

describe("localized debug copy", () => {
  it("localizes build-all summaries and keeps the English fallback", () => {
    const report = { built: 2, skipped: [{ reason: "no surveyed matching deposit", typeId: 13 }] };
    const message = buildAllMessage(report, typeId => `type ${typeId}`, i18n);
    expect(message.text).toBe("2 kész épület épült utakkal. Kihagyva: type 13 (no surveyed matching deposit).");
    expect(message.warning).toBe(true);
    expect(buildAllMessage({ built: 1, skipped: [] }, typeId => `type ${typeId}`).text)
      .toBe("Built 1 finished building with roads.");
  });

  it("localizes expedition grants, timers and arrival text", () => {
    const island = { debug: true as const, difficulty: "easy" as const, id: 1, kind: "adventure" as const,
      name: "Sandy Cove", seed: 1, size: 96, voyageSeconds: 300 };
    const text = debugExpeditionMessage("adventure", { granted: {
      crew: 1, harbourPlaced: true, ships: 2, supplies: { stone: 3 }, troops: 20
    }, id: 1, island, ok: true }, 0, i18n).text;
    expect(text).toContain("Kaland tesztelése: egy kész kikötő úttal, 2 hajó, 20 veterán katona, 1 legénységi telepes, 3 kő.");
    expect(text).toContain("Kaland célpont: Sandy Cove (könnyű), normál időzítéssel készül: 300 mp utazás.");
    expect(text).toContain("A csapatok hídon át szállnak partra");
    expect(debugExpeditionMessage("colony", { ok: false, reason: "No coast" }, 0, i18n))
      .toEqual({ text: "Gyarmati expedíció tesztelése: No coast.", warning: true });
  });

  it("localizes hostile tooltip rows and keeps the English fallback", () => {
    const soldier = (type: "archer" | "shield", rank: number): SettlementSoldier =>
      ({ actor: 1, building: 5, combat: { type } as SettlementSoldier["combat"], rank, stationed: true });
    const rows = getHostileGarrisonRows([soldier("archer", 0), soldier("shield", 2)], 5, "roman", i18n);
    expect(rows).toEqual([
      { count: 1, label: "Kardosok · 3. szint" },
      { count: 1, label: "Íjászok · 1. szint" }
    ]);
    expect(getHostileTooltipView("Guard house", [], i18n)).toMatchObject({
      empty: "Nincsenek bent katonák", title: "Guard house (ellenséges)"
    });
    expect(getHostileTooltipView("Guard house", []).empty).toBe("No soldiers inside");
  });
});

import { describe, expect, it } from "vitest";

import { EVENT_CATALOG, type ScriptEventKind } from "../../island-of-settlers-shared/src/script/catalog/events";
import { addGroups } from "../src/app/map-editor/script/add-options";
import { EVENT_GROUPS } from "../src/app/map-editor/script/constants";
import { choiceLabel, eventSentence, sentenceSlots, slotLabel } from "../src/app/map-editor/script/sentences";
import { CHOICE_LABELS, SLOT_LABELS } from "../src/app/map-editor/script/sentences-data";

/**
 * EXT-EVENTS: the editor's catalogue tables cover every event kind: one "+ event" group, a sentence in English,
 * Hungarian and German that names each of the event's slots, and a label for every slot and closed-list value.
 */

const LOCALES = ["en", "hu", "de"] as const;
const KINDS = Object.keys(EVENT_CATALOG) as ScriptEventKind[];
const TRADE_KINDS: readonly ScriptEventKind[] = ["wareBought", "wareSold", "tradeDeliveryArrived"];

describe("event tables of the trigger editor", () => {
  it("lists every catalogue event in exactly one group", () => {
    const grouped = Object.values(EVENT_GROUPS).flat() as ScriptEventKind[];
    expect([...grouped].sort()).toEqual([...KINDS].sort());
  });

  it("has a sentence per language naming exactly the event's slots (and the player filter)", () => {
    for (const kind of KINDS) {
      const slots = EVENT_CATALOG[kind].slots.map(slot => slot.name);
      for (const locale of LOCALES) {
        const named = new Set(sentenceSlots(eventSentence(kind, "primary", locale)));
        named.delete("player");
        expect([...named].sort(), `${kind} ${locale}`).toEqual(slots.filter(slot => slot !== "player").sort());
      }
    }
  });

  it("labels every event slot and every closed-list value in each language", () => {
    for (const kind of KINDS) for (const slot of EVENT_CATALOG[kind].slots) {
      expect(SLOT_LABELS, `${kind}.${slot.name}`).toHaveProperty(slot.name);
      if (slot.type.kind !== "choice") continue;
      for (const value of slot.type.values)
        expect(CHOICE_LABELS, `${kind}.${slot.name} ${value}`).toHaveProperty(value);
    }
  });

  it("words the trade events in English, Hungarian and German", () => {
    expect(eventSentence("wareBought", undefined, "en"))
      .toBe("{player} buys {ware} at the market (paying with {payment})");
    expect(eventSentence("wareSold", undefined, "hu"))
      .toBe("{player} árut ad el egy kereskedőnek: {ware} (ezért: {payment})");
    expect(eventSentence("tradeDeliveryArrived", undefined, "de-DE"))
      .toBe("ein Handelsschiff liefert {ware} an {harbour} von {player} ({trade})");
    expect(LOCALES.map(locale => slotLabel("payment", locale))).toEqual(["payment", "fizetség", "Bezahlung"]);
    expect(LOCALES.map(locale => choiceLabel("purchase", locale))).toEqual(["purchase", "vásárlás", "Kauf"]);
    expect(LOCALES.map(locale => choiceLabel("sale", locale))).toEqual(["sale", "eladás", "Verkauf"]);
    expect(LOCALES.map(locale => choiceLabel("refund", locale)))
      .toEqual(["refund", "visszatérítés", "Rückerstattung"]);
  });

  it("offers the trade group on home and campaign maps and hides it where trading does not exist", () => {
    const tradeKeys = (mapKind: "adventure" | "campaign" | "colony" | "home") =>
      addGroups("event", mapKind, "en", "").find(group => group.id === "trade")?.options.map(option => option.key);
    const keys = TRADE_KINDS.map(kind => `event:${kind}`);
    expect(tradeKeys("home")).toEqual(keys);
    expect(tradeKeys("campaign")).toEqual(keys);
    expect(tradeKeys("colony")).toBeUndefined();
    expect(tradeKeys("adventure")).toBeUndefined();
    const [bought] = addGroups("event", "home", "en", "market")[0]!.options;
    expect(bought).toMatchObject({
      key: "event:wareBought", label: "[player] buys [ware] at the market (paying with [payment])", later: ""
    });
  });
});

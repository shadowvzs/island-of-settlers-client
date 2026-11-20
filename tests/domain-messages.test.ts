import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupI18n } from "@lingui/core";
import {
  banditEntries, buildingEntries, catalogEntries, settlerByJob, settlerEntries, soldierEntries, wareEntries, wareEntry
} from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getNationBuildingDefinition } from "../src/render-common/buildings/nation-building-text";
import { WARE_IDS } from "../src/render-common/wares/ware-catalog";
import { contentDescriptor } from "../src/shared/i18n/content-text";
import {
  describeDomainWares, displayBuildingName, displayJobName, displayTroopName, displayWareName,
  displayWareNameForCount, formatDomainWareCount, translateDomainText
} from "../src/shared/i18n/domain";
import { collectDomainMessages } from "../src/shared/i18n/domain-messages";
import { QUEST_CATALOG_MESSAGES } from "../src/shared/i18n/quest-catalog-messages";
import { HOME_TUTORIAL_QUESTS } from "../src/shared/quests/home-quest-book";
import { homeQuestCopy, homeQuestTitle } from "../src/shared/quests/home-quest-text";
import { NATION_DRINK_CHAINS } from "../src/shared/settlement/nation-drinks";
import { ALL_PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import { wareDisplayName, wareNameForCount } from "../src/shared/settlement/ware-names";

const draftPath = fileURLToPath(new URL("../../docs/localization-drafts/i18n-domain-sim.json", import.meta.url));
const draft = JSON.parse(readFileSync(draftPath, "utf8")) as { id: string; message: string; hu: string }[];
const hungarian = setupI18n({ locale: "hu", messages: {
  hu: Object.fromEntries(draft.map(entry => [entry.id, entry.hu]))
} });

const source = (descriptor: { message?: string; id: string }) => descriptor.message ?? descriptor.id;


describe("canonical domain vocabulary", () => {
  it("has a descriptor for every ware and keeps the existing English display names", () => {
    for (const ware of [...WARE_IDS, "handcart"]) {
      expect(wareEntry(ware)?.text.name.key).toBe(`domain.ware.${ware}`);
      expect(displayWareName(ware)).toBe(wareDisplayName(ware));
    }
    expect(wareNameForCount("armor", 1)).toBe("Armor set");
    expect(wareNameForCount("armor", 5)).toBe("Armor sets");
  });

  it("has a name for every building and nation-specific drink building", () => {
    for (const { code } of buildingEntries()) expect(displayBuildingName(code)).toBe(getBuildingDefinition(code).name);
    for (const nation of ["roman", "japanese", "nubian", "viking"] as const) {
      for (const id of [5, 6]) {
        const expected = getNationBuildingDefinition(id, nation).name;
        expect(displayBuildingName(id, nation)).toBe(expected);
      }
    }
    expect(displayBuildingName(17, "roman", hungarian)).toBe("Favágó");
    expect(displayBuildingName(39, "roman", hungarian)).toBe("Kikötőépület");
  });

  it("names every simulated job and every nation's troop roster", () => {
    const jobs = new Set([
      ...ALL_PRODUCTION_RULES.map(rule => rule.job),
      ...Object.values(NATION_DRINK_CHAINS).flatMap(chain => [chain.grower, chain.maker]),
      "Builder", "Carrier", "Geologist", "Leveler", "Mount", "Recruit", "Residents", "Settler"
    ]);
    for (const job of jobs) {
      expect(settlerByJob(job)?.text.name.en, job).toBe(job);
      expect(displayJobName(job)).toBe(job);
    }
    for (const nation of ["roman", "japanese", "nubian", "viking"] as const) {
      for (const type of ["archer", "cavalry", "heavy", "shield"] as const) {
        expect(displayTroopName(nation, type)).toBeTruthy();
        expect(displayTroopName(nation, type, true)).toBeTruthy();
      }
    }
    expect(displayTroopName("roman", "heavy", true)).toBe("Longswordsmen");
    expect(displayTroopName("nubian", "shield", false)).toBe("Khopesh warrior");
  });
});

describe("tutorial quest copy", () => {
  it("maps every step to a complete title and descriptions", () => {
    for (const quest of HOME_TUTORIAL_QUESTS) {
      expect(homeQuestTitle(quest, "roman")).not.toBe("");
      const copy = homeQuestCopy(quest, "roman");
      expect(copy.why).not.toBe("");
      expect(copy.benefit).not.toBe("");
      expect(copy.tips).not.toBe("");
      expect(QUEST_CATALOG_MESSAGES.chapter[quest.chapter as keyof typeof QUEST_CATALOG_MESSAGES.chapter]).toBeDefined();
    }
    const residence = HOME_TUTORIAL_QUESTS.find(quest => quest.id === "settlers.residence")!;
    expect(homeQuestTitle(residence, "roman")).toBe("Build 2 Small residences");
  });

  it("resolves representative Hungarian names and statuses from the draft catalog", () => {
    expect(displayWareName("logs", hungarian)).toBe("Puhafarönk");
    expect(displayWareNameForCount("sword", 3, hungarian)).toBe("Kard");
    expect(formatDomainWareCount("logs", 120, hungarian)).toContain("Puhafarönk");
    expect(displayJobName("Woodcutter", hungarian)).toBe("Favágó");
    expect(displayJobName("Iron founder", hungarian)).toBe("Vasöntő");
    expect(displayTroopName("roman", "heavy", true, hungarian)).toBe("Hosszúkardosok");
    expect(displayTroopName("nubian", "shield", false, hungarian)).toBe("Khopesh harcos");
    expect(translateDomainText("Waiting for inputs", hungarian)).toBe("Alapanyagokra vár");
    expect(translateDomainText("Waiting for axe", hungarian)).toBe("Várakozás: Fejsze");
    expect(translateDomainText("Leveling tile 2/4", hungarian)).toBe("2/4 mező szintezése");
    expect(translateDomainText("Boarding 3/5", hungarian)).toBe("Beszállás 3/5");
    expect(translateDomainText("1/3 soldiers · Waiting for stored soldiers", hungarian))
      .toBe("1/3 katona · Raktározott katonákra vár");
    expect(translateDomainText("Not enough free Softwood logs: needs 10, 3 free", hungarian))
      .toBe("Nincs elég szabad Puhafarönk: 10 kell, 3 szabad");
    expect(translateDomainText("Waiting for 1 Sword (0/1 ready, 2 incoming)", hungarian))
      .toBe("Várakozás: 1 Kard (0/1 kész, 2 érkezik)");
    expect(translateDomainText("Waiting for road and supplies (25%)", hungarian))
      .toBe("Útra és alapanyagokra vár (25%)");
    expect(translateDomainText("Planned Woodcutter. Connect its road endpoint.", hungarian))
      .toBe("Favágó terve elhelyezve. Kösd össze az út végpontját.");
    expect(translateDomainText("Woodcutter: Waiting for axe.", hungarian))
      .toBe("Favágó: Várakozás: Fejsze.");
    expect(translateDomainText("Medium · Raider hideout · 3 defenders · capacity 4", hungarian))
      .toBe("Közepes · Fosztogató rejtekhely · 3 védő · kapacitás 4");
    expect(translateDomainText("1/3 soldiers · 1 arriving", hungarian))
      .toBe("1/3 katona · 1 érkezik");
    expect(translateDomainText("Recruiting 2 recruits: equipping inside", hungarian))
      .toBe("Újoncozás: 2 újonc; bent szerelik fel");
    expect(translateDomainText("Ship 4", hungarian)).toBe("4. hajó");
    expect(translateDomainText("Harbour 2", hungarian)).toBe("2. kikötő");
    expect(translateDomainText("The home island has no planks, stone or food to send.", hungarian))
      .toBe("Az otthonszigeten nincs elküldhető deszka, kő vagy élelem.");
    expect(translateDomainText("No ground under the cursor.", hungarian)).toBe("Nincs föld a kurzor alatt.");
    expect(translateDomainText("Scenario completed — 5 coin reward.", hungarian))
      .toBe("Bemutató teljesítve — 5 érme jutalom.");
    expect(translateDomainText("Added 3 outputs to 2 buildings.", hungarian))
      .toBe("3 kimenet hozzáadva 2 épülethez.");
    expect(describeDomainWares({ boat: 2, stone: 10 }, hungarian)).toBe("2 Csónak, 10 Kő");
    const residence = HOME_TUTORIAL_QUESTS.find(quest => quest.id === "settlers.residence")!;
    expect(homeQuestTitle(residence, "roman", hungarian)).toBe("Építs 2 Kis lakóház");
    expect(homeQuestCopy(HOME_TUTORIAL_QUESTS.find(quest => quest.id === "wood.plant")!, "roman", hungarian).why)
      .toBe("A megújult erdő működésben tartja a faanyag-láncot.");
  });

  it("keeps the English source fallback exact", () => {
    expect(displayWareName("logs")).toBe("Softwood logs");
    expect(displayBuildingName(0)).toBe("Headquarters");
    expect(displayJobName("Iron founder")).toBe("Iron founder");
    expect(translateDomainText("Waiting for inputs")).toBe("Waiting for inputs");
    expect(homeQuestCopy(HOME_TUTORIAL_QUESTS.find(quest => quest.id === "wood.plant")!, "roman").why)
      .toBe("A renewed forest keeps the timber chain running.");
  });
});

describe("translation draft", () => {
  it("covers every canonical descriptor exactly once with a Hungarian translation", () => {
    const wareTexts = wareEntries().flatMap(entry => [entry.text.name, ...entry.text.plural ? [entry.text.plural] : []]);
    const buildings = catalogEntries()
      .filter(entry => entry.kind === "building" && entry.text.name.key.startsWith("domain."));
    const unitTexts = [...banditEntries(), ...buildings, ...settlerEntries(), ...soldierEntries()]
      .flatMap(entry => [entry.text.name, ...Object.values(entry.text.variants ?? {})]);
    // i18n-dedupe (2026-11-10) shares canonical ids between message maps; the draft lists each id once.
    const descriptors = [...new Map([...collectDomainMessages(), ...[...wareTexts, ...unitTexts].map(contentDescriptor)]
      .map(descriptor => [descriptor.id, descriptor] as const)).values()];
    const byId = new Map<string, { id: string; message: string; hu: string }>();
    for (const entry of draft) {
      expect(entry.id).toMatch(/^(domain\.|ship\.)/);
      expect(entry.hu.trim()).not.toBe("");
      expect(byId.has(entry.id)).toBe(false);
      byId.set(entry.id, entry);
    }
    expect(byId.size).toBe(descriptors.length);
    for (const descriptor of descriptors) {
      const entry = byId.get(descriptor.id);
      expect(entry, descriptor.id).toBeDefined();
      expect(entry!.message).toBe(source(descriptor));
    }
  });

  it("does not freeze a locale: the same descriptor follows the active catalog", () => {
    const english = setupI18n({ locale: "en", messages: {
      en: {},
      hu: Object.fromEntries(draft.map(entry => [entry.id, entry.hu]))
    } });
    expect(displayWareName("logs", english)).toBe("Softwood logs");
    english.activate("hu");
    expect(displayWareName("logs", english)).toBe("Puhafarönk");
  });
});

import { createElement } from "react";
import { expect, it } from "vitest";

import { CommanderRecruitDetails } from "../src/app/settlement-ui/building-details/commander-recruitment";
import { CommanderSection } from "../src/app/settlement-ui/building-details/commander-section";
import { SETTLEMENT_MESSAGES as M } from "../src/app/settlement-ui/messages";
import type {
  CommanderRecruitAvailability, CommanderSnapshot
} from "../src/shared/settlement/settlement-commander";
import { COMMANDER_DEFINITIONS } from "../src/shared/settlement/settlement-commander";
import { createTestI18n, renderWithI18n } from "./helpers/render-with-i18n";

const commander: CommanderSnapshot = {
  aura: { factor: .05, kind: "arrowReduction", radius: 6 },
  blockDetail: null,
  blockReason: "recovering",
  canReturn: false,
  deckSlots: 2,
  definition: COMMANDER_DEFINITIONS.roman,
  developmentAllowed: true,
  healingSeconds: 0,
  healthReady: false,
  homeLodgeUid: 5,
  hp: 100,
  hpFraction: 100 / 441,
  id: "commander-1",
  level: 2,
  location: "recovering",
  maximumHp: 441,
  name: "Aurelius",
  nation: "roman",
  nextThreshold: 100,
  ready: false,
  recoveryComplete: false,
  recoverySeconds: 600,
  xp: 30
};

const recruit: CommanderRecruitAvailability = {
  available: false,
  cost: { beer: 10, coins: 20, shield: 1, sword: 1, wine: 10 },
  hasCommander: false,
  idleSettlers: 3,
  missing: { coins: 20 },
  reason: "Missing recruit goods"
};

it("renders the commander card with level caret, health, recovery and aura in English", () => {
  const html = renderWithI18n(createElement(CommanderSection, { commander, nation: "roman", uid: 5,
    onLevelUp: (): true => true }), "en");
  expect(html).toContain("Aurelius");
  expect(html).toContain('data-rank-level="2"');
  expect(html.match(/data-chevron/g)).toHaveLength(2);
  expect(html).toContain("Level 2");
  expect(html).toContain("HP: 100 / 441");
  expect(html).toContain("Recovering · 10 min remaining");
  expect(html).toContain("5% less arrow damage");
  expect(html).toContain("Level up commander");
});

it("renders the paid recruit requirements and disabled reason in Hungarian", () => {
  const html = renderWithI18n(createElement(CommanderRecruitDetails, { definition: COMMANDER_DEFINITIONS.roman, nation: "roman", recruit }), "hu");
  expect(html).toContain("Felfogadási költség");
  expect(html).toContain("Hiányzik");
  expect(html).toContain('aria-label="10 Sör"');
  expect(html).toContain(">20</output>");
});

it("renders the twenty-coin recipe in English", () => {
  const html = renderWithI18n(createElement(CommanderRecruitDetails, { definition: COMMANDER_DEFINITIONS.roman, nation: "roman", recruit }), "en");
  expect(html).toContain(">20</output>");
});

it("keeps the catalog opener enabled without materials and disables it when capacity is owned", () => {
  const missing = renderWithI18n(createElement(CommanderSection, { nation: "roman", recruit, uid: 5 }), "en");
  expect(missing).toContain('aria-haspopup="dialog"');
  expect(missing).not.toContain("disabled");
  const owned = renderWithI18n(createElement(CommanderSection, { nation: "roman", recruit: {
    ...recruit, canRecruitMore: false, hasCommander: true }, uid: 5 }), "en");
  expect(owned).toContain("disabled");
});

it("uses the explicit Hungarian selector title from the compiled catalog", () => {
  expect(createTestI18n("hu")._(M.details.commander.selector)).toBe("Parancsnok kiválasztása");
});

import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import {
  ARCHIPELAGO_TEXT_KEYS, ARCHIPELAGO_TEXTS_EN, defaultColonyBook, generateAdventureScript, generateColonyScript,
  type ScenarioBookRules, scenarioRulesOf
} from "../../island-of-settlers-shared/src/script/archipelago/index";
import {
  COLONY_CANCELLED_QUEST_ID, COLONY_HARBOUR_LOST_QUEST_ID, COLONY_HOLD_DEADLINE, COLONY_HOLD_QUEST_ID
} from "../../island-of-settlers-shared/src/script/constants";
import { ScriptEngine } from "../../island-of-settlers-shared/src/script/engine/engine";
import { createNullWorldPort } from "../../island-of-settlers-shared/src/script/engine/ports";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/script";
import { DAY_MS, TICK_HZ, TICK_SECONDS } from "../../island-of-settlers-shared/src/time/constants";
import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import {
  colonyLostNotice, colonyLostPopup, lostColonies, rememberColonies, type SeenColony
} from "../src/app/script/ui/colony-lost-notice";
import { EMPTY_COLONY_NOTICE_MEMORY } from "../src/app/script/ui/constants";
import { ARCHIPELAGO_BOOK_MESSAGES } from "../src/shared/i18n/archipelago-book-messages";
import {
  type Archipelago, colonyEnd, type ColonyRecord, emptyArchipelago, endColony, expireColony, expiredColonies
} from "../src/shared/settlement/archipelago";
import {
  colonyNoticeMessage, customExpiryNotice, failColonyQuest
} from "../src/shared/settlement/archipelago-colony-quests";
import {
  type AuthoredScenarioProgress, updateAuthoredScenario
} from "../src/shared/settlement/authored-scenario-progress";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { EmigratedTroop } from "../src/shared/settlement/settlement-military";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createTestI18n } from "./helpers/render-with-i18n";
import { createMemorySaveStore } from "./memory-save-store";

/**
 * TRG10 parity per row of the generated colony/adventure books (trigger design §8.1): the book carries today's
 * rules and its archipelago rows end a colony exactly like today's code paths; plus the measured reason why the
 * authored stepper stays (the engine's one-second quest cadence).
 */

const CONQUERED_AT = Date.UTC(2026, 9, 1, 8);
const LOCALES = ["en", "hu", "de"] as const;
/**
 * The expiry notice as the active catalog renders it. Owner rule 2026-11-11: hu/de of new texts are filled by the
 * translation card after the merge, so the expectation reads the catalog instead of pinning a translation.
 */
const expiredText = (locale: (typeof LOCALES)[number], island = "Marble Cay") =>
  createTestI18n(locale)._(ARCHIPELAGO_BOOK_MESSAGES.colonyExpired.id, { island });
const EXPIRED_EN = "Marble Cay has expired. Its remaining settlers, troops and goods returned home.";

const troops: EmigratedTroop[] = [{ hp: 80, rank: 1, type: "archer" }];
const colonyRecord = (expeditionId: number, name: string, fields: Partial<ColonyRecord> = {}): ColonyRecord => ({
  conqueredAt: CONQUERED_AT, expeditionId,
  island: { difficulty: "easy", id: expeditionId, name, ore: "coal", seed: 3, voyageSeconds: 120 },
  landing: { crew: 2, landed: {}, troops }, status: "conquered", ...fields
});
const groupOf = (...colonies: ColonyRecord[]): Archipelago => ({ ...emptyArchipelago(), colonies });

/** A filed home island with a headquarters and its storage pool (what expiry credits). */
const homeSave = () => ({ map: "home", settlement: {
  actors: [], buildings: [{ construction: 1, inventory: {}, storagePoolId: 1, typeId: 0, uid: 1 }],
  storagePools: { pools: [{ available: {}, id: 1, owner: 0 }] }
} }) as unknown as GameSaveV1;

const RULES: ScenarioBookRules[] = [
  { claimSeconds: 0, expirySeconds: 0, objective: "defeat", rewardCoins: 0 },
  { claimSeconds: 0.15, expirySeconds: 0, objective: "capture", rewardCoins: 7 },
  { claimSeconds: 2, expirySeconds: 30, objective: "defeat", rewardCoins: 40 },
  { claimSeconds: 5, expirySeconds: 4, objective: "capture", rewardCoins: 12 },
  { claimSeconds: 1.3, expirySeconds: 0.7, objective: "defeat", rewardCoins: 3 }
];

interface StepperWorld { enemiesUntilTick: number; home: boolean; sitesCapturedAtTick: number }

/** Today's authored stepper over a scripted battle: the per-tick trace of its saved progress. */
const stepperTrace = (rules: ScenarioBookRules, world: StepperWorld, ticks: number) => {
  const outcomes: string[] = [];
  const home = { colonyHome: true, inventory: {} as Record<string, number>, typeId: 39, uid: 1 };
  const site = { militaryFaction: 1, typeId: 1, uid: 2 };
  const context = {
    authoredScenario: { claiming: 0, elapsed: 0, pendingCoins: 0, rewardPaid: false, sites: [site.uid],
      status: "active" } as AuthoredScenarioProgress,
    buildings: world.home ? [home, site] : [site],
    options: { onScenarioOutcome: (status: string, coins: number) => outcomes.push(`${status}:${coins}`),
      world: { scenario: rules } }
  } as unknown as Parameters<typeof updateAuthoredScenario>[0];
  const trace: string[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick === world.sitesCapturedAtTick) site.militaryFaction = 0;
    const enemies = tick <= world.enemiesUntilTick ? [{ combat: { faction: 1 } }] : [];
    updateAuthoredScenario(context, TICK_SECONDS, () => enemies as never);
    const { claiming, elapsed, pendingCoins, rewardPaid, status } = context.authoredScenario!;
    trace.push(`${tick}:${status}:${elapsed}:${claiming}:${pendingCoins}:${rewardPaid}:${home.inventory.coins ?? 0}`);
  }
  return { outcomes, trace };
};

const endTick = (trace: readonly string[], status: string) =>
  trace.findIndex(line => line.split(":")[1] === status) + 1;

/** The generated book in the shared engine; returns the game tick at which `colony.conquer` failed (0 = never). */
const engineExpiryTick = (script: MapScript, ticks: number) => {
  let tick = 0;
  const port = { ...createNullWorldPort(), gameNow: () => CONQUERED_AT + tick * 50, gameTick: () => tick };
  const engine = ScriptEngine.create(script, { port, scriptHash: "hash-test", seed: 1 });
  engine.start("mapStarted");
  for (tick = 1; tick <= ticks; tick++) {
    engine.endTick();
    if (engine.state.quests[script.quests.quests[0]!.id]!.state === "failed") return tick;
  }
  return 0;
};

describe("generated book texts", () => {
  it("every book text has its Lingui message with the same id and English source in all three catalogs", () => {
    const catalogs = LOCALES.map(locale => createTestI18n(locale));
    for (const key of Object.keys(ARCHIPELAGO_TEXT_KEYS) as (keyof typeof ARCHIPELAGO_TEXT_KEYS)[]) {
      const descriptor = ARCHIPELAGO_BOOK_MESSAGES[key];
      expect(descriptor.id).toBe(ARCHIPELAGO_TEXT_KEYS[key]);
      expect(descriptor.message).toBe(ARCHIPELAGO_TEXTS_EN[key]);
      for (const i18n of catalogs) expect(Object.hasOwn(i18n.messages, descriptor.id)).toBe(true);
    }
  });
});

describe("§8.1 colony.conquer / adventure.win: the book carries the authored scenario rules", () => {
  const worlds: StepperWorld[] = [
    { enemiesUntilTick: 12, home: true, sitesCapturedAtTick: 9 },
    { enemiesUntilTick: 30, home: false, sitesCapturedAtTick: 45 },
    { enemiesUntilTick: 2000, home: true, sitesCapturedAtTick: 2000 }
  ];
  it.each(RULES)("stepper driven by the book's rules = stepper driven by MapScenario ($objective, $claimSeconds s)",
    rules => {
      for (const script of [generateColonyScript(rules), generateAdventureScript(rules)]) {
        const fromBook = scenarioRulesOf(script.quests)!;
        expect(fromBook).toEqual(rules);
        for (const world of worlds)
          expect(stepperTrace(fromBook, world, 800)).toEqual(stepperTrace(rules, world, 800));
      }
    });

  it("claimSeconds and pendingCoins: the win waits for the hold time; coins stay pending without a home", () => {
    const rules = RULES[2]!, book = scenarioRulesOf(generateColonyScript(rules).quests)!;
    const paid = stepperTrace(book, { enemiesUntilTick: 10, home: true, sitesCapturedAtTick: 0 }, 100);
    expect(endTick(paid.trace, "won")).toBe(10 + rules.claimSeconds * TICK_HZ);
    expect(paid.outcomes).toEqual([`won:${rules.rewardCoins}`]);
    expect(paid.trace.at(-1)).toMatch(/:0:true:40$/);
    const pending = stepperTrace(book, { enemiesUntilTick: 10, home: false, sitesCapturedAtTick: 0 }, 100);
    expect(pending.trace.at(-1)).toMatch(/:40:false:0$/);
  });

  it("measured gap: the engine checks the gameTime deadline on its one-second cadence, the stepper per tick", () => {
    const gaps = [30, 4, 0.7].map(expirySeconds => {
      const rules = { claimSeconds: 0, expirySeconds, objective: "defeat", rewardCoins: 0 } as ScenarioBookRules;
      const stepper = endTick(stepperTrace(rules, { enemiesUntilTick: 9999, home: true, sitesCapturedAtTick: 0 },
        1000).trace, "expired");
      return { engine: engineExpiryTick(generateColonyScript(rules), 1000), expirySeconds, stepper };
    });
    // The stepper expires on the tick its float sum `elapsed += 0.05` reaches the seconds (4 s: tick 81, because
    // 80 additions give 3.9999999999999996); the engine activates the quest at the first cadence (tick 20) and
    // checks deadlines every 20 ticks in whole ticks, so it is about one second late (more for fractions).
    expect(gaps).toEqual([
      { engine: 620, expirySeconds: 30, stepper: 600 },
      { engine: 100, expirySeconds: 4, stepper: 81 },
      { engine: 40, expirySeconds: 0.7, stepper: 14 }
    ]);
  });
});

describe("§8.1 colony.hold: expiry through the archipelago executor = today's expireColony", () => {
  it("the locked deadline is the catalog colony lifetime and the same instant as expiredColonies", () => {
    const hold = defaultColonyBook().quests.find(quest => quest.id === COLONY_HOLD_QUEST_ID)!;
    expect(hold.deadline).toEqual({ ...COLONY_HOLD_DEADLINE, kind: "dateAfterActivation" });
    expect(COLONY_HOLD_DEADLINE.days * DAY_MS).toBe(COLONY_LIFETIME_MS);
    const group = groupOf(colonyRecord(4, "Marble Cay"));
    expect(expiredColonies(group, CONQUERED_AT + COLONY_LIFETIME_MS - 1)).toHaveLength(0);
    expect(expiredColonies(group, CONQUERED_AT + COLONY_LIFETIME_MS)).toHaveLength(1);
  });

  it.each([{ home: false }, { home: true }])("same island group as expireColony (home filed: $home)", ({ home }) => {
    const colony = colonyRecord(4, "Marble Cay"), now = CONQUERED_AT + COLONY_LIFETIME_MS;
    const group = { ...groupOf(colony, colonyRecord(5, "Tin Reef")),
      ...(home ? { home: homeSave() } : {}) };
    const failure = failColonyQuest(group, colony, COLONY_HOLD_QUEST_ID, { now });
    expect(failure.archipelago).toEqual(expireColony(group, colony, now));
    expect(failure.ended).toBe("expired");
    expect(expiredText("en")).toBe(EXPIRED_EN);
    for (const locale of LOCALES)
      expect(colonyNoticeMessage(failure.notices, "Marble Cay", createTestI18n(locale))).toBe(expiredText(locale));
  });

  it("a colony the server already dropped: colonyEnd is skipped, the group is untouched, one notice", () => {
    const colony = colonyRecord(4, "Marble Cay"), group = groupOf(colonyRecord(5, "Tin Reef"));
    expect(colonyEnd(group, colony, "expired", { now: 0 })).toBeNull();
    const failure = failColonyQuest(group, colony, COLONY_HOLD_QUEST_ID, { now: 0 });
    expect(failure.archipelago).toBe(group);
    expect(failure.ended).toBeNull();
    expect(failure.notices).toHaveLength(1);
    expect(group.evacuations).toBeUndefined();
  });
});

describe("§8.1 colony.cancelled / colony.harbourLost: ended without the asset return of expiry", () => {
  it.each([
    [COLONY_CANCELLED_QUEST_ID, "cancelled", "Marble Cay was disbanded. Its garrison sailed home."],
    [COLONY_HARBOUR_LOST_QUEST_ID, "lost", "Marble Cay is lost: its harbour was destroyed."]
  ] as const)("%s = today's endColony with the survivors", (questId, reason, text) => {
    const colony = colonyRecord(4, "Marble Cay"), group = groupOf(colony, colonyRecord(5, "Tin Reef"));
    const failure = failColonyQuest(group, colony, questId, { now: CONQUERED_AT, survivors: troops });
    expect(failure.archipelago).toEqual(endColony(group, 4, troops));
    expect(failure.archipelago.evacuations).toBeUndefined();
    expect(failure.ended).toBe(reason);
    expect(colonyNoticeMessage(failure.notices, "Marble Cay", createTestI18n())).toBe(text);
  });
});

describe("offline drop: one local notice per expedition with the book's text", () => {
  const marble: SeenColony = { id: 4, name: "Marble Cay", ore: "coal" };
  const tin: SeenColony = { id: 5, name: "Tin Reef", ore: "iron" };

  it.each(LOCALES)("shows the colony.hold notify text once (%s) and never stores a mail", locale => {
    const seen = rememberColonies(EMPTY_COLONY_NOTICE_MEMORY, [marble, tin], []);
    const lost = lostColonies(seen, [tin]);
    expect(lost).toEqual([marble]);
    const i18n = createTestI18n(locale);
    expect(colonyLostNotice(marble, i18n)).toBe(expiredText(locale));
    expect(colonyLostNotice(marble, i18n)).toContain("Marble Cay");
    const popup = colonyLostPopup(lost, i18n);
    expect(popup.message).toBe(expiredText(locale));
    expect(Object.keys(popup)).not.toContain("mail");
    const nextLogin = rememberColonies(seen, [tin], lost);
    expect(lostColonies(nextLogin, [tin])).toEqual([]);
    expect(lostColonies({ ...nextLogin, seen: [marble, tin] }, [tin])).toEqual([]);
  });

  it("two colonies dropped together: one paragraph each; a colony's own book text wins", () => {
    const script = structuredClone(generateColonyScript()) as MapScript;
    const hold = script.quests.quests.find(quest => quest.id === COLONY_HOLD_QUEST_ID)!;
    (hold.onFailure[1] as unknown as { args: { text: { text: object } } }).args.text.text =
      { en: "{island} is gone.", hu: "{island} odalett.", values: { island: {
        expr: { args: {}, fn: "islandName", k: "fn" }, format: "text", kind: "expr" } } };
    const save = { settlement: { scriptSnapshot: { revision: 1, script, scriptHash: "h" } } } as unknown as GameSaveV1;
    const notice = customExpiryNotice({ save });
    expect(customExpiryNotice({})).toBeUndefined();
    const own = { ...tin, notice };
    const stored = JSON.parse(JSON.stringify(rememberColonies(EMPTY_COLONY_NOTICE_MEMORY, [marble, own], [])));
    const popup = colonyLostPopup(lostColonies(stored, []), createTestI18n("hu"));
    expect(popup.message).toBe(`${expiredText("hu")}\n\nTin Reef odalett.`);
  });
});

describe("archipelago session: expiry and disbanding notify with the quest's text", () => {
  const fakeSimulation = (now: number) => ({
    adventure: () => undefined, buildings: () => [], colony: () => undefined, colonyExpeditions: () => [],
    gameNow: () => now, receiveHomeGoods: () => undefined, receiveTroops: () => undefined, sendVisitorShip: () => null,
    releaseColony: () => true,
    saveState: () => ({ military: { soldiers: [] } }), talentModifiers: () => ({ colonyShipIntervalReduction: 0 })
  }) as unknown as SettlementSimulation;
  const session = (initial: Archipelago, now: number, locale: "en" | "hu" = "en") => {
    const { games, store } = createMemorySaveStore(), messages: string[] = [], simulation = fakeSimulation(now);
    const travel = createArchipelagoSession({
      capture: async () => ({ map: "home", settlement: simulation.saveState() }) as unknown as GameSaveV1,
      i18n: createTestI18n(locale), initial, notify: text => messages.push(text), reload: () => undefined,
      simulation, store
    });
    return { games, messages, travel };
  };

  it("at home a filed colony expires once, with the colony.hold notice in the player's language", () => {
    const group = groupOf(colonyRecord(4, "Marble Cay"), colonyRecord(5, "Tin Reef", {
      conqueredAt: CONQUERED_AT + DAY_MS }));
    const { messages, travel } = session(group, CONQUERED_AT + COLONY_LIFETIME_MS, "hu");
    expect(travel.colonies().map(colony => colony.expeditionId)).toEqual([5]);
    travel.colonies();
    // The second line is the unchanged evacuation landing message of the home harbour.
    expect(messages).toEqual([expiredText("hu"),
      "Marble Cay: remaining troops and goods returned to the home harbour."]);
  });

  it("disbanding a filed colony fails colony.cancelled: survivors return and its notice is shown", async () => {
    const { games, messages, travel } = session(groupOf(colonyRecord(4, "Marble Cay")), CONQUERED_AT);
    expect(await travel.disband(4)).toBe(true);
    expect(messages).toEqual(["Marble Cay was disbanded. Its garrison sailed home."]);
    expect(travel.colonies()).toEqual([]);
    expect(games).toHaveLength(1);
  });
});

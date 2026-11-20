import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { type BattleMessage, createBattleMessage } from "../src/shared/progression/battle-messages";
import { validInboxMails } from "../src/shared/progression/inbox-mails";
import { createPlayerProgress, validatePlayerProgress } from "../src/shared/progression/player-progress";
import { addBattleTroops, copyBattleRecord, createBattleRecord, recordBattleDeath } from "../src/shared/settlement/expedition-battle-record";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
const troop = { hp: 50, rank: 0, type: "shield" as const };
const fort = { uid: 5, typeId: 4, militaryFaction: 1, bandit: { code: 1, layout: 0 } } as SettlementBuilding;

describe("persistent expedition battle reports", () => {
  it("records reinforcements and true deaths independently from surviving or withdrawn units", () => {
    const battle = createBattleRecord([troop, troop], [fort]);
    addBattleTroops(battle, [{ ...troop, type: "archer" }]);
    recordBattleDeath(battle, "shield", 0); recordBattleDeath(battle, "archer", 1);
    const snapshot = copyBattleRecord(battle)!;
    recordBattleDeath(battle, "shield", 0);
    expect(snapshot.sent).toEqual({ shield: 2, archer: 1 });
    expect(snapshot.lost).toEqual({ shield: 1 });
    expect(snapshot.defeated).toEqual({ archer: 1 });
    const message = createBattleMessage({ kind: "colony", island: { name: "Test", seed: 3 }, date: 10,
      nation: "roman", battle: snapshot, buildings: [], goods: {}, experience: 20 });
    expect(message.buildings).toEqual([{ type: 4, bandit: { code: 1, layout: 0 }, count: 1 }]);
    expect(validInboxMails([message])).toBe(true);
    expect(validatePlayerProgress({ ...createPlayerProgress(3), messages: [message] })).toBe(true);
    expect(validInboxMails([{ ...message, lost: { shield: -1 } }])).toBe(false);
  });
  it("sends one saved colony message, preserves its read state, and grants no invented resources", () => {
    const colony = { island: { name: "Test", seed: 3, difficulty: "easy" }, status: "conquered",
      conqueredAt: 100, battle: createBattleRecord([troop], [fort]) };
    const simulation = { home: () => undefined, buildings: () => [], playerNation: () => "roman",
      islandRole: () => "colony", colony: () => colony, setTalentRanks: () => true } as unknown as SettlementSimulation;
    const session = createPlayerSession({ now: Date.now, seed: 3 }); session.bind(simulation);
    session.colonyConquered("easy"); session.colonyConquered("easy");
    expect(session.progress().messages).toHaveLength(1);
    const message = session.progress().messages![0]! as BattleMessage;
    expect(message.goods).toEqual({});
    session.readMessage(message.id);
    const restored = createPlayerSession({ initial: JSON.parse(JSON.stringify(session.progress())), now: Date.now,
      seed: 3 });
    expect(restored.progress().messages![0]!.read).toBe(true);
  });
  it("marks missing historical statistics explicitly", () => {
    const message = createBattleMessage({ kind: "adventure", island: { name: "Old", seed: 3 }, date: 10,
      nation: "roman", buildings: [], goods: { coins: 20 }, experience: 20 });
    expect(message.incomplete).toBe(true); expect(message.sent).toEqual({});
  });
});

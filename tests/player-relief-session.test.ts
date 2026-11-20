import { describe, expect, it, vi } from "vitest";

import { createPlayerReliefSession } from "../src/app/settlement/player-relief-session";
import type { ReliefIslandPort } from "../src/app/settlement/relief-island-port";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { registerReliefQuests } from "../src/shared/progression/relief-quests";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";

const fixture = (preparePayment?: () => Promise<true | string>) => {
  const day = "2026-10-28", id = `${day}-0`;
  const quest = { id, amount: 4, done: false, experience: 10, kind: "deliver" as const, progress: 0,
    reward: { coins: 3 }, ware: "fish" };
  let progress = { ...createPlayerProgress(3), questDay: day, quests: [quest],
    relief: registerReliefQuests(undefined, [quest], day) };
  let current = true, stock = 8;
  let archived: { blocker?: string } | undefined;
  let aidBlocker: string | undefined;
  const request = vi.fn(() => { stock -= 4; return { ok: true, harbourUid: 4 }; });
  const statuses = vi.fn(() => []);
  const simulation = { buildings: () => [{ typeId: 39, construction: 1 }],
    reliefCollections: statuses, reliefCollectionsToPrune: () => [],
    reliefCollectionCandidates: () => [{ harbourUid: 4, available: stock }],
    requestReliefCollection: request, saveState: () => ({ world: { seed: 3 } }) } as unknown as SettlementSimulation;
  const session = createPlayerReliefSession({ get: () => progress, refresh: () => progress,
    commit: next => { progress = next as typeof progress; }, simulation: () => simulation,
    port: () => {
      const source = archived;
      if (!source && !aidBlocker) return undefined;
      return { statuses: () => source ? [{ questId: id, ware: "fish", amount: 4, harbourUid: 9,
        islandSeed: 7, stage: "paid-awaiting-ship", loaded: 0, departed: false, blocker: source.blocker }] : [],
      newAidBlocker: () => aidBlocker } as unknown as ReliefIslandPort;
    },
    localize: text => text, preparePayment, isCurrent: () => current });
  return { id, request, session, statuses, stock: () => stock, progress: () => progress,
    replaceIsland: () => { current = false; }, changeStock: (amount: number) => { stock = amount; },
    archiveBlocker: (blocker?: string) => { archived = { blocker }; },
    blockAid: (reason: string) => { aidBlocker = reason; } };
};

describe("physical relief payment bridge", () => {
  it("blocks new local aid before preparation/debit while closed relief rewards remain", async () => {
    const prepare = vi.fn(async () => true as const), state = fixture(prepare);
    const reason = "Claim the completed relief rewards before sending more aid";
    state.blockAid(reason);
    expect(state.session.status(state.id)).toMatchObject({ payable: false, blocker: reason, available: 8 });
    expect(await state.session.pay(state.id)).toBe(reason);
    expect(prepare).not.toHaveBeenCalled(); expect(state.request).not.toHaveBeenCalled();
    const later = fixture(async () => { later.blockAid(reason); return true; });
    expect(await later.session.pay(later.id)).toBe(reason);
    expect(later.request).not.toHaveBeenCalled();
  });
  it("requires server preparation before any custody debit and preserves the request while pending", async () => {
    let finish!: (result: true | string) => void;
    const prepare = vi.fn(() => new Promise<true | string>(resolve => { finish = resolve; }));
    const state = fixture(prepare), payment = state.session.pay(state.id);
    expect(prepare).toHaveBeenCalledOnce();
    expect(state.request).not.toHaveBeenCalled();
    expect(state.session.context().retainedQuestIds.has(state.id)).toBe(true);
    expect(await state.session.pay(state.id)).toMatch(/already paid or unavailable/);
    finish(true);
    expect(await payment).toBe(true);
    expect(state.stock()).toBe(4);
    expect(state.progress().experience).toBe(0);
    expect(state.session.status(state.id)).toMatchObject({ stage: "paid-awaiting-ship", loaded: 0, departed: false });
    expect(state.session.claimProblem(state.id)).toMatch(/fully loaded/);
    expect(await state.session.pay(state.id)).toMatch(/already paid or unavailable/);
    expect(state.request).toHaveBeenCalledOnce();
  });

  it("leaves goods and reward untouched when the preparation receipt is refused", async () => {
    const state = fixture(async () => "Server refused the manifest");
    expect(await state.session.pay(state.id)).toBe("Server refused the manifest");
    expect(state.stock()).toBe(8);
    expect(state.request).not.toHaveBeenCalled();
    expect(state.session.status(state.id)?.stage).toBe("awaiting-aid");
  });

  it("rechecks island generation and actual available wares after the server await", async () => {
    let finish!: (result: true) => void;
    const state = fixture(() => new Promise<true>(resolve => { finish = resolve; }));
    const payment = state.session.pay(state.id);
    state.replaceIsland(); finish(true);
    expect(await payment).toMatch(/island changed/);
    expect(state.request).not.toHaveBeenCalled();
    const drift = fixture(async () => { drift.changeStock(0); return true; });
    expect(await drift.session.pay(drift.id)).toMatch(/enough reachable/);
    expect(drift.request).not.toHaveBeenCalled();
  });

  it("does not start background archive work or mutate custody while displaying statuses", () => {
    const state = fixture();
    state.session.statuses(); state.session.statuses();
    expect(state.request).not.toHaveBeenCalled();
    expect(state.stock()).toBe(8);
    expect(state.session.status(state.id)).toMatchObject({ payable: true, available: 8 });
  });

  it("preserves the live archived coordinator's blocker and never invents a travel requirement", () => {
    const state = fixture();
    state.archiveBlocker("Waiting for a verified island checkpoint");
    expect(state.session.status(state.id)?.blocker).toBe("Waiting for a verified island checkpoint");
    state.archiveBlocker();
    expect(state.session.status(state.id)?.stage).toBe("paid-awaiting-ship");
    expect(state.session.status(state.id)?.blocker).toBeUndefined();
  });
});

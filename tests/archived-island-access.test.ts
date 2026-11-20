import { describe, expect, it, vi } from "vitest";

import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchivedIslandAccess } from "../src/app/settlement/archived-island-access";
import { createPlayerProgress, type PlayerProgress } from "../src/shared/progression/player-progress";
import type { Archipelago } from "../src/shared/settlement/archipelago";
import { type ArchivedIslandProof, withArchivedIslandProof } from "../src/shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

// This tests archive transaction custody; full map/worker restoration belongs to the relief port case.
const save = (map: string, fish: number) => ({ map, settlement: { buildings: [{ inventory: { fish } }] } }) as unknown as GameSaveV1;
const fixture = (player?: () => PlayerProgress,
  archivedWrite?: (save: GameSaveV1, proof: ArchivedIslandProof) => Promise<GameSaveV1 | void>) => {
  let group = { version: 1, active: 1, home: save("home", 8), colonies: [
    { expeditionId: 1, status: "conquered", save: save("active-stale", 99) },
    { expeditionId: 2, status: "conquered", save: save("owned", 7) },
    { expeditionId: 3, status: "fighting", save: save("hostile", 9) },
    { expeditionId: 4, status: "conquered" }
  ], adventures: [{ expeditionId: 5, status: "won", save: save("adventure", 12) }] } as unknown as Archipelago;
  const active = save("active", 13), persist = vi.fn(async (_saved: GameSaveV1) => undefined);
  const transition = createSessionLifecycle();
  const access = createArchivedIslandAccess({ capture: async () => active, group: () => group,
    persist: { writeArchivedIslandGame: archivedWrite, writeSavedGame: persist }, player,
    setGroup: next => { group = next; }, transition });
  return { access, active, group: () => group, persist, transition };
};

describe("filed owned-island mutation", () => {
  it("lists only archived home and conquered saved colonies, never active, hostile, unvisited or adventures", () => {
    const { access } = fixture();
    expect(access.archivedOwnedIslands().map(island => island.islandId)).toEqual([null, 2]);
  });

  it("persists the same archived island before publication and never credits the active island", async () => {
    const { access, active, group, persist, transition } = fixture(), original = group();
    const result = await access.updateArchivedIsland(2, "quest-a", async baseline => {
      baseline.settlement.buildings[0]!.inventory.fish! -= 4;
      expect(group()).toBe(original);
      return { save: baseline, value: "reserved" };
    });
    expect(result).toEqual({ ok: true, value: "reserved" });
    expect(persist).toHaveBeenCalledTimes(1);
    const durable = persist.mock.calls[0]![0];
    expect(durable.map).toBe(active.map);
    expect(durable.settlement.buildings[0]!.inventory.fish).toBe(13);
    expect(durable.archipelago!.colonies[1]!.save!.settlement.buildings[0]!.inventory.fish).toBe(3);
    expect(group().home).toBe(original.home);
    expect(group().colonies[0]).toBe(original.colonies[0]);
    expect(group().colonies[2]).toBe(original.colonies[2]);
    expect(original.colonies[1]!.save!.settlement.buildings[0]!.inventory.fish).toBe(7);
    expect(transition.frozen()).toBe(false);
  });

  it("refuses active/unknown islands and failed storage without changing original custody", async () => {
    const { access, group, persist } = fixture(), original = group();
    const change = vi.fn(async (baseline: GameSaveV1) => ({ save: baseline, value: true }));
    expect((await access.updateArchivedIsland(1, "bad", change)).ok).toBe(false);
    expect((await access.updateArchivedIsland(3, "bad", change)).ok).toBe(false);
    expect(change).not.toHaveBeenCalled();
    persist.mockRejectedValueOnce(new Error("storage failure"));
    expect((await access.updateArchivedIsland(2, "failed", async baseline => {
      baseline.settlement.buildings[0]!.inventory.fish = 0;
      return { save: baseline, value: true };
    })).ok).toBe(false);
    expect(group()).toBe(original);
    expect(group().colonies[1]!.save!.settlement.buildings[0]!.inventory.fish).toBe(7);
  });

  it("coalesces duplicate requests and serializes with travel", async () => {
    const { access, persist, transition } = fixture();
    let release: () => void = () => undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const change = vi.fn(async (baseline: GameSaveV1) => { await pending; return { save: baseline, value: true }; });
    const first = access.updateArchivedIsland(2, "same-quest", change);
    const repeated = access.updateArchivedIsland(2, "same-quest", change);
    expect(await transition.run({ key: "travel:home", run: async () => true })).toMatchObject({ ok: false, reason: "busy" });
    release();
    expect(await first).toEqual({ ok: true, value: true });
    expect(await repeated).toEqual({ ok: true, value: true });
    expect(change).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledTimes(1);
  });

  it("refuses to overwrite a concurrent in-place colony-economy credit", async () => {
    const { access, group, persist } = fixture();
    const result = await access.updateArchivedIsland(2, "concurrent-credit", async baseline => {
      baseline.settlement.buildings[0]!.inventory.fish! -= 4;
      // Existing colony economy can mutate a filed stock object without replacing the group object.
      group().colonies[1]!.save!.settlement.buildings[0]!.inventory.fish! += 2;
      return { save: baseline, value: true };
    });
    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(group().colonies[1]!.save!.settlement.buildings[0]!.inventory.fish).toBe(9);
    expect(persist).not.toHaveBeenCalled();
  });

  it("passes fresh global quest context into a private clone and keeps the durable active player authoritative", async () => {
    const current = { ...createPlayerProgress(7), experience: 900, questDay: "2026-10-29" };
    const { access, group, persist } = fixture(() => current);
    const stale = { ...createPlayerProgress(7), questDay: "2026-10-27" };
    group().colonies[1]!.save!.player = stale;
    const result = await access.updateArchivedIsland(2, "player-context", async baseline => {
      expect(baseline.player).toEqual(current); expect(baseline.player).not.toBe(current);
      baseline.player!.experience = 999;
      expect(current.experience).toBe(900);
      return { save: baseline, value: true };
    });
    expect(result.ok).toBe(true);
    expect(stale.questDay).toBe("2026-10-27");
    expect(persist.mock.calls[0]![0].player).toBe(current);
  });

  it("publishes the returned server-attested archive instead of resurrecting acknowledged proof", async () => {
    const proof: ArchivedIslandProof = { version: 1, island: "colony-2", intervals: [], coverage: { from: 0, to: 0 } };
    const archivedWrite = vi.fn(async (payload: GameSaveV1) => {
      const canonical = structuredClone(payload);
      canonical.archipelago!.colonies[1]!.save!.runtime = { attested: true };
      return canonical;
    });
    const { access, group, persist } = fixture(undefined, archivedWrite);
    expect(await access.updateArchivedIsland(2, "attestation", async baseline => ({
      save: withArchivedIslandProof(baseline, proof), value: "paid", proof
    }))).toEqual({ ok: true, value: "paid" });
    expect(archivedWrite).toHaveBeenCalledTimes(1); expect(persist).not.toHaveBeenCalled();
    expect(group().colonies[1]!.save!.runtime).toEqual({ attested: true });
  });

  it("keeps paid custody and proof when durable remote attestation remains pending", async () => {
    const proof: ArchivedIslandProof = { version: 1, island: "colony-2", intervals: [], coverage: { from: 0, to: 0 } };
    const { access, group } = fixture(undefined, async () => undefined);
    expect(await access.updateArchivedIsland(2, "pending-proof", async baseline => {
      baseline.settlement.buildings[0]!.inventory.fish! -= 4;
      return { save: withArchivedIslandProof(baseline, proof), value: "paid", proof };
    })).toEqual({ ok: true, value: "paid" });
    expect(group().colonies[1]!.save!.settlement.buildings[0]!.inventory.fish).toBe(3);
    expect(group().colonies[1]!.save!.runtime).toHaveProperty("archivedReliefProof", proof);
  });

  it("refuses stale global progress immediately before persistence, preserving active earned XP", async () => {
    let current = createPlayerProgress(7);
    const { access, group, persist } = fixture(() => current), original = group();
    const result = await access.updateArchivedIsland(2, "stale-progress", async baseline => {
      const player = { ...baseline.player!, experience: 100 };
      current = { ...current, experience: 10 };
      return { save: baseline, value: true, player };
    });
    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(current.experience).toBe(10); expect(group()).toBe(original); expect(persist).not.toHaveBeenCalled();
  });

  it("holds native ticks, commands and travel throughout a delayed durable remote acknowledgment", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const writing = vi.fn(async () => { await pending; });
    const { access, group, transition } = fixture(undefined, writing), before = group();
    const proof: ArchivedIslandProof = { version: 1, island: "colony-2", intervals: [], coverage: { from: 0, to: 0 } };
    const operation = access.updateArchivedIsland(2, "slow-remote", async baseline => {
      baseline.settlement.buildings[0]!.inventory.fish! -= 4;
      return { save: withArchivedIslandProof(baseline, proof), proof, value: true };
    });
    await vi.waitFor(() => expect(writing).toHaveBeenCalledTimes(1));
    expect(transition.frozen()).toBe(true); expect(access.isMutating()).toBe(true);
    expect(group()).toBe(before);
    let nativeTicks = 0;
    for (let frame = 0; frame < 100; frame++) if (!transition.frozen()) nativeTicks++;
    expect(nativeTicks).toBe(0);
    expect(await transition.run({ key: "travel:home", run: async () => true })).toMatchObject({ ok: false, reason: "busy" });
    release(); expect(await operation).toEqual({ ok: true, value: true });
    expect(group().colonies[1]!.save!.settlement.buildings[0]!.inventory.fish).toBe(3);
    expect(transition.frozen()).toBe(false); expect(access.isMutating()).toBe(false);
  });
});

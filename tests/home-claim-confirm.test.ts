import { expect, it, vi } from "vitest";

import { mapScriptHash } from "../../island-of-settlers-shared/src/script/hash";
import { emptyScript, ref } from "../../island-of-settlers-shared/tests/script-fixtures";
import { homeRewardClaimBody } from "../src/app/cloud/quest-claim-body";
import { SaveApiError } from "../src/app/save-store/save-api-client";
import { createHomeClaimSubmitter } from "../src/app/settlement/home-claim-submitter";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { HOME_CLAIM_NOT_PENDING } from "../src/shared/settlement/constants";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

/** TRG7: declared home rewards leave `pendingHomeClaims` only through the recorded, server-confirmed command. */
const script = emptyScript({
  homeRewards: [{ id: "reward-1", name: "Gift", occurrence: { kind: "once" },
    rewards: [{ amount: 9, kind: "coins" }] }],
  quests: { ...emptyScript().quests, id: "island-book" },
  triggers: [{ actions: [{ args: { reward: ref("reward", "reward-1") }, id: "s1", k: "do", op: "grantHomeReward" }],
    concurrency: "queue", conditions: { k: "all", of: [] }, enabled: true,
    events: [{ kind: "mapStarted", player: { kind: "any" }, slots: {} }], folderId: null, id: "trigger-1",
    name: "gift", runLimit: null }]
});

const create = () => {
  const world = huntingWorld();
  world.script = script;
  return createSettlementSimulation({ clockStart: 0, initialSettlers: 0, roads: createRoadNetwork(world), world });
};

const granted = () => {
  const simulation = create();
  for (let tick = 0; tick < 3; tick++) simulation.update(.05);
  return simulation;
};

it("lists the pending grant with its book identity and confirms it once, replaying at the same tick", () => {
  const simulation = granted();
  const [pending] = simulation.pendingHomeClaims();
  expect(pending).toEqual({ anchorUtc: expect.any(Number), bookId: "island-book", occurrence: "0",
    rewardId: "reward-1", scriptHash: mapScriptHash(script) });
  expect(homeRewardClaimBody(pending!, Date.UTC(2026, 10, 11))).toMatchObject({
    claim: { kind: "reward", rewardId: "reward-1" }, occurrence: "0", v: 2,
    script: { bookId: "island-book", mapHash: null, scriptHash: mapScriptHash(script) } });
  const base = simulation.saveState();
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "home-claim" });
  recorder.open();
  expect(simulation.confirmHomeClaim({ goods: { coins: 9 }, occurrence: "1", rewardId: "reward-1" }))
    .toBe(HOME_CLAIM_NOT_PENDING);
  expect(simulation.confirmHomeClaim({ goods: { coins: 9 }, occurrence: "0", rewardId: "reward-1" })).toBe(true);
  expect(simulation.confirmHomeClaim({ goods: { coins: 9 }, occurrence: "0", rewardId: "reward-1" }))
    .toBe(HOME_CLAIM_NOT_PENDING);
  simulation.update(.05);
  const interval = recorder.close("home")!;
  expect(simulation.pendingHomeClaims()).toEqual([]);
  const replay = create();
  expect(replay.loadState(base).ok).toBe(true);
  expect(replayCommandLog(replay, interval)).toEqual({ ok: true, endChecksum: interval.endChecksum });
  expect(replay.pendingHomeClaims()).toEqual([]);
});

it("submits pending claims, confirms them with the ledger's goods and XP, and retries transient failures", async () => {
  const simulation = granted();
  const timers = { clear: vi.fn(), set: vi.fn((run: () => void) => { queueMicrotask(run); return 0 as never; }) };
  const claim = vi.fn()
    .mockRejectedValueOnce(new SaveApiError(503, "UNAVAILABLE", "offline"))
    .mockResolvedValueOnce({ goods: { coins: 9 }, xp: 4 });
  const grantExperience = vi.fn();
  const submitter = createHomeClaimSubmitter({ claim, grantExperience, log: () => {}, simulation, timers });
  await vi.waitFor(() => expect(simulation.pendingHomeClaims()).toEqual([]));
  expect(claim).toHaveBeenCalledTimes(2);
  expect(grantExperience).toHaveBeenCalledWith(4);
  submitter.dispose();
});

it("keeps a refused claim pending and does not resubmit it in the same session", async () => {
  const simulation = granted();
  const claim = vi.fn(async () => "This claim needs the completion proof (not available yet)");
  const submitter = createHomeClaimSubmitter({ claim, grantExperience: () => {}, log: () => {}, simulation });
  await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
  submitter.sync();
  expect(claim).toHaveBeenCalledTimes(1);
  expect(simulation.pendingHomeClaims()).toHaveLength(1);
  submitter.dispose();
});

it("flush offers a refused claim again and waits for its answer (a won campaign replay, C9b)", async () => {
  const simulation = granted();
  const claim = vi.fn()
    .mockResolvedValueOnce("A campaign replay pays its rewards once the map is won")
    .mockResolvedValueOnce({ goods: { coins: 3 }, xp: 0 });
  const submitter = createHomeClaimSubmitter({ claim, grantExperience: () => {}, log: () => {}, simulation });
  await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
  await submitter.flush();
  expect(claim).toHaveBeenCalledTimes(2);
  expect(simulation.pendingHomeClaims()).toEqual([]);
  submitter.dispose();
});

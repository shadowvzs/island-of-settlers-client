import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ONLINE_SETTINGS } from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { LEGACY_SIM_RULES, toSimRules } from "../../island-of-settlers-shared/src/game-settings/sim-rules";

import type { PlayerAccount } from "../src/app/account/account-boot";
import type { AccountScroll } from "../src/app/account/account-scroll";
import type { ScrollPage } from "../src/app/account/scroll/scroll-pages";
import { type CloudSession, endCloudSession, startCloudSession } from "../src/app/cloud/cloud-boot";
import { bindCloudSession } from "../src/app/cloud/cloud-ui";
import type { LevelClaim } from "../src/app/cloud/economy-client";
import { describeSlot, getCloudStatusView, getVerificationView } from "../src/app/cloud/helpers";
import { createLeaseKeeper, grantedSimRules } from "../src/app/cloud/session-lease";
import { createVerificationStatus } from "../src/app/cloud/verification-status";
import { createExternalStore } from "../src/app/components/ui-store";
import type { CloudSaveStatus } from "../src/app/save-store/remote-save-store";
import { recoverySlotId } from "../src/app/save-store/save-retention";
import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { createSaveStatus } from "../src/app/save-store/save-status";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import type { SettlementPopupContent } from "../src/app/settlement-ui/settlement-popup";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createMemoryStorage } from "./memory-storage";
import { completeGame } from "./save-fixtures";

const API = "http://127.0.0.1:3002";
const SLOT = { id: "5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11", name: "Slot 1", revision: 3, slot_no: 1 };
const LEASE = { expiresAt: "2026-10-22T12:00:00.000Z", leaseId: "9d6b8a51-1f0e-4a3e-9a51-2d0f2d1f0b22",
  ttlSeconds: 90 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("session lease keeper", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const keeper = (...answers: (Error | { lease?: typeof LEASE; ok: boolean; reason?: string })[]) => {
    const onLost = vi.fn(), renewLease = vi.fn(async () => {
      const next = answers.shift() ?? { lease: LEASE, ok: true };
      if (next instanceof Error) throw next;
      return next;
    });
    const api = { acquireLease: vi.fn(async (takeOver: boolean) => (takeOver ? { lease: LEASE, ok: true }
      : { ok: false, reason: "held" })), releaseLease: vi.fn(async () => undefined), renewLease };
    return { api, lease: createLeaseKeeper({ api: api as never, onLost }), onLost };
  };

  it("is held by another device until taken over, then renews three times per lifetime", async () => {
    const { api, lease } = keeper();
    expect(await lease.acquire(false)).toBe("held");
    expect(lease.id()).toBeUndefined();
    expect(await lease.acquire(true)).toBe("acquired");
    expect(lease.id()).toBe(LEASE.leaseId);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.renewLease).toHaveBeenCalledTimes(2);
  });

  it("keeps the game rules its acquire granted (GS2); older servers and malformed grants grant none", async () => {
    const { lease } = keeper();
    expect(lease.gameRules()).toBeUndefined();
    await lease.acquire(true);
    expect(lease.gameRules()).toBeUndefined();
    const offline = { ...DEFAULT_ONLINE_SETTINGS, connectivity: "offline" as const };
    expect(grantedSimRules({ gameSettings: { revision: "rev-1", settings: offline } }))
      .toEqual(toSimRules(offline, "rev-1"));
    expect(grantedSimRules({ gameSettings: { revision: "legacy", settings: DEFAULT_ONLINE_SETTINGS } }))
      .toEqual(LEGACY_SIM_RULES);
    expect(grantedSimRules({ gameSettings: { revision: "rev-2", settings: { version: 1 } as never } }))
      .toBeUndefined();
  });

  it("reports a lost lease once, retries a failed heartbeat and releases with keepalive", async () => {
    const { api, lease, onLost } = keeper(new TypeError("offline"), { ok: false, reason: "lost" });
    await lease.acquire(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(lease.id()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.renewLease).toHaveBeenCalledTimes(2);
    await lease.acquire(true);
    await lease.release(true);
    expect(api.releaseLease).toHaveBeenCalledWith(LEASE.leaseId, true);
  });

  it("verifies the tab-return lease: current, taken over, or unreadable", async () => {
    const { lease, onLost } = keeper(new TypeError("offline"), { ok: false, reason: "lost" });
    await lease.acquire(true);
    expect(await lease.verify()).toBe("unknown");
    expect(lease.id()).toBe(LEASE.leaseId);
    expect(onLost).not.toHaveBeenCalled();
    expect(await lease.verify()).toBe("lost");
    expect(lease.id()).toBeUndefined();
    expect(onLost).toHaveBeenCalledTimes(1);
    const current = keeper();
    await current.lease.acquire(true);
    expect(await current.lease.verify()).toBe("current");
    expect(current.onLost).not.toHaveBeenCalled();
  });
});

describe("cloud session start", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** The save API of the account: its slots, lease answers and the snapshot of slot 1. */
  const serve = (options: { held?: boolean; slots?: unknown[]; snapshot?: GameSaveV1 | null } = {}) => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const path = `${init.method} ${url.slice(API.length)}`;
      requests.push(path);
      if (path === "GET /v1/saves") return json(options.slots ?? [SLOT]);
      if (path === "POST /v1/saves") return json(SLOT, 201);
      if (path === "GET /v1/economy/wallet") return json({ gems: 42 });
      if (path === "POST /v1/session-lease") {
        const takeOver = (JSON.parse(init.body as string) as { takeOver: boolean }).takeOver;
        return options.held && !takeOver ? json({ code: "SESSION_LEASE_HELD" }, 409) : json(LEASE);
      }
      const snapshot = options.snapshot === null ? { adventures: [], colonies: [], evacuations: [], islands: [],
        player: {}, session: {} } : toSaveSnapshot(options.snapshot ?? completeGame());
      return json({ ...snapshot, revision: 3 });
    }));
    return requests;
  };
  /** A scroll that answers each question with the choice whose label matches. */
  const answering = (...labels: RegExp[]) => {
    const asked: string[] = [];
    const scroll = { close: vi.fn(), show: (page: ScrollPage) => {
      if (page.kind !== "choices") throw new Error(`Unexpected page ${page.kind}`);
      asked.push(page.title);
      const label = labels.shift()!;
      void page.choices.find(choice => label.test(choice.label))!.onSelect();
    } } as unknown as AccountScroll;
    return { asked, openScroll: () => scroll };
  };
  const player = { account: { displayName: "Livia", id: "a1", nation: "roman", role: "player" },
    backend: { apiUrl: API, identityUrl: "http://127.0.0.1:3001" },
    identity: { accessToken: async () => "token", renew: async () => null } } as unknown as PlayerAccount;
  const start = (scroll: ReturnType<typeof answering>, tabStorage = createMemoryStorage(),
    database = openLocalStorageGame(createMemoryStorage())) =>
    startCloudSession({ database, openScroll: scroll.openScroll, player, tabStorage });

  it("asks for a slot, creates an empty one, and starts from its snapshot", async () => {
    const requests = serve({ slots: [], snapshot: null });
    const scroll = answering(/^Slot 1: empty/), tab = createMemoryStorage();
    const cloud = await start(scroll, tab);
    expect(scroll.asked).toEqual(["Choose a save slot"]);
    expect(requests.slice(0, 2)).toEqual(["GET /v1/saves", "POST /v1/saves"]);
    expect(cloud?.initialGame).toBeNull();
    expect(cloud?.slot.id).toBe(SLOT.id);
    expect(tab.getItem("island-settlers.cloud-slot")).toBe(SLOT.id);
    cloud?.lease.release();
  });

  it("continues the tab's slot without asking, and takes the session over when the player agrees", async () => {
    serve({ held: true });
    const scroll = answering(/^Take over here/), tab = createMemoryStorage({ "island-settlers.cloud-slot": SLOT.id });
    const cloud = await start(scroll, tab);
    expect(scroll.asked).toEqual(["Playing on another device"]);
    expect(cloud?.lease.id()).toBe(LEASE.leaseId);
    expect(cloud?.initialGame).toEqual(completeGame());
    cloud?.lease.release();
    serve({ held: true });
    expect(await start(answering(/^Play as guest/), tab)).toBeNull();
  });

  it("offers the newer unsent local copy and starts from it when kept", async () => {
    serve();
    const database = openLocalStorageGame(createMemoryStorage());
    const unsent = { ...completeGame(), savedAt: 999 };
    await database.writeGame(recoverySlotId("a1", SLOT.id), unsent);
    const tab = createMemoryStorage({ "island-settlers.cloud-slot": SLOT.id });
    const kept = await start(answering(/^Continue the local save/), tab, database);
    expect(kept?.initialGame).toEqual(unsent);
    expect(kept?.restored).toBe(true);
    kept?.lease.release();
    kept?.markHandoff();
    const handedOff = await start(answering(), tab, database);
    expect(handedOff?.initialGame).toEqual(unsent);
    handedOff?.lease.release();
    const online = await start(answering(/^Load the online save/), tab, database);
    expect(online?.initialGame).toEqual(completeGame());
    expect(await database.hasGame(recoverySlotId("a1", SLOT.id))).toBe(false);
    online?.lease.release();
  });
});

describe("server full", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  /** A scroll that records the pages and answers the queue page only when `leave` is set. */
  const queueScroll = (leave: boolean) => {
    const pages: { lead: string; title: string }[] = [];
    const scroll = { show: (page: ScrollPage) => {
      if (page.kind !== "choices") throw new Error(page.kind);
      pages.push({ lead: page.lead, title: page.title });
      if (leave) void page.choices[0]!.onSelect();
    } } as unknown as AccountScroll;
    return { openScroll: () => scroll, pages };
  };
  const fullServer = (fullAnswers: number) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const path = `${init.method} ${url.slice(API.length)}`;
      if (path === "GET /v1/saves") return json([SLOT]);
      if (path === "GET /v1/economy/wallet") return json({ gems: 7 });
      if (path === "POST /v1/session-lease" && fullAnswers-- > 0)
        return json({ active: 2, capacity: 2, code: "SERVER_FULL", position: 1 }, 503);
      if (path === "POST /v1/session-lease") return json(LEASE);
      return json({ ...toSaveSnapshot(completeGame()), revision: 3 });
    }));
  };
  const startQueued = (scroll: ReturnType<typeof queueScroll>) => startCloudSession({
    database: openLocalStorageGame(createMemoryStorage()), openScroll: scroll.openScroll,
    player: { account: { displayName: "Livia", id: "a1", nation: "roman", role: "player" },
      backend: { apiUrl: API, identityUrl: "http://127.0.0.1:3001" },
      identity: { accessToken: async () => "token", renew: async () => null } } as unknown as PlayerAccount,
    tabStorage: createMemoryStorage({ "island-settlers.cloud-slot": SLOT.id }) });

  it("shows the queue place and retries until a seat is free", async () => {
    vi.useFakeTimers();
    fullServer(2);
    const scroll = queueScroll(false);
    const starting = startQueued(scroll);
    await vi.advanceTimersByTimeAsync(0);
    expect(scroll.pages).toEqual([{ lead: "Server is full (2/2), you are #1 in the queue.", title: "Server is full" }]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(scroll.pages).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(15_000);
    const cloud = await starting;
    expect(cloud?.lease.id()).toBe(LEASE.leaseId);
    cloud?.lease.release();
  });

  it("lets the player keep playing offline as guest", async () => {
    fullServer(1);
    expect(await startQueued(queueScroll(true))).toBeNull();
  });
});

describe("cloud helpers", () => {
  it("describes the slots and the status line", () => {
    expect(describeSlot(2, undefined)).toBe("Slot 2: empty, start a new island");
    expect(describeSlot(1, { ...SLOT, revision: 0 })).toBe("Slot 1: Slot 1 (no island yet)");
    expect(describeSlot(1, SLOT)).toBe("Slot 1: Slot 1");
    expect(getCloudStatusView(null, 0)).toBeNull();
    expect(getCloudStatusView({ at: 1, kind: "saved" }, 2)).toEqual({ text: "Saved online", warning: false });
    expect(getCloudStatusView({ kind: "offline", retryAt: 5000 }, 1000))
      .toEqual({ text: "Offline: saved in this browser, retrying in 4 s", warning: true });
    expect(getCloudStatusView({ kind: "conflict" }, 0)?.warning).toBe(true);
  });

  it("shows the verified revision, a pending save and a flag beside the save line", () => {
    const state = { flag: null, flaggedAt: null, revision: 3, pending: true, verifiedRevision: 2 };
    expect(getVerificationView(null)).toBeNull();
    expect(getVerificationView({ ...state, revision: 0 })).toBeNull();
    expect(getVerificationView(state)).toEqual({ text: "verification pending" });
    expect(getVerificationView({ ...state, pending: false, verifiedRevision: 3 }))
      .toEqual({ text: "verified" });
    expect(getVerificationView({ ...state, flag: { plausibility: {} } }))
      .toEqual({ text: "verification flagged" });
    expect(getVerificationView({ ...state, pending: true, verifiedRevision: null }))
      .toEqual({ text: "not verified" });
  });
});

describe("cloud session exit", () => {
  it("ends the slot and releases the lease without waiting for pagehide", async () => {
    const release = vi.fn(async () => undefined), forgetSlot = vi.fn(), markExited = vi.fn(), stop = vi.fn();
    const verificationStop = vi.fn();
    await endCloudSession({ forgetSlot, lease: { release }, markExited, store: { stop },
      verification: { stop: verificationStop } } as unknown as CloudSession);
    expect(markExited).toHaveBeenCalledTimes(1);
    expect(forgetSlot).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(verificationStop).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("cloud session in play", () => {
  const session = () => {
    const status = createExternalStore<CloudSaveStatus | null>(null), lost = createExternalStore(false);
    const lease = { acquire: vi.fn(async () => "acquired" as const), release: vi.fn(async () => undefined) };
    const store = { overwrite: vi.fn(async () => undefined), resume: vi.fn(), revision: () => 3 };
    const verification = createVerificationStatus({ api: { readVerification: async () => ({ flag: null,
      flaggedAt: null, randomTrailRequest: null, verifiedRevision: 3 }) }, retryDelays: [0], revision: () => 3,
    slotId: SLOT.id });
    const economy = { onLevelClaim: vi.fn(() => () => undefined) };
    const discard = vi.fn(async () => undefined);
    const cloud = { discardUnsent: discard, economy, lease, lost, markHandoff: vi.fn(),
      restored: true, status, store, verification } as unknown as CloudSession;
    const saving = { flush: vi.fn(async () => true), request: vi.fn(), stop: vi.fn() };
    const popups: SettlementPopupContent[] = [], page = new EventTarget(), leave = vi.fn(), reload = vi.fn();
    const releaseSession = vi.fn(async () => undefined), saveStatus = createSaveStatus();
    const settle = vi.fn(async () => undefined);
    const unbind = bindCloudSession({ cloud, leave, mountStatus: async () => () => undefined,
      page: page as unknown as Window, reload, releaseSession, saveStatus, saving, settle,
      showPopup: content => popups.push(content), viewport: {} as HTMLElement });
    return { cloud, discard, economy, lease, leave, page, popups, reload, releaseSession, saveStatus, saving, settle,
      status, store, unbind, verification };
  };
  const choose = async (popup: SettlementPopupContent, label: RegExp) => {
    popup.actions.find(action => label.test(action.label))!.onSelect!();
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  it("uploads a restored local save soon and releases the lease when the tab closes", () => {
    const { cloud, lease, page, saving, unbind } = session();
    expect(saving.request).toHaveBeenCalledTimes(1);
    page.dispatchEvent(new Event("pagehide"));
    expect(lease.release).toHaveBeenCalledWith(true);
    expect(cloud.markHandoff).toHaveBeenCalled();
    unbind();
  });

  it("asks on a conflict: load the newer save, or keep playing here and overwrite", async () => {
    const { discard, popups, releaseSession, reload, saveStatus, saving, settle, status, store } = session();
    status.set({ at: 1, kind: "saved" });
    expect(saveStatus.getSnapshot().cloud).toEqual({ at: 1, kind: "saved" });
    expect(popups).toHaveLength(0);
    status.set({ kind: "conflict" });
    expect(popups[0]!.title).toBe("This save changed on another device");
    await choose(popups[0]!, /overwrite/);
    expect(store.overwrite).toHaveBeenCalled();
    const order: string[] = [];
    settle.mockImplementation(async () => { order.push("settle"); });
    discard.mockImplementation(async () => { order.push("discard"); });
    await choose(popups[0]!, /newer/);
    expect(order).toEqual(["settle", "discard"]);
    expect(saving.stop).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    // Loading the newer save stays in the same slot: the account lease is not released for the handoff.
    expect(releaseSession).not.toHaveBeenCalled();
  });

  it("asks when another device took the session: take it back, or leave", async () => {
    const { cloud, lease, leave, popups, releaseSession, saving, status, store } = session();
    cloud.lost.set(true);
    expect(status.getSnapshot()).toEqual({ kind: "taken-over" });
    expect(popups[0]!.title).toBe("Playing on another device");
    await choose(popups.at(-1)!, /back/);
    expect(lease.acquire).toHaveBeenCalledWith(true);
    expect(store.resume).toHaveBeenCalled();
    expect(saving.flush).toHaveBeenCalledWith("manual");
    await choose(popups.at(-1)!, /Leave/);
    expect(saving.stop).toHaveBeenCalled();
    expect(releaseSession).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalled();
  });

  it("does not release the slot on an ordinary hide, and drops its pagehide owner when unbound", () => {
    const { lease, page, releaseSession, unbind } = session();
    page.dispatchEvent(new Event("visibilitychange"));
    expect(releaseSession).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled();
    unbind();
    page.dispatchEvent(new Event("pagehide"));
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("keeps the lease for back/forward-cache restoration", () => {
    const { cloud, lease, page, unbind } = session();
    page.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
    expect(lease.release).not.toHaveBeenCalled();
    expect(cloud.markHandoff).not.toHaveBeenCalled();
    unbind();
  });

  it("releases the island cloud UI before rebinding to the next settlement", async () => {
    const { cloud, lease, page, popups, status, unbind } = session();
    const lifecycle = createSessionLifecycle();
    lifecycle.retainIsland(unbind);
    lifecycle.disposeIsland();
    const nextPopups: SettlementPopupContent[] = [];
    const unmount = vi.fn();
    const unbindNext = bindCloudSession({ cloud, leave: vi.fn(), mountStatus: async () => unmount,
      page: page as unknown as Window, reload: vi.fn(), saveStatus: createSaveStatus(),
      saving: { flush: async () => true, request: () => undefined, stop: () => undefined },
      showPopup: content => nextPopups.push(content), viewport: {} as HTMLElement });
    status.set({ kind: "conflict" });
    expect(popups).toEqual([]);
    expect(nextPopups).toHaveLength(1);
    page.dispatchEvent(new Event("pagehide"));
    expect(lease.release).toHaveBeenCalledOnce();
    unbindNext();
    await Promise.resolve();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it("ignores a boot verification that completes after its island binding is disposed", async () => {
    const { cloud, page, unbind } = session();
    unbind();
    let finish: () => void = () => undefined;
    vi.spyOn(cloud.verification, "check").mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ flag: null, flaggedAt: null, pending: false, revision: 3, verifiedRevision: 3 });
    }));
    const claim = vi.fn();
    const dispose = bindCloudSession({ cloud, leave: vi.fn(), mountStatus: async () => () => undefined,
      page: page as unknown as Window, player: { claimServerLevel: claim, level: () => 12 },
      reload: vi.fn(), saveStatus: createSaveStatus(),
      saving: { flush: async () => true, request: () => undefined, stop: () => undefined },
      showPopup: vi.fn(), viewport: {} as HTMLElement });
    dispose();
    finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(claim).not.toHaveBeenCalled();
  });

  it("re-claims the level once after a saved upload verifies, and not on repeated status checks", async () => {
    const status = createExternalStore<CloudSaveStatus | null>(null), lost = createExternalStore(false);
    const claimListeners = new Set<(claim: LevelClaim) => void>();
    let verifiedRevision = 2, reads = 0;
    const verification = createVerificationStatus({
      api: { readVerification: async () => {
        reads++;
        return { flag: null, flaggedAt: null, randomTrailRequest: null, verifiedRevision };
      } }, retryDelays: [0], revision: () => 3, slotId: SLOT.id
    });
    const claim = vi.fn((level: number) => {
      for (const listener of claimListeners) listener({ claimedLevel: level, level: 2, paid: [], verifiedLevel: 2,
        wallet: { gems: 0 } });
    });
    const cloud = { discardUnsent: vi.fn(async () => undefined),
      economy: { onLevelClaim: (listener: (claim: LevelClaim) => void) => {
        claimListeners.add(listener);
        return () => claimListeners.delete(listener);
      } },
      lease: { acquire: vi.fn(async () => "acquired" as const), release: vi.fn(async () => undefined) }, lost,
      markHandoff: vi.fn(), restored: false, status,
      store: { overwrite: vi.fn(async () => undefined), resume: vi.fn() }, verification } as unknown as CloudSession;
    const saving = { flush: vi.fn(async () => true), request: vi.fn(), stop: vi.fn() };
    const unbind = bindCloudSession({ cloud, leave: vi.fn(), mountStatus: async () => () => undefined,
      page: new EventTarget() as unknown as Window, player: { claimServerLevel: () => claim(12), level: () => 12 },
      reload: vi.fn(), saveStatus: createSaveStatus(), saving, showPopup: vi.fn(), viewport: {} as HTMLElement });
    await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(reads).toBe(2));
    verifiedRevision = 3;
    status.set({ at: 1, kind: "saved" });
    await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(reads).toBe(4));
    status.set({ at: 2, kind: "saved" });
    await vi.waitFor(() => expect(reads).toBe(5));
    expect(claim).toHaveBeenCalledTimes(2);
    unbind();
  });

  it("does not re-claim a level the boot claim already paid in full", async () => {
    const status = createExternalStore<CloudSaveStatus | null>(null), lost = createExternalStore(false);
    const claimListeners = new Set<(claim: LevelClaim) => void>();
    let verifiedRevision = 2, reads = 0;
    const verification = createVerificationStatus({
      api: { readVerification: async () => {
        reads++;
        return { flag: null, flaggedAt: null, randomTrailRequest: null, verifiedRevision };
      } }, retryDelays: [0], revision: () => 3, slotId: SLOT.id
    });
    const claim = vi.fn((level: number) => {
      for (const listener of claimListeners) listener({ claimedLevel: level, level, paid: [], verifiedLevel: level,
        wallet: { gems: 0 } });
    });
    const cloud = { discardUnsent: vi.fn(async () => undefined),
      economy: { onLevelClaim: (listener: (claim: LevelClaim) => void) => {
        claimListeners.add(listener);
        return () => claimListeners.delete(listener);
      } },
      lease: { acquire: vi.fn(async () => "acquired" as const), release: vi.fn(async () => undefined) }, lost,
      markHandoff: vi.fn(), restored: false, status,
      store: { overwrite: vi.fn(async () => undefined), resume: vi.fn() }, verification } as unknown as CloudSession;
    const saving = { flush: vi.fn(async () => true), request: vi.fn(), stop: vi.fn() };
    const unbind = bindCloudSession({ cloud, leave: vi.fn(), mountStatus: async () => () => undefined,
      page: new EventTarget() as unknown as Window, player: { claimServerLevel: () => claim(12), level: () => 12 },
      reload: vi.fn(), saveStatus: createSaveStatus(), saving, showPopup: vi.fn(), viewport: {} as HTMLElement });
    await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(reads).toBe(2));
    verifiedRevision = 3;
    status.set({ at: 1, kind: "saved" });
    await vi.waitFor(() => expect(reads).toBe(3));
    expect(claim).toHaveBeenCalledTimes(1);
    unbind();
  });
});

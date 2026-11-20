import { afterEach, describe, expect, it, vi } from "vitest";

import { createSeasonalAppearanceStore } from "../src/app/settings/seasonal-appearance/store";

const response = (globalWinter: boolean) => new Response(JSON.stringify({ globalWinter }));
const backend = { apiUrl: "https://api.example.test" };
const stores: ReturnType<typeof createSeasonalAppearanceStore>[] = [];
const createStore = (options: Parameters<typeof createSeasonalAppearanceStore>[0] = {}) => {
  const store = createSeasonalAppearanceStore(options);
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("global seasonal appearance", () => {
  it("starts standalone without requests and remembers the player's local opt-out", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    const fetch = vi.fn(), store = createStore({ fetch });
    expect(store.getSnapshot()).toMatchObject({
      globalWinter: false, ignoreGlobalWinter: false, online: false, season: { fixedSeason: "summer", mode: "none" },
      winterActive: false
    });
    await store.start(null);
    store.setIgnoreGlobalWinter(true);
    expect(createStore().getSnapshot().ignoreGlobalWinter).toBe(true);
    store.setIgnoreGlobalWinter(false);
    expect(createStore().getSnapshot().ignoreGlobalWinter).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies global winter while preserving a local opt-out and stable unchanged snapshots", async () => {
    const fetch = vi.fn().mockResolvedValue(response(true)), store = createStore({ fetch });
    await store.start(backend);
    expect(store.getSnapshot().winterActive).toBe(true);
    const changed = vi.fn();
    store.subscribe(changed);
    const before = store.getSnapshot();
    fetch.mockResolvedValue(response(true));
    await store.refresh();
    expect(store.getSnapshot()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    store.setIgnoreGlobalWinter(true);
    expect(store.getSnapshot()).toMatchObject({ globalWinter: true, winterActive: false });
    store.setIgnoreGlobalWinter(false);
    expect(store.getSnapshot().winterActive).toBe(true);
    fetch.mockResolvedValue(new Response("offline", { status: 503 }));
    expect(await store.refresh()).toBe(false);
    expect(store.getSnapshot().globalWinter).toBe(true);
    expect(fetch.mock.calls[0]).toMatchObject([
      "https://api.example.test/v1/appearance", { cache: "no-store", credentials: "omit" }
    ]);
  });

  it("polls only visible pages, refreshes on return, and removes its lifecycle on disposal", async () => {
    vi.useFakeTimers();
    const document = new EventTarget() as Document;
    let visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { get: () => visibilityState });
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response(true)));
    const store = createStore({ document, fetch });
    await store.start(backend);
    expect(fetch).toHaveBeenCalledTimes(1);
    visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    store.dispose();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("accepts authenticated changes immediately and ignores an older public read", async () => {
    let resolveRead: ((response: Response) => void) | undefined;
    const fetch = vi.fn().mockImplementation((_input, init) => {
      if (init?.method === "PUT") return Promise.resolve(response(true));
      return new Promise<Response>(resolve => { resolveRead = resolve; });
    });
    const store = createStore({ fetch });
    const started = store.start({ ...backend, getAccessToken: async () => "admin-token" });
    await store.setGlobalWinter(true);
    expect(store.getSnapshot().winterActive).toBe(true);
    resolveRead?.(response(false));
    expect(await started).toBe(false);
    expect(store.getSnapshot().globalWinter).toBe(true);
    expect(fetch.mock.calls[1]).toMatchObject([
      "https://api.example.test/v1/debug/appearance",
      { body: '{"globalWinter":true}', headers: { Authorization: "Bearer admin-token" }, method: "PUT" }
    ]);
  });

  it("retains accepted state after a rejected write and rejects malformed public data", async () => {
    const fetch = vi.fn().mockImplementation((_input, init) => {
      if (init?.method === "PUT") return Promise.resolve(new Response("{}", { status: 403 }));
      return Promise.resolve(response(false));
    });
    const store = createStore({ fetch });
    await store.start({ ...backend, getAccessToken: async () => "player-token" });
    await expect(store.setGlobalWinter(true)).rejects.toMatchObject({ status: 403 });
    expect(store.getSnapshot().globalWinter).toBe(false);
    fetch.mockResolvedValue(new Response('{"globalWinter":"true"}'));
    expect(await store.refresh()).toBe(false);
    expect(store.getSnapshot().globalWinter).toBe(false);
  });

  it("deduplicates refreshes and discards responses after disposal or reconfiguration", async () => {
    let resolveRead: ((response: Response) => void) | undefined;
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { resolveRead = resolve; }));
    const store = createStore({ fetch });
    const started = store.start(backend);
    expect(store.refresh()).toBe(started);
    await store.start(null);
    resolveRead?.(response(true));
    expect(await started).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ globalWinter: false, online: false, winterActive: false });
  });
});

import { describe, expect, it, vi } from "vitest";

import { createIslandHandoff, type IslandDestination } from "../src/app/island-handoff";
import { createIslandHandoffStore } from "../src/app/island-handoff-store";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { addAdventureRecord, type Archipelago,emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMemorySaveStore } from "./memory-save-store";

const islands = adventureOffers(3);
const capture = () => ({ format: "island-settlers-game", map: "island", settlement: {} }) as unknown as GameSaveV1;

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

/** Home plus two filed adventures; the first is on screen and can sail home to either destination. */
const group = () => ({
  ...addAdventureRecord(addAdventureRecord(emptyArchipelago(), 7, islands[0]!, {
    crew: 0, landed: {}, troops: []
  }), 8, islands[1]!, { crew: 0, landed: {}, troops: [] }),
  active: 7,
  home: { format: "island-settlers-game", map: "home" } as unknown as GameSaveV1
});

const simulation = {
  adventure: () => undefined,
  buildings: () => [],
  colony: () => undefined,
  colonyExpeditions: () => [],
  frames: () => [],
  gameNow: () => Date.UTC(2026, 9, 24),
  militaryBuildings: () => [],
  militarySoldiers: () => [],
  releaseColony: () => true,
  saveState: () => ({}),
  sendVisitorShip: () => null,
  talentModifiers: () => ({ shippingTimeReduction: 0 }),
  update: () => undefined
} as unknown as SettlementSimulation;

const session = (options: {
  capture?: () => Promise<GameSaveV1>;
  initial?: Archipelago;
  inPage?: boolean;
  claimAdventure?: (island: typeof islands[number], bonus: number) => Promise<Record<string, number> | string>;
  handoff?: (request: import("../src/app/island-handoff").IslandHandoffRequest) =>
    Promise<import("../src/app/island-handoff").IslandHandoffResult<unknown, unknown>>;
  reload?: () => Promise<void>;
  settle?: () => Promise<void>;
  store?: ReturnType<typeof createMemorySaveStore>["store"];
} = {}) => {
  const memory = createMemorySaveStore(), messages: string[] = [];
  const transition = createSessionLifecycle(), reload = vi.fn(options.reload ?? (async () => undefined));
  const persistence = createIslandHandoffStore(options.store ?? memory.store);
  const prepare = vi.fn(async (destination: IslandDestination) => destination);
  const handoff = createIslandHandoff({
    captureDeparture: async () => capture(),
    commitDestination: async destination => {
      if (destination.kind !== "saved") throw new Error("Expected saved destination");
      await persistence.commit(destination.payload);
    },
    complete: persistence.complete,
    current: () => ({ id: "old" }), dispose: () => undefined,
    install: async () => ({ id: "new" }), matches: () => true, prepare,
    transition, writeDeparture: persistence.writeDeparture
  });
  const handleHandoff = vi.fn(options.handoff ?? handoff.replace);
  const travel = createArchipelagoSession({
    claimAdventure: options.claimAdventure,
    capture: options.capture ?? (async () => capture()),
    handoff: options.inPage || options.handoff ? handleHandoff : undefined,
    initial: options.initial ?? group(),
    notify: text => messages.push(text),
    reload,
    settle: options.settle,
    simulation,
    store: options.store ?? memory.store,
    transition
  });
  return { handoff: handleHandoff, memory, messages, prepare, reload, transition, travel };
};

describe("island travel transitions", () => {
  it("freezes before settling/capturing and coalesces travel throughout a slow capture", async () => {
    const gate = deferred<GameSaveV1>();
    const order: string[] = [];
    const initial = group();
    initial.adventures![1]!.save = capture();
    const state = session({
      capture: () => {
        expect(state.transition.frozen()).toBe(true);
        order.push("capture");
        return gate.promise;
      },
      initial, inPage: true,
      settle: async () => { expect(state.transition.frozen()).toBe(true); order.push("settle"); }
    });
    const first = state.travel.returnHome();
    const repeated = state.travel.returnHome();
    expect(state.transition.frozen()).toBe(true);
    expect(await state.travel.visit(8)).toBe(false);
    gate.resolve(capture());
    expect(await first).toBe(true);
    expect(await repeated).toBe(true);
    expect(order).toEqual(["settle", "capture"]);
    expect(state.prepare).toHaveBeenCalledOnce();
    expect(state.transition.frozen()).toBe(false);
  });

  it("discards an in-page capture invalidated by a newer generation", async () => {
    const gate = deferred<GameSaveV1>(), capturing = deferred<void>();
    const state = session({ inPage: true, capture: () => { capturing.resolve(); return gate.promise; } });
    const pending = state.travel.returnHome();
    await capturing.promise;
    state.transition.activateSession();
    gate.resolve(capture());
    expect(await pending).toBe(false);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.memory.games).toEqual([]);
  });

  it("settles a won adventure's reward and survivors before an in-page return", async () => {
    const initial = group();
    initial.adventures![0]!.status = "won";
    const claimAdventure = vi.fn(async () => ({ coins: 50 }));
    const state = session({
      capture: async () => ({ ...capture(), settlement: { military: {
        soldiers: [{ rank: 2, combat: { faction: 0, hp: 7, type: "shield" } }]
      } } }) as unknown as GameSaveV1,
      claimAdventure, initial, inPage: true
    });
    expect(await state.travel.returnHome()).toBe(true);
    const destination = state.prepare.mock.calls[0]![0];
    expect(destination.kind).toBe("saved");
    if (destination.kind !== "saved") throw new Error("Expected saved destination");
    expect(destination.payload.archipelago).toMatchObject({
      released: [7], returning: [{ hp: 7, rank: 2, type: "shield" }], rewards: { coins: 50 }
    });
    expect(destination.payload.archipelago!.adventures!.map(record => record.expeditionId)).toEqual([8]);
    expect(claimAdventure).toHaveBeenCalledOnce();
  });

  it("keeps the won adventure active if its reward claim cannot reach the server", async () => {
    const initial = group();
    initial.adventures![0]!.status = "won";
    const state = session({ initial, inPage: true,
      claimAdventure: async () => { throw new Error("offline"); } });
    expect(await state.travel.returnHome()).toBe(false);
    expect(state.travel.active()).toBe(7);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.memory.games).toEqual([]);
    expect(state.reload).not.toHaveBeenCalled();
    expect(state.transition.frozen()).toBe(false);
  });

  it("removes a defeated adventure on return without claiming a victory reward", async () => {
    const initial = group();
    initial.adventures![0]!.status = "defeated";
    const claimAdventure = vi.fn(async () => ({ coins: 50 }));
    const state = session({ claimAdventure, initial, inPage: true });
    expect(await state.travel.returnHome()).toBe(true);
    const destination = state.prepare.mock.calls[0]![0];
    if (destination.kind !== "saved") throw new Error("Expected saved destination");
    expect(destination.payload.archipelago!.adventures!.map(record => record.expeditionId)).toEqual([8]);
    expect(destination.payload.archipelago!.rewards).toBeUndefined();
    expect(claimAdventure).not.toHaveBeenCalled();
  });

  it("uses the in-page handoff for the home trip and does not reload", async () => {
    const { handoff, memory, prepare, reload, travel } = session({ inPage: true });
    expect(await travel.returnHome()).toBe(true);
    expect(handoff).toHaveBeenCalledOnce();
    expect(handoff.mock.calls[0]![0]).toMatchObject({ key: "travel:home", trigger: "travel-home" });
    expect(prepare.mock.calls[0]![0]).toMatchObject({ kind: "saved", targetKey: "home" });
    expect(memory.games[0]).toMatchObject({ map: "island" });
    expect(reload).not.toHaveBeenCalled();
    expect(memory.values.get("startup")).toBeUndefined();
  });

  it("keeps the old island when the in-page handoff falls back without reloading", async () => {
    const handoff = vi.fn(async (_request: import("../src/app/island-handoff").IslandHandoffRequest) =>
      ({ ok: false as const, reason: "failed" as const }));
    const { messages, reload, travel } = session({ handoff });
    expect(await travel.returnHome()).toBe(false);
    expect(handoff).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatch(/could not be (completed|changed)|island is changing|failed/i);
  });

  it("uses the in-page handoff for a first visit and files the departure", async () => {
    const handoff = vi.fn(async (request: import("../src/app/island-handoff").IslandHandoffRequest) => {
      expect(request).toMatchObject({ key: "travel:8", trigger: "travel-first-visit" });
      if ("resolve" in request) {
        const plan = await request.resolve({ current: () => true } as never);
        expect(plan).toMatchObject({ saveDeparture: true });
        expect(plan.destination.kind).toBe("visit");
        expect(plan.departure?.format).toBe("island-settlers-game");
      }
      return { coalesced: false, ok: true as const, prepared: null, session: { id: "visit" } };
    });
    const { reload, travel } = session({ handoff });
    expect(await travel.visit(8)).toBe(true);
    expect(handoff).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("uses the in-page handoff for a saved island and files the departure", async () => {
    const initial = group();
    const saved = { ...initial, adventures: (initial.adventures ?? []).map(adventure =>
      adventure.expeditionId === 8 ? { ...adventure, save: capture() } : adventure) };
    const { handoff, memory, prepare, reload, travel } = session({ inPage: true, initial: saved });
    expect(await travel.visit(8)).toBe(true);
    expect(handoff).toHaveBeenCalledOnce();
    expect(handoff.mock.calls[0]![0]).toMatchObject({ key: "travel:8", trigger: "travel-saved-island" });
    expect(prepare.mock.calls[0]![0]).toMatchObject({ kind: "saved", targetKey: "island:8" });
    expect(memory.games[0]).toMatchObject({ map: "island" });
    expect(reload).not.toHaveBeenCalled();
  });

  it("coalesces the same destination and refuses a competing one", async () => {
    const gate = deferred<GameSaveV1>(), { messages, reload, travel } = session({
      capture: () => gate.promise
    });
    const home = travel.returnHome();
    const competing = travel.visit(8);
    expect(await competing).toBe(false);
    expect(messages.at(-1)).toMatch(/already under way/);
    gate.resolve(capture());
    expect(await home).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("discards a capture that arrives after a newer session generation", async () => {
    const gate = deferred<GameSaveV1>(), { memory, messages, reload, transition, travel } = session({
      capture: () => gate.promise
    });
    const home = travel.returnHome();
    transition.activateSession();
    gate.resolve(capture());
    expect(await home).toBe(false);
    expect(memory.values.get("startup")).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
    expect(transition.frozen()).toBe(false);
    expect(messages).toEqual([]);
  });

  it("settles an in-flight save before the departure capture and keeps the old session on failure", async () => {
    const memory = createMemorySaveStore(), order: string[] = [], messages: string[] = [];
    const failing = { ...memory.store, writeStartupGame: async () => { throw new Error("disk full"); } };
    const transition = createSessionLifecycle(), reload = vi.fn();
    const travel = createArchipelagoSession({
      capture: async () => { order.push("capture"); return capture(); },
      initial: group(),
      notify: text => messages.push(text),
      reload,
      settle: async () => { order.push("settle"); },
      simulation,
      store: failing,
      transition
    });
    expect(await travel.returnHome()).toBe(false);
    expect(order).toEqual(["settle", "capture"]);
    expect(memory.values.get("startup")).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
    expect(transition.frozen()).toBe(false);
    expect(transition.generation()).toBe(0);
    expect(messages.at(-1)).toBe("disk full");
  });
});

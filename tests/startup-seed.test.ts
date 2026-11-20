import { describe, expect, it, vi } from "vitest";

import { readAppParams } from "../src/app/app-params";
import type { SaveStore } from "../src/app/save-store/save-store";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

vi.stubGlobal("window", { addEventListener: () => undefined });
const { readPendingGame, savedHomeSeed } = await import("../src/app/startup-game");

const save = (seed: number | undefined, homeSeed?: number) => ({
  archipelago: homeSeed === undefined ? undefined : { active: 7, colonies: [], home: { settlement: { world: { seed: homeSeed } } } },
  settlement: { world: seed === undefined ? undefined : { seed } }
} as unknown as GameSaveV1);

const store = (saved: GameSaveV1 | null, startup: string | null = null) => ({
  readSavedGame: async () => saved,
  readStartupGame: async () => startup
} as unknown as SaveStore);

describe("seed-aware save continuation", () => {
  it("keeps the saved game when the URL seed names its home island", async () => {
    const game = save(42);
    const read = await readPendingGame(store(game), true, 42);
    expect(read).toMatchObject({ pendingGame: JSON.stringify(game), seedMismatch: false });
  });

  it("does not load the saved game when the URL seed differs", async () => {
    const read = await readPendingGame(store(save(42)), true, 43);
    expect(read.pendingGame).toBeNull();
    expect(read.seedMismatch).toBe(true);
  });

  it("lets an explicit startup game win even when its seed differs", async () => {
    const startup = JSON.stringify(save(7));
    const explicit = await readPendingGame(store(save(42), startup), true, 43);
    expect(explicit.pendingGame).toBe(startup);
  });

  it("still loads a legacy save without a recorded seed", async () => {
    const read = await readPendingGame(store(save(undefined)), true, 43);
    expect(read.pendingGame).not.toBeNull();
    expect(read.seedMismatch).toBe(false);
  });

  it("compares the archived home island seed while a colony is active", () => {
    expect(savedHomeSeed(save(7, 42))).toBe(42);
    expect(savedHomeSeed(save(7))).toBe(7);
  });

  it("marks only an explicit ?seed= as a seed launch", () => {
    expect(readAppParams("?seed=42")).toMatchObject({ seed: 42, seedFromUrl: true });
    expect(readAppParams("?quality=high")).toMatchObject({ seedFromUrl: false });
  });
});

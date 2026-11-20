import { describe, expect, it, vi } from "vitest";

import { createIslandHandoff } from "../src/app/island-handoff";
import { createIslandHandoffStore } from "../src/app/island-handoff-store";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createMemorySaveStore } from "./memory-save-store";

const saved = (savedAt: number) => ({ format: "island-settlers-game", savedAt }) as GameSaveV1;
const request = {
  destination: { kind: "saved" as const, payload: saved(2_000), targetKey: "home" },
  key: "travel:home", saveDeparture: true, trigger: "travel-home" as const
};

const setup = () => {
  const memory = createMemorySaveStore();
  const persistence = createIslandHandoffStore(memory.store);
  const transition = createSessionLifecycle();
  const install = vi.fn(async () => ({ id: "home" }));
  const prepare = vi.fn(async () => saved(2_000));
  const handoff = createIslandHandoff({
    captureDeparture: async () => saved(1_000), commitDestination: persistence.commit,
    complete: persistence.complete, current: () => ({ id: "old" }), dispose: () => undefined,
    install, matches: () => true, prepare, transition, writeDeparture: persistence.writeDeparture
  });
  return { handoff, install, memory, prepare, transition };
};

describe("durable island handoff", () => {
  it("clears the startup override after ready so later saves remain authoritative", async () => {
    const { handoff, install, memory } = setup();
    install.mockImplementation(async () => {
      expect(JSON.parse((await memory.store.readStartupGame())!).savedAt).toBe(2_000);
      return { id: "home" };
    });
    expect((await handoff.replace(request)).ok).toBe(true);
    await memory.store.writeSavedGame(saved(3_000));
    expect(await memory.store.readStartupGame()).toBeNull();
    expect((await memory.store.readSavedGame())!.savedAt).toBe(3_000);
  });

  it("leaves no departure startup override after preparation fails", async () => {
    const { handoff, memory, prepare, transition } = setup();
    prepare.mockRejectedValue(new Error("invalid destination"));
    expect(await handoff.replace(request)).toMatchObject({ ok: false, reason: "failed" });
    expect(await memory.store.readStartupGame()).toBeNull();
    expect((await memory.store.readSavedGame())!.savedAt).toBe(1_000);
    expect(transition.frozen()).toBe(false);
  });

  it("resumes the old island if the startup commit fails before changing the slot", async () => {
    const { handoff, install, memory, transition } = setup();
    const write = vi.spyOn(memory.store, "writeSavedGame");
    vi.spyOn(memory.store, "writeStartupGame").mockRejectedValue(new Error("disk full"));
    expect(await handoff.replace(request)).toMatchObject({ ok: false, reason: "failed" });
    expect(write).toHaveBeenCalledOnce(); // departure only
    expect(install).not.toHaveBeenCalled();
    expect(transition.frozen()).toBe(false);
  });

  it("reloads the staged destination if its slot write fails or is uncertain", async () => {
    const { handoff, install, memory, transition } = setup();
    const write = memory.store.writeSavedGame;
    vi.spyOn(memory.store, "writeSavedGame").mockImplementation(async save => {
      await write(save);
      if (save.savedAt === 2_000) throw new Error("confirmation lost");
    });
    expect(await handoff.replace(request)).toMatchObject({ ok: false, reason: "reload-required" });
    expect(transition.frozen()).toBe(true);
    expect(install).not.toHaveBeenCalled();
    expect(JSON.parse((await memory.store.readStartupGame())!).savedAt).toBe(2_000);
  });

  it("keeps the durable destination when install or startup cleanup fails", async () => {
    const { handoff, memory, transition } = setup();
    vi.spyOn(memory.store, "clearStartupGame").mockRejectedValue(new Error("cleanup failed"));
    expect(await handoff.replace(request)).toMatchObject({ ok: false, reason: "reload-required" });
    expect(transition.frozen()).toBe(true);
    expect(JSON.parse((await memory.store.readStartupGame())!).savedAt).toBe(2_000);
  });
});

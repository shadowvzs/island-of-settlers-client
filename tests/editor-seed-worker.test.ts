import { afterEach, describe, expect, it, vi } from "vitest";

import { regenerateSeedWorld } from "../src/app/map-editor/seed-generation-worker";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";

class SeedWorker {
  static instances: SeedWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault(): void; message: string }) => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { SeedWorker.instances.push(this); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); SeedWorker.instances = []; });

describe("independent editor seed worker lifecycle", () => {
  it("reports real phases, then releases its worker after the world reply", async () => {
    vi.stubGlobal("Worker", SeedWorker);
    const phase = vi.fn(), world = { seed: 1234 };
    const pending = regenerateSeedWorld(DEFAULT_WORLD_OPTIONS, { onPhase: phase });
    const worker = SeedWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith(DEFAULT_WORLD_OPTIONS);
    worker.onmessage!({ data: { phase: "Eroding and smoothing terrain" } });
    expect(phase).toHaveBeenCalledWith("Eroding and smoothing terrain");
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.onmessage!({ data: { world } });
    await expect(pending).resolves.toEqual(world);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("terminates native work and rejects cancellation without allocating another worker", async () => {
    vi.stubGlobal("Worker", SeedWorker);
    const request = new AbortController();
    const pending = regenerateSeedWorld(DEFAULT_WORLD_OPTIONS, { signal: request.signal });
    request.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(SeedWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
    await expect(regenerateSeedWorld(DEFAULT_WORLD_OPTIONS, { signal: request.signal })).rejects.toThrow("cancelled");
    expect(SeedWorker.instances).toHaveLength(1);
  });
  it("releases the worker and rejects a failed native generation reply", async () => {
    vi.stubGlobal("Worker", SeedWorker);
    const pending = regenerateSeedWorld(DEFAULT_WORLD_OPTIONS);
    const worker = SeedWorker.instances[0]!;
    worker.onmessage!({ data: { error: "Could not create valid islands" } });
    await expect(pending).rejects.toThrow("Could not create valid islands");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("settles a stalled worker at the declared bound and terminates it", async () => {
    vi.useFakeTimers(); vi.stubGlobal("Worker", SeedWorker);
    const pending = regenerateSeedWorld(DEFAULT_WORLD_OPTIONS);
    // Attach the rejection handler before triggering the worker; this promise is awaited below.
    // oxlint-disable-next-line vitest/valid-expect
    const rejected = expect(pending).rejects.toThrow("120-second bound");
    await vi.advanceTimersByTimeAsync(120000);
    await rejected;
    expect(SeedWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });

});

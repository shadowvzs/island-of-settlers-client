import type { FlyerAtlas } from "../render-common/flyers/flyer-atlas";
import { type LoadStage,recordStage } from "../render-common/load-profile";
import type { MaterialLayer } from "../render-common/materials/material-textures";
import type { PaintedTexture } from "../render-common/trees/atlas-canvas";
import type { ExpeditionIsland } from "../shared/settlement/settlement-colony-expeditions";
import type { WorldOptions } from "../shared/world/generation/generate-world";
import { TERRAIN_GENERATOR_VERSION } from "../shared/world/generation/generation-provenance";
import type { WorldData } from "../shared/world/world-data";
import type { WorkerRequest } from "../workers/world-worker";
import { type IslandCache,SHARED_GROUP } from "./island-cache";
import { type PackedWorkerValue,packWorkerValue, unpackWorkerValue } from "./packed-worker-cache";
import { createWorkerJobQueue } from "./worker-job-queue";

interface WorkerReply {
  /** Expected generation refusal; unrelated queued assets can still complete. */
  error?: string;
  /** Worker-side compute time (load profile). */
  ms: number;
  /** The worker's performance.timeOrigin: its stage starts are shifted onto the page clock. */
  origin: number;
  result: unknown;
  stages: LoadStage[];
}

/** Where a job's result is cached: the island group (or the shared one) and its key. */
export interface CacheSlot {
  group: string;
  key: string;
}

const recordWorkerStages = (label: string, sentAt: number, reply: WorkerReply) => {
  const shift = reply.origin - performance.timeOrigin;
  recordStage(`worker ${label}`, sentAt, reply.ms);
  for (const stage of reply.stages) {
    recordStage(`  worker ${stage.name}`, stage.start + shift, stage.duration);
  }
};

const createWorker = () =>
  new Worker(new URL("../workers/world-worker.ts", import.meta.url), { type: "module" });

/**
 * Pool of loading workers, started on demand (a fully cached island starts none): every job
 * goes to the next idle worker (a queue, so a long job never blocks a short one behind it).
 * World, textures and the heavy content builds run in parallel; results go through the cache.
 */
export const createWorkerPool = (size: number, cache: IslandCache) => {
  const jobs = createWorkerJobQueue<WorkerRequest, WorkerReply>({
    createWorker,
    onReply: recordWorkerStages,
    // Dev workers each fetch the source module graph; bundled production workers do not.
    size: import.meta.env.DEV ? Math.min(size, 2) : size,
    warmFirstWorker: import.meta.env.DEV
  });
  const run = async <T>(body: WorkerRequest, label: string, urgent = false) => {
    const reply = await jobs.run<WorkerReply>(body, label, urgent);
    if (reply.error) throw new Error(reply.error);
    return reply.result as T;
  };

  /** A job through the cache (a hit is a load stage of its own: its read time). */
  const runCached = async <T>(slot: CacheSlot, body: WorkerRequest, label: string = body.kind) => {
    const startedAt = performance.now();
    let computed = false;
    const result = await cache.cached(slot.group, slot.key, () => {
      computed = true;
      return run<T>(body, label);
    });
    if (!computed) recordStage(`cache hit ${label}`, startedAt, performance.now() - startedAt);
    return result;
  };

  const runPacked = async <T>(slot: CacheSlot, body: WorkerRequest, label: string = body.kind) => {
    const startedAt = performance.now();
    let computed = false;
    const packed = await cache.cached<PackedWorkerValue>(
      slot.group,
      `packed:${slot.key}`,
      async () => {
        computed = true;
        return packWorkerValue(await run<T>(body, label));
      }
    );
    const result = unpackWorkerValue<T>(packed);
    if (!computed) recordStage(`cache hit ${label}`, startedAt, performance.now() - startedAt);
    return result;
  };

  const shared = (key: string): CacheSlot => ({ group: SHARED_GROUP, key });

  return {
    invalidateJobs: jobs.invalidateJobs,
    runInBackground: jobs.runInBackground,
    keepAlive: jobs.keepAlive,
    disposeWhenIdle: jobs.disposeWhenIdle,
    stats: jobs.stats,
    /** Painted leaf sprays, needle sprays and palm fronds (a few seconds: start it first). */
    generateFoliage: (seed: number) =>
      runCached<PaintedTexture>(shared(`foliage ${seed} leaf-relief-v2`), { kind: "foliage", seed }),
    /** Bird feathers and butterfly wing variants. */
    generateFlyerAtlas: () => runCached<FlyerAtlas>(shared("flyer atlas"), { kind: "flyerAtlas" }),
    generateMaterial: (material: number, size: number, seed: number) =>
      runCached<MaterialLayer>(
        shared(`material ${material} ${size} ${seed} ground-relief-v2`),
        { kind: "material", material, seed, size },
        `material ${material}`
      ),
    /** Tileable stone detail of the cliff and boulder rocks. */
    generateRock: (seed: number) =>
      runCached<PaintedTexture>(shared(`rock ${seed}`), { kind: "rock", seed }),
    /**
     * A colony or adventure island's world (findExpeditionWorld: up to 24 candidates with a dry
     * run), cached like a generated world; null when no candidate hosts the island.
     */
    chartIsland: (island: ExpeditionIsland, group: string) =>
      runCached<WorldData | null>(
        { group, key: `world:${TERRAIN_GENERATOR_VERSION}` },
        { island, kind: "islandWorld" },
        "chart island"
      ),
    /** `island`: the cache group of this island (options, fog, garden). */
    generateWorld: (options: WorldOptions, island: string) =>
      runCached<WorldData>({ group: island, key: `world:${TERRAIN_GENERATOR_VERSION}:provenance-1` },
        { kind: "world", options }),
    runCached,
    runPacked,
    /** An uncached job in queue order (quick presentation bakes not worth an IndexedDB copy). */
    runUncached: <T>(body: WorkerRequest, label: string) => run<T>(body, label),
    /**
     * An uncached job ahead of the queue, also while background bakes run one at a time (map
     * editor rebuilds: the result belongs to one edit and the player waits for it).
     */
    runUrgent: <T>(body: WorkerRequest, label: string) => run<T>(body, label, true)
  };
};

export type WorkerPool = ReturnType<typeof createWorkerPool>;

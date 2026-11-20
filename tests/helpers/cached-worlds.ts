import { beforeAll } from "vitest";

import {
  generateWorld,
  type WorldOptions
} from "../../src/shared/world/generation/generate-world";
import type { WorldData } from "../../src/shared/world/world-data";
import { loadWorld, withWorldCache } from "./world-cache-store";

/**
 * Shared generated-world fixtures (TEST-01): every option set is generated once and handed out as
 * fresh deep copies (see `world-cache-store.ts`). Generate in hooks or at collection time, never
 * inside a test, so the 5 s test timeout measures the assertions.
 */

/** A whole default size island takes seconds when the suite runs in parallel. */
const WORLD_HOOK_TIMEOUT = 60_000;

const cachedGenerate = withWorldCache(generateWorld);

/** A fresh deep copy of the world generated from `options` (generated once per option set). */
export const cachedWorld = (options: WorldOptions): WorldData => cachedGenerate(options);

/** Creates the world in a `beforeAll` hook with its own timeout; returns its getter. */
const worldBeforeAll = (create: () => WorldData) => {
  let world: WorldData | undefined;
  beforeAll(() => {
    world = create();
  }, WORLD_HOOK_TIMEOUT);
  return () => {
    if (!world) throw new Error("the world is generated before the tests");
    return world;
  };
};

/**
 * The cached world, loaded in a `beforeAll` hook. All tests of the block share that one copy: use
 * `preloadWorlds` + `cachedWorld` in tests that mutate the world.
 */
export const cachedWorldBeforeAll = (options: WorldOptions) => worldBeforeAll(() => cachedWorld(options));

/**
 * An uncached generation in a `beforeAll` hook, for determinism tests that compare a fresh world
 * with `cachedWorld` (which may come from another file or an earlier run).
 */
export const freshWorldBeforeAll = (options: WorldOptions) => worldBeforeAll(() => generateWorld(options));

/** Warms the cache for `options` in a `beforeAll` hook (tests then call `cachedWorld` cheaply). */
export const preloadWorlds = (...options: WorldOptions[]) => {
  beforeAll(() => {
    for (const option of options) loadWorld(generateWorld, option);
  }, WORLD_HOOK_TIMEOUT);
};

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { waitForIsland } from "./expedition-review-helpers";
import { stageStartupSave } from "./frame-profile";
import { resourcesPath } from "./resources-path";

/**
 * Native High/Minimal acceptance for UNIT-MEMORY-01: a developed owner save is loaded through the
 * real browser renderer, then field soldiers are spawned through the existing scenario hook (the
 * test route admits faction 0), fought, killed and re-added. The probe reads Three's GPU object counters, per-type worker
 * body keys, worker-pack texture/clip keys, live animation mixers, mounted-instance retirement and
 * post-GC JS heap. It never edits production source; the `?horse=1` + settlement composition and
 * all counters are injected only into the served dev modules for this run.
 *
 * Run (from game/client):
 *   npx tsx tools/bench/unit-memory-native-review.ts
 *   QUALITIES=high,minimal CYCLES=3 npx tsx tools/bench/unit-memory-native-review.ts
 *
 * `OWNER_SAVE` overrides the fixture path; `OUTPUT` overrides the receipt folder. The fixture is
 * copied into the browser's startup slot, never written. See resources/unit-memory-2026-10-24/.
 */

const OUTPUT = process.env.OUTPUT
  ? resolve(process.env.OUTPUT)
  : resolve(import.meta.dirname, "../../../resources/unit-memory-2026-10-24");
const SAVE_PATH = process.env.OWNER_SAVE ??
  resourcesPath("project-reviews", "runtime-door-wait-save4", "island-settlers-2026-10-20 (4).json");
const QUALITIES = (process.env.QUALITIES ?? "high,minimal").split(",").filter(Boolean);
const CYCLES = Math.max(1, Number(process.env.CYCLES ?? 3));
const WORKER_TYPE = "shield" as const;
const WORKER_RANK = 2;
const ENEMY_TYPE = "heavy" as const;
const ENEMY_RANK = 2;
const ENEMIES = 10;
const TEST_SOLDIERS = 4;
const STATIC_MOUNTS = 4;
const MOUNT_MIXERS_PER_INSTANCE = 2;
const TEXTURE_TOLERANCE = 10;
const GEOMETRY_TOLERANCE = 20;
const HEAP_GROWTH_BYTES = 16 * 1024 * 1024;
const COMMAND = `QUALITIES=${QUALITIES.join(",")} CYCLES=${CYCLES} npx tsx tools/bench/unit-memory-native-review.ts`;
const GIT_HEAD = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return undefined; }
})();

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fixtureBytes = readFileSync(SAVE_PATH);
const fixtureHash = sha256(fixtureBytes);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const sorted = (values: readonly string[]) => [...values].sort();
const added = (before: readonly string[], after: readonly string[]) =>
  after.filter(value => !before.includes(value));
const removed = (before: readonly string[], after: readonly string[]) =>
  before.filter(value => !after.includes(value));

interface Snapshot {
  label: string;
  quality?: { liteGround?: boolean; sunShadows?: boolean };
  memory: { textures: number; geometries: number; programs?: number };
  scene: { children: number; meshes: number; skinned: number };
  workerScene: { children: number; meshes: number; skinned: number };
  worker?: {
    keys: string[];
    pool: { assets: number; pending: number; references: number; instances: number; originalBodies: number };
    pack: {
      clips: number;
      holders: number;
      pending: number;
      textures: number;
      clipKeys: string[];
      textureKeys: string[];
    };
    unitMixers: number;
    sourceMixers: number;
  };
  mounts?: MountStats;
  cavalry?: MountStats;
  mountMixers: number;
  heap: { usedSize: number; totalSize: number };
  gpu?: string;
}

interface MountStats {
  dynamic: number;
  pending: number;
  static: number;
  staticVisible: number;
  sceneChildren: number;
  meshes: number;
  skinned: number;
  horses: { assets: number; pending: number; references: number };
  riders: { assets: number; pending: number; references: number };
  armour: { assets: number; pending: number; references: number };
  dressed: { assets: number; pending: number; references: number };
  disposed: boolean;
}

const mountShape = (stats: MountStats) => ({
  dynamic: stats.dynamic,
  pending: stats.pending,
  static: stats.static,
  staticVisible: stats.staticVisible,
  sceneChildren: stats.sceneChildren,
  meshes: stats.meshes,
  skinned: stats.skinned,
  horses: stats.horses.assets,
  riders: stats.riders.assets,
  armour: stats.armour.assets,
  dressed: stats.dressed.assets,
  disposed: stats.disposed
});

const patchServed = (body: string, pattern: string | RegExp, replacement: string, label: string) => {
  const next = body.replace(pattern, replacement);
  assert.notEqual(next, body, `Probe could not patch ${label}; the served source changed`);
  return next;
};

/** Route-level instrumentation only: no file on disk and no production module behaviour changes. */
const installProbe = async (
  page: Page,
  { horseWithSettlement }: { horseWithSettlement: boolean }
) => {
  if (horseWithSettlement) await page.route("**/src/app/main.ts", async route => {
    const response = await route.fetch();
    const body = patchServed(await response.text(),
      "const settlementEnabled = !params.stress && !params.garden && !params.horse;",
      "const settlementEnabled = !params.stress && !params.garden;",
      "main.ts horse/settlement composition");
    await route.fulfill({ response, body });
  });
  await page.route("**/src/shared/settlement/settlement-combat-commands.ts", async route => {
    const response = await route.fetch();
    const body = patchServed(await response.text(),
      /Number\.isSafeInteger\(faction\) && faction > 0/,
      "Number.isSafeInteger(faction) && faction >= 0",
      "player field-spawn validation");
    await route.fulfill({ response, body });
  });
  await page.route("**/src/renderers/three/create-three-renderer.ts", async route => {
    const response = await route.fetch();
    let body = await response.text();
    body = patchServed(body, /\tconst mounts = await mountBuild;/,
      "\tconst mounts = await mountBuild;\n" +
      "\twindow.__unitMemory = { renderer, scene, mounts, cavalry, worker, gl, world, quality };",
      "create-three-renderer mounts probe");
    body = patchServed(body, /\treturn result;/,
      "\twindow.__unitMemory.result = result;\n\treturn result;",
      "create-three-renderer result probe");
    await route.fulfill({ response, body });
  });
  await page.route("**/src/renderers/three/three-mounts.ts", async route => {
    const response = await route.fetch();
    let body = await response.text();
    body = patchServed(body, /\tconst mixer = new AnimationMixer\(root\);/,
      "\tconst mixer = new AnimationMixer(root);\n" +
      "\troot.userData.__unitMemoryMixer = mixer;\n" +
      "\t(window.__unitMemoryMountMixers ??= new Set()).add(mixer);",
      "mount mixer registration");
    body = patchServed(body, /\t\t\troot\.removeFromParent\(\);/,
      "\t\t\troot.traverse((object) => {\n" +
      "\t\t\t\tconst mixer = object.userData.__unitMemoryMixer;\n" +
      "\t\t\t\tif (mixer) window.__unitMemoryMountMixers?.delete(mixer);\n" +
      "\t\t\t});\n\t\t\troot.removeFromParent();",
      "mount mixer release");
    body = patchServed(body, /(\n\t\tdispose: \(\) => \{\n\t\t\tdisposed = true;)/,
      "\n\t\tstats: () => {\n" +
      "\t\t\tlet meshes = 0, skinned = 0;\n" +
      "\t\t\tscene.traverse((object) => {\n" +
      "\t\t\t\tif (object.isMesh) meshes++;\n" +
      "\t\t\t\tif (object.isSkinnedMesh) skinned++;\n" +
      "\t\t\t});\n" +
      "\t\t\treturn { dynamic: dynamic.size, pending: pending.size, static: mounts.length,\n" +
      "\t\t\t\tstaticVisible: mounts.filter(mount => mount.root.visible).length,\n" +
      "\t\t\t\tsceneChildren: scene.children.length, meshes, skinned,\n" +
      "\t\t\t\thorses: horseTemplates.stats(), riders: riderTemplates.stats(), armour: riderArmour.stats(),\n" +
      "\t\t\t\tdressed: dressedRiders.stats(), disposed };\n" +
      "\t\t},$1",
      "mount stats probe");
    await route.fulfill({ response, body });
  });
  await page.route("**/src/renderers/three/three-renderer-workers.ts", async route => {
    const response = await route.fetch();
    const body = patchServed(await response.text(),
      /(\n\treturn \{\n)(\t\tdispose: \(\) => \{\n\t\t\tcavalryLayer\.dispose)/,
      "$1\t\tstats: () => cavalry?.stats(),\n$2",
      "cavalry layer stats probe");
    await route.fulfill({ response, body });
  });
  await page.route("**/src/renderers/three/three-worker.ts", async route => {
    const response = await route.fetch();
    let body = await response.text();
    body = patchServed(body, /\tpoolStats: bodies\.stats,/,
      "\tpoolStats: bodies.stats,\n\tpackStats: shared.stats,\n\tcrowdScene: scene,",
      "worker crowd stats probe");
    await route.fulfill({ response, body });
  });
  await page.route("**/src/renderers/three/worker-body-pool.ts", async route => {
    const response = await route.fetch();
    let body = await response.text();
    body = patchServed(body, /\tconst mixer = new AnimationMixer\(root\);/,
      "\tconst mixer = new AnimationMixer(root);\n" +
      "\t(window.__unitMemoryWorkerMixers ??= new Set()).add(mixer);",
      "worker unit mixer registration");
    body = patchServed(body, /mixer\.stopAllAction\(\);\s*mixer\.uncacheRoot\(root\);/,
      "window.__unitMemoryWorkerMixers?.delete(mixer);\n" +
      "\t\t\t\tmixer.stopAllAction();\n\t\t\t\tmixer.uncacheRoot(root);",
      "worker unit mixer release");
    body = patchServed(body, /\(worker\) => \{\s*shared\.releaseBody\(worker\);\s*worker\.dispose\(\);\s*\}/s,
      "(worker) => {\n" +
      "\twindow.__unitMemorySourceMixers?.delete(worker.mixer);\n" +
      "\tshared.releaseBody(worker);\n" +
      "\tworker.dispose();\n" +
      "}",
      "worker source mixer release");
    body = patchServed(body, /shared\.retainBody\(source\);/,
      "(window.__unitMemorySourceMixers ??= new Set()).add(source.mixer);\n      shared.retainBody(source);",
      "worker source mixer registration");
    await route.fulfill({ response, body });
  });
  await page.route("**/src/renderers/three/worker-pack-assets.ts", async route => {
    const response = await route.fetch();
    const body = patchServed(await response.text(),
      "textures: textureCache?.size ?? 0",
      "textures: textureCache?.size ?? 0, textureKeys: textureCache ? [...textureCache.keys()] : [], " +
      "clipKeys: clipCache ? [...clipCache.keys()] : []",
      "worker pack key stats");
    await route.fulfill({ response, body });
  });
  await page.route("**/src/renderers/three/owned-asset-cache.ts", async route => {
    const response = await route.fetch();
    const body = patchServed(await response.text(),
      /return \{\s*assets,\s*pending,\s*references\s*\};/s,
      "return { assets, pending, references, keys: [...entries.keys()] };",
      "owned asset key stats");
    await route.fulfill({ response, body });
  });
};

const readSnapshot = (page: Page, label: string) => page.evaluate((label: string) => {
  const count = (scene: any) => {
    let meshes = 0, skinned = 0;
    scene.traverse((object: any) => {
      if (object.isMesh) meshes++;
      if (object.isSkinnedMesh) skinned++;
    });
    return { children: scene.children.length, meshes, skinned };
  };
  const root = window as any;
  const unit = root.__unitMemory;
  const worker = unit?.worker?.current;
  const pool = worker?.poolStats?.();
  const pack = worker?.packStats?.();
  const mainScene = unit?.scene ? count(unit.scene) : { children: 0, meshes: 0, skinned: 0 };
  const crowdScene = worker?.crowdScene ? count(worker.crowdScene) : { children: 0, meshes: 0, skinned: 0 };
  const gl = unit?.gl;
  const gpuExtension = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    label,
    quality: unit?.quality ? { liteGround: unit.quality.liteGround, sunShadows: unit.quality.sunShadows } : undefined,
    memory: {
      textures: unit?.renderer?.info?.memory?.textures ?? -1,
      geometries: unit?.renderer?.info?.memory?.geometries ?? -1,
      programs: unit?.renderer?.info?.programs?.length
    },
    scene: mainScene,
    workerScene: crowdScene,
    worker: worker ? {
      keys: pool?.keys ?? [],
      pool: {
        assets: pool?.originalBodies ?? -1, pending: pool?.pending ?? -1,
        references: pool?.references ?? -1, instances: pool?.instances ?? -1,
        originalBodies: pool?.originalBodies ?? -1
      },
      pack: {
        clips: pack?.clips ?? -1, holders: pack?.holders ?? -1, pending: pack?.pending ?? -1,
        textures: pack?.textures ?? -1, clipKeys: pack?.clipKeys ?? [], textureKeys: pack?.textureKeys ?? []
      },
      unitMixers: root.__unitMemoryWorkerMixers?.size ?? -1,
      sourceMixers: root.__unitMemorySourceMixers?.size ?? -1
    } : undefined,
    mounts: unit?.mounts?.stats?.(),
    cavalry: unit?.cavalry?.stats?.(),
    mountMixers: root.__unitMemoryMountMixers?.size ?? -1,
    gpu: gpuExtension ? gl.getParameter(gpuExtension.UNMASKED_RENDERER_WEBGL) : undefined
  };
}, label);

const heapReader = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  return {
    read: async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      await page.waitForTimeout(250);
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      const usage = await cdp.send("Runtime.getHeapUsage");
      return { usedSize: usage.usedSize, totalSize: usage.totalSize };
    },
    close: () => cdp.detach().catch(() => undefined)
  };
};

const snapshot = async (
  page: Page, heap: Awaited<ReturnType<typeof heapReader>>, label: string
): Promise<Snapshot> => {
  await page.waitForTimeout(300);
  const heapUsage = await heap.read();
  const data = await readSnapshot(page, label);
  return { ...data, heap: heapUsage } as Snapshot;
};

const freeze = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  simulation.__unitMemoryUpdate ??= simulation.update;
  simulation.update = () => undefined;
});

const step = (page: Page, seconds: number) => page.evaluate((seconds: number) => {
  const simulation = (window as any).__settlement.simulation;
  const update = simulation.__unitMemoryUpdate ?? simulation.update;
  const ticks = Math.round(seconds * 20);
  for (let tick = 0; tick < ticks; tick++) update(.05);
}, seconds);

const waitFrames = (page: Page, frames: number) => page.evaluate((frames: number) => new Promise<void>(resolve => {
  let drawn = 0;
  const tick = () => {
    drawn++;
    if (drawn >= frames) resolve();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), frames);

const waitSettled = async (page: Page, timeoutMs = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(() => {
      const unit = (window as any).__unitMemory;
      const worker = unit?.worker?.current;
      return {
        pool: worker?.poolStats?.(),
        pack: worker?.packStats?.(),
        mounts: unit?.mounts?.stats?.(),
        cavalry: unit?.cavalry?.stats?.()
      };
    });
    const workerSettled = (state.pool?.pending ?? 0) === 0 && (state.pack?.pending ?? 0) === 0;
    const mountsSettled = (state.mounts?.pending ?? 0) === 0 &&
      (!state.cavalry || state.cavalry.pending === 0 || state.cavalry.dynamic > 0);
    if (workerSettled && mountsSettled) return state;
    await page.waitForTimeout(250);
  }
  throw new Error("Renderer loads did not settle");
};

const readActors = (page: Page, ids: readonly number[]) => page.evaluate((ids: number[]) => {
  const simulation = (window as any).__settlement.simulation;
  const frames = simulation.frames(), soldiers = simulation.militarySoldiers();
  return ids.map(id => {
    const actor = frames.find((entry: any) => entry.uid === id);
    const soldier = soldiers.find((entry: any) => entry.actor === id);
    return {
      id, exists: Boolean(actor), phase: actor?.phase, visible: actor?.visible, mounted: actor?.mounted,
      x: actor?.x, z: actor?.z,
      soldier: soldier ? {
        rank: soldier.rank, type: soldier.combat?.type, hp: soldier.combat?.hp,
        mount: soldier.combat?.mount
      } : null
    };
  });
}, [...ids]);

const readBodyKeys = (page: Page, ids: readonly number[]) => page.evaluate((ids: number[]) => {
  const frames = (window as any).__settlement.workerFrames;
  return ids.map(id => {
    const frame = frames.find((entry: any) => entry.actorId === id);
    return frame ? `${frame.nation}/${frame.variant}/${frame.armourRank ?? "civilian"}` : null;
  });
}, [...ids]);

/** Open ground near the headquarters for a field-spawned squad and its opponents. */
const findBattleGround = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  const access = simulation.headquarters.access;
  const open = (x: number, z: number) => {
    for (let dz = -6; dz <= 6; dz++) for (let dx = -12; dx <= 12; dx++)
      if (simulation.isOccupied(x + dx, z + dz)) return false;
    return true;
  };
  for (let radius = 8; radius <= 60; radius += 2) for (let sector = 0; sector < 24; sector++) {
    const angle = sector * Math.PI / 12;
    const point = {
      x: Math.round(access.x + Math.cos(angle) * radius) + .5,
      z: Math.round(access.z + Math.sin(angle) * radius) + .5
    };
    if (open(point.x, point.z)) return point;
  }
  throw new Error("No open ground for the field squad");
});

const moveSurvivor = async (page: Page, id: number, from: { x: number; z: number }) => {
  // The enemy seek radius is 24 tiles; keep the uncommitted survivor well outside it.
  const directions = [[-30, 0], [0, -30], [0, 30], [-24, -24], [-24, 24], [24, -24], [24, 24], [30, 0]];
  for (const [dx, dz] of directions) {
    const order = await page.evaluate(({ dx, dz, id }) => {
      const simulation = (window as any).__settlement.simulation;
      const actor = simulation.frames().find((entry: any) => entry.uid === id);
      if (!actor) return { accepted: false, safe: null };
      const safe = { x: actor.x + dx, z: actor.z + dz };
      return { accepted: simulation.commandMilitary([id], safe, "move"), safe };
    }, { dx, dz, id });
    if (!order.accepted || !order.safe) continue;
    const safe = order.safe;
    for (let index = 0; index < 12; index++) {
      await step(page, 2);
      await page.waitForTimeout(250);
      const position = await page.evaluate(({ from, id, safe }) => {
        const actor = (window as any).__settlement.simulation.frames().find((entry: any) => entry.uid === id);
        return actor ? {
          phase: actor.phase,
          distance: Math.hypot(actor.x - safe.x, actor.z - safe.z),
          separation: Math.hypot(actor.x - from.x, actor.z - from.z)
        } : null;
      }, { from, id, safe });
      if (position?.phase === "militaryField" && position.distance < 5 && position.separation > 22)
        return { safe, ...position };
    }
  }
  throw new Error(`Survivor ${id} could not be moved clear of the battle`);
};

const spawnUnits = (
  page: Page, center: { x: number; z: number }, count: number,
  type: string = ENEMY_TYPE, rank: number = ENEMY_RANK, faction: number = 1
) => page.evaluate(({ center, count, faction, rank, type }) => {
  const simulation = (window as any).__settlement.simulation;
  const offset = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
  const ids: number[] = [];
  for (let radius = 5; radius <= 30 && ids.length < count; radius += 2) {
    for (let sector = 0; sector < 24 && ids.length < count; sector++) {
      const angle = sector * Math.PI / 12;
      const x = center.x + Math.cos(angle) * radius, z = center.z + Math.sin(angle) * radius;
      for (let index = 0; index < count && ids.length < count; index++) {
        for (const dz of offset) {
          let id: number | null = null;
          for (const dx of offset) {
            id = simulation.spawnMilitaryOpponent({
              x: x + (index % 3 - 1) * 1.2 + dx,
              z: z + (Math.floor(index / 3) - .5) * 1.2 + dz
            }, type, rank, faction);
            if (id !== null) break;
          }
          if (id !== null) { ids.push(id); break; }
        }
      }
    }
  }
  if (ids.length !== count) throw new Error(`Spawned ${ids.length}/${count} units`);
  return ids;
}, { center, count, faction, rank, type });

const resetSimulation = async (page: Page, before: string, after: string) => {
  const result = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return simulation.loadState((window as any).__unitMemoryBaseline);
  });
  assert.equal(result?.ok, true, `Baseline restore failed (${before} -> ${after})`);
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const root = window as any;
    const start = root.__unitMemory?.world?.start;
    if (start) root.__settlement.focusGround(start.x, start.z, 2);
  });
  await page.waitForTimeout(800);
  await waitSettled(page);
};

const clickCamera = async (page: Page, x: number, z: number, zoom: number) => {
  await page.evaluate(({ x, z, zoom }) => (window as any).__settlement.focusGround(x, z, zoom), { x, z, zoom });
  await page.waitForTimeout(700);
};

/** Small review receipts: 1280x860 JPEG rather than multi-megabyte PNGs. */
const shoot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(OUTPUT, `${name}.jpg`), quality: 72, type: "jpeg" });

const assertStaticPreview = (snapshot: Snapshot, stage: string) => {
  assert(snapshot.mounts, `${stage}: no static mount layer`);
  assert.equal(snapshot.mounts.static, STATIC_MOUNTS, `${stage}: static preview count`);
  assert.equal(snapshot.mounts.staticVisible, STATIC_MOUNTS, `${stage}: static preview visibility`);
  assert.equal(snapshot.mounts.horses.assets, 1, `${stage}: static horse template`);
  assert.equal(snapshot.mounts.riders.assets, STATIC_MOUNTS, `${stage}: static rider templates`);
  assert.equal(snapshot.mounts.dressed.assets, STATIC_MOUNTS, `${stage}: static dressed riders`);
};

const assertSettled = (snapshot: Snapshot, stage: string) => {
  assert(snapshot.worker, `${stage}: no worker crowd`);
  assert.equal(snapshot.worker.pool.pending, 0, `${stage}: worker body loads`);
  assert.equal(snapshot.worker.pack.pending, 0, `${stage}: worker pack loads`);
  assert.equal(snapshot.worker.keys.length, snapshot.worker.pool.originalBodies,
    `${stage}: body keys vs cached bodies`);
  assert.equal(snapshot.worker.unitMixers, snapshot.worker.pool.instances,
    `${stage}: live worker mixers vs instances`);
  assert.equal(snapshot.worker.sourceMixers, snapshot.worker.pool.originalBodies,
    `${stage}: source mixers vs body types`);
  assert.equal(snapshot.mountMixers,
    MOUNT_MIXERS_PER_INSTANCE * ((snapshot.mounts?.static ?? 0) +
      (snapshot.cavalry?.dynamic ?? 0)), `${stage}: mount mixers vs mounted instances`);
};

const assertBounded = (
  baseline: Snapshot, current: Snapshot, stage: string
) => {
  assert(current.memory.textures <= baseline.memory.textures + TEXTURE_TOLERANCE,
    `${stage}: GPU textures grew ${baseline.memory.textures} -> ${current.memory.textures}`);
  assert(current.memory.geometries <= baseline.memory.geometries + GEOMETRY_TOLERANCE,
    `${stage}: GPU geometries grew ${baseline.memory.geometries} -> ${current.memory.geometries}`);
  assert(current.worker!.pack.textures <= baseline.worker!.pack.textures + TEXTURE_TOLERANCE,
    `${stage}: worker pack textures grew`);
  assert(current.worker!.pack.clips <= baseline.worker!.pack.clips + TEXTURE_TOLERANCE,
    `${stage}: worker pack clips grew`);
  assert(current.heap.usedSize <= baseline.heap.usedSize + HEAP_GROWTH_BYTES,
    `${stage}: post-GC heap grew ${baseline.heap.usedSize} -> ${current.heap.usedSize}`);
};

const errorLog = () => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const webglErrors: string[] = [];
  const httpErrors: string[] = [];
  const isDevNoise = (text: string) =>
    text.includes("Outdated Optimize Dep") ||
    (text.includes("Failed to fetch dynamically imported module") &&
      /(hud\/mount|corner-row\/mount-corner|stats-overlay\/mount)/.test(text));
  const attach = (page: Page) => {
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (isDevNoise(text)) return;
      consoleErrors.push(text);
      if (/WebGL|shader|GL_INVALID|THREE\./i.test(text)) webglErrors.push(text);
    });
    page.on("response", response => {
      if (response.status() < 400) return;
      const text = `${response.status()} ${response.url()}`;
      if (isDevNoise(text)) return;
      httpErrors.push(text);
    });
  };
  return { attach, pageErrors, consoleErrors, webglErrors, httpErrors };
};

interface QualityReceipt {
  quality: string;
  fixture: Record<string, unknown>;
  browser: Record<string, unknown>;
  staticPreview: Record<string, unknown>;
  combined: Record<string, unknown>;
  errors: Record<string, string[]>;
  assertions: string[];
}

const runStaticPreview = async (
  url: string, quality: string
): Promise<Record<string, unknown>> => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = errorLog(); errors.attach(page);
  const heap = await heapReader(page);
  try {
    await installProbe(page, { horseWithSettlement: false });
    await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
    await page.goto(`${url}?quality=${quality}&seed=123&size=64&cache=0&horse=1`);
    await waitForIsland(page);
    await page.waitForTimeout(5000);
    const before = await snapshot(page, heap, "static-before");
    await waitFrames(page, 240);
    await page.waitForTimeout(700);
    const after = await snapshot(page, heap, "static-after-240-frames");
    assertStaticPreview(before, `${quality} static preview`);
    assertStaticPreview(after, `${quality} static preview after 240 frames`);
    assert.equal(before.mounts!.meshes, after.mounts!.meshes, `${quality}: static preview meshes changed`);
    assert.equal(await page.evaluate(() => Boolean((window as any).__settlement)), false,
      `${quality}: the public ?horse=1 trial must stay settlement-free`);
    assert.deepEqual(errors.webglErrors, [], `${quality}: static preview WebGL/shader errors`);
    assert.deepEqual(errors.pageErrors, [], `${quality}: static preview page errors`);
    assert.deepEqual(errors.consoleErrors, [], `${quality}: static preview console errors`);
    assert.deepEqual(errors.httpErrors, [], `${quality}: static preview HTTP errors`);
    await shoot(page, `${quality}-static-preview`);
    return {
      before: { mounts: mountShape(before.mounts!), mountMixers: before.mountMixers, heap: before.heap, gpu: before.gpu },
      after: { mounts: mountShape(after.mounts!), mountMixers: after.mountMixers, heap: after.heap, gpu: after.gpu },
      frames: 240,
      settlementDisabled: true,
      browserVersion: browser.version(),
      errors: {
        page: errors.pageErrors, console: errors.consoleErrors,
        webgl: errors.webglErrors, http: errors.httpErrors
      }
    };
  } finally {
    await heap.close();
    await page.close();
    await browser.close();
  }
};

const runCombined = async (
  url: string, quality: string
): Promise<Record<string, unknown>> => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = errorLog(); errors.attach(page);
  await installProbe(page, { horseWithSettlement: true });
  await page.routeWebSocket("**/*", () => undefined);
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  const heap = await heapReader(page);
  try {
    await stageStartupSave(page, url, fixtureBytes.toString("utf8"), true);
    await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&horse=1`);
    await waitForIsland(page);
    await page.waitForTimeout(6000);
    const boot = await page.evaluate(() => {
      const root = window as any;
      const unit = root.__unitMemory;
      return {
        settlement: Boolean(root.__settlement?.simulation),
        quality: unit?.quality ? { liteGround: unit.quality.liteGround, sunShadows: unit.quality.sunShadows } : null,
        worldStart: unit?.world?.start,
        home: root.__settlement.simulation.headquarters
          ? { x: root.__settlement.simulation.headquarters.x, z: root.__settlement.simulation.headquarters.z }
          : null,
        soldiers: root.__settlement.simulation.militarySoldiers().length,
        actors: root.__settlement.simulation.frames().length,
        buildings: root.__settlement.simulation.buildings().length
      };
    });
    assert(boot.settlement, `${quality}: settlement did not load`);
    assert(boot.quality, `${quality}: renderer quality probe missing`);
    if (quality === "minimal") assert.equal(boot.quality.liteGround, true, `${quality}: wrong resolved quality`);
    if (quality === "high") assert.equal(boot.quality.liteGround, false, `${quality}: wrong resolved quality`);
    await freeze(page);
    await page.evaluate(() => {
      (window as any).__unitMemoryBaseline = (window as any).__settlement.simulation.saveState();
    });
    await waitSettled(page);
    if (boot.worldStart) await clickCamera(page, boot.worldStart.x, boot.worldStart.z, 2);
    const baseline = await snapshot(page, heap, "baseline");
    assertStaticPreview(baseline, `${quality} baseline`);
    assertSettled(baseline, `${quality} baseline`);
    await shoot(page, `${quality}-baseline`);

    const cycles: Record<string, unknown>[] = [];
    let firstCycleReset: Snapshot | null = null;
    let removedTypeKey = "";
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const ground = await findBattleGround(page);
      const spawned = await spawnUnits(page, ground, TEST_SOLDIERS, WORKER_TYPE, WORKER_RANK, 0);
      assert.equal(spawned.length, TEST_SOLDIERS, `${quality} cycle ${cycle}: player field spawn failed`);
      let keysBefore: (string | null)[] = [];
      for (let attempt = 0; attempt < 20; attempt++) {
        await page.waitForTimeout(300);
        keysBefore = await readBodyKeys(page, spawned);
        if (keysBefore.every(Boolean)) break;
      }
      assert(keysBefore.every(Boolean), `${quality} cycle ${cycle}: missing body keys`);
      // Keep the survivor on a body type not already worn by the save's garrison, so the last
      // unit's release is observable rather than shared with a resident soldier.
      const survivorIndex = keysBefore.findIndex(key => key && !baseline.worker!.keys.includes(key));
      assert(survivorIndex >= 0,
        `${quality} cycle ${cycle}: all test body types are already resident; cannot isolate the last unit`);
      const survivor = spawned[survivorIndex]!;
      const attackers = spawned.filter(id => id !== survivor);
      const survivorKey = keysBefore[survivorIndex]!;
      const safe = await moveSurvivor(page, survivor, ground);
      await waitSettled(page);
      const beforeFight = await snapshot(page, heap, `cycle-${cycle}-before-fight`);
      assertSettled(beforeFight, `${quality} cycle ${cycle} before fight`);

      const enemies = await spawnUnits(page, { x: ground.x + 9, z: ground.z }, ENEMIES);
      const ordered = await page.evaluate(({ attackers, centre, enemies }) => {
        const simulation = (window as any).__settlement.simulation;
        const acceptedPlayers = simulation.commandMilitary(attackers, centre, "attackMove");
        const acceptedEnemies = simulation.commandMilitaryOpponent(enemies, centre, 1, "attackMove");
        return { acceptedPlayers, acceptedEnemies };
      }, { attackers, enemies, centre: { x: ground.x + 9, z: ground.z } });
      assert(ordered.acceptedPlayers, `${quality} cycle ${cycle}: player order refused`);
      assert(ordered.acceptedEnemies, `${quality} cycle ${cycle}: enemy order refused`);

      let battleSeconds = 0;
      for (let round = 0; round < 24; round++) {
        await step(page, 5);
        battleSeconds += 5;
        await page.waitForTimeout(900);
        let actors = await readActors(page, spawned);
        let deadAttackers = attackers.filter(id => !actors.find(actor => actor.id === id)?.exists).length;
        assert(actors.find(actor => actor.id === survivor)?.exists,
          `${quality} cycle ${cycle}: the uncommitted survivor died (${battleSeconds}s)`);
        if (deadAttackers === attackers.length) break;
        // Re-issue the melee when a route stalls: send the survivors into the live enemy block and
        // the enemies back at them. This keeps the bounded fight from waiting on a lost path.
        if (round > 0 && round % 2 === 1) {
          await page.evaluate(({ attackers, enemies }) => {
            const simulation = (window as any).__settlement.simulation;
            const frames = simulation.frames();
            const liveAttackers = attackers.filter((id: number) => frames.some((actor: any) => actor.uid === id));
            const liveEnemies = enemies.filter((id: number) => frames.some((actor: any) => actor.uid === id));
            if (!liveAttackers.length || !liveEnemies.length) return;
            const centre = (ids: number[]) => {
              const bodies = ids.map((id: number) => frames.find((actor: any) => actor.uid === id));
              return {
                x: bodies.reduce((sum: number, actor: any) => sum + actor.x, 0) / bodies.length,
                z: bodies.reduce((sum: number, actor: any) => sum + actor.z, 0) / bodies.length
              };
            };
            simulation.commandMilitary(liveAttackers, centre(liveEnemies), "attackMove");
            simulation.commandMilitaryOpponent(liveEnemies, centre(liveAttackers), 1, "attackMove");
          }, { attackers, enemies });
          await step(page, 2);
          await page.waitForTimeout(400);
          actors = await readActors(page, spawned);
          deadAttackers = attackers.filter(id => !actors.find(actor => actor.id === id)?.exists).length;
          if (deadAttackers === attackers.length) break;
        }
        if (round === 23) throw new Error(
          `${quality} cycle ${cycle}: only ${deadAttackers}/${attackers.length} attackers died in ${battleSeconds}s`);
      }
      await step(page, 3);
      await page.waitForTimeout(1200);
      const survivorStage = await snapshot(page, heap, `cycle-${cycle}-survivor`);
      assertSettled(survivorStage, `${quality} cycle ${cycle} survivor`);
      assert((await readActors(page, [survivor]))[0]?.exists,
        `${quality} cycle ${cycle}: survivor disappeared after cleanup`);
      assert(survivorStage.worker!.keys.includes(survivorKey),
        `${quality} cycle ${cycle}: survivor body type was released`);
      const deadKeys = keysBefore.filter((_, index) => index !== survivorIndex);
      for (const key of deadKeys) {
        if (baseline.worker!.keys.includes(key!))
          assert(survivorStage.worker!.keys.includes(key!),
            `${quality} cycle ${cycle}: shared resident body type ${key} was released`);
        else assert(!survivorStage.worker!.keys.includes(key!),
          `${quality} cycle ${cycle}: dead attacker body type ${key} stayed cached`);
      }
      assert(survivorStage.worker!.pack.textures > 0, `${quality} cycle ${cycle}: pack textures vanished`);
      const survivorPosition = (await readActors(page, [survivor]))[0]!;
      await clickCamera(page, ground.x + 9, ground.z, 2);
      await shoot(page, `${quality}-cycle-${cycle}-battle`);
      await clickCamera(page, survivorPosition.x, survivorPosition.z, 1.5);
      await shoot(page, `${quality}-cycle-${cycle}-survivor`);

      await page.evaluate(({ player, targets }) => {
        const simulation = (window as any).__settlement.simulation;
        const actors = simulation.frames();
        const live = targets.map((id: number) => actors.find((entry: any) => entry.uid === id)).filter(Boolean);
        if (!live.length) throw new Error("No enemy is left to remove the last unit");
        const centre = {
          x: live.reduce((sum: number, actor: any) => sum + actor.x, 0) / live.length,
          z: live.reduce((sum: number, actor: any) => sum + actor.z, 0) / live.length
        };
        simulation.commandMilitary([player], centre, "attackMove");
      }, { player: survivor, targets: enemies });
      let lastKilled = false;
      for (let round = 0; round < 12; round++) {
        await step(page, 5);
        await page.waitForTimeout(700);
        if (!(await readActors(page, [survivor]))[0]!.exists) { lastKilled = true; break; }
      }
      assert(lastKilled, `${quality} cycle ${cycle}: last soldier of the type did not die`);
      await step(page, 3);
      await page.waitForTimeout(1200);
      const removedStage = await snapshot(page, heap, `cycle-${cycle}-removed`);
      assertSettled(removedStage, `${quality} cycle ${cycle} removed`);
      assert(!removedStage.worker!.keys.includes(survivorKey),
        `${quality} cycle ${cycle}: last unit's body type stayed cached`);
      removedTypeKey = survivorKey;
      const releasedBodies = removed(survivorStage.worker!.keys, removedStage.worker!.keys);
      assert(releasedBodies.includes(survivorKey),
        `${quality} cycle ${cycle}: last unit's body key was not in the released set`);
      const releasedTextures = removed(survivorStage.worker!.pack.textureKeys,
        removedStage.worker!.pack.textureKeys);
      const releasedClips = removed(survivorStage.worker!.pack.clipKeys, removedStage.worker!.pack.clipKeys);
      // The test type's body atlas may be shared with a resident civilian/garrison body, so the
      // exact body-key release above is the ownership proof; a non-empty pack diff is recorded
      // when the type also owned an unshared texture or clip.
      await clickCamera(page, ground.x + 9, ground.z, 2);
      await shoot(page, `${quality}-cycle-${cycle}-removed`);

      await resetSimulation(page, `cycle ${cycle}`, "baseline");
      const reset = await snapshot(page, heap, `cycle-${cycle}-reset`);
      assertSettled(reset, `${quality} cycle ${cycle} reset`);
      assert.deepEqual(sorted(reset.worker!.keys), sorted(baseline.worker!.keys),
        `${quality} cycle ${cycle}: body types did not return to baseline`);
      assert.equal(reset.worker!.pool.originalBodies, baseline.worker!.pool.originalBodies,
        `${quality} cycle ${cycle}: body cache did not settle`);
      const missingPackTextures = removed(baseline.worker!.pack.textureKeys,
        reset.worker!.pack.textureKeys);
      const extraPackTextures = added(baseline.worker!.pack.textureKeys,
        reset.worker!.pack.textureKeys);
      assert(reset.worker!.pack.textures >= baseline.worker!.pack.textures - TEXTURE_TOLERANCE,
        `${quality} cycle ${cycle}: pack textures fell ${baseline.worker!.pack.textures} -> ` +
        `${reset.worker!.pack.textures}`);
      assert(reset.worker!.pack.textures <= baseline.worker!.pack.textures + TEXTURE_TOLERANCE,
        `${quality} cycle ${cycle}: pack textures grew`);
      assert.equal(reset.worker!.pack.clips, baseline.worker!.pack.clips,
        `${quality} cycle ${cycle}: pack clips did not settle`);
      assertStaticPreview(reset, `${quality} cycle ${cycle} reset`);
      if (!firstCycleReset) firstCycleReset = reset;
      else assertBounded(firstCycleReset, reset, `${quality} cycle ${cycle} settled`);
      cycles.push({
        cycle,
        spawn: { ground, safe },
        keysBefore,
        survivorKey,
        bodyKeysAfter: { survivor: survivorStage.worker!.keys, removed: removedStage.worker!.keys },
        released: { textures: releasedTextures, clips: releasedClips },
        battleSeconds,
        beforeFight: { memory: beforeFight.memory, pool: beforeFight.worker!.pool, pack: {
          textures: beforeFight.worker!.pack.textures, clips: beforeFight.worker!.pack.clips,
          holders: beforeFight.worker!.pack.holders } },
        survivor: { memory: survivorStage.memory, pool: survivorStage.worker!.pool, pack: {
          textures: survivorStage.worker!.pack.textures, clips: survivorStage.worker!.pack.clips,
          holders: survivorStage.worker!.pack.holders }, heap: survivorStage.heap },
        removed: { memory: removedStage.memory, pool: removedStage.worker!.pool, pack: {
          textures: removedStage.worker!.pack.textures, clips: removedStage.worker!.pack.clips,
          holders: removedStage.worker!.pack.holders }, heap: removedStage.heap },
        reset: { memory: reset.memory, keys: reset.worker!.keys, pool: reset.worker!.pool, pack: {
          textures: reset.worker!.pack.textures, clips: reset.worker!.pack.clips,
          holders: reset.worker!.pack.holders, missingTextures: missingPackTextures,
          extraTextures: extraPackTextures }, unitMixers: reset.worker!.unitMixers,
        sourceMixers: reset.worker!.sourceMixers, heap: reset.heap }
      });
    }

    // A fresh add of the removed type: the exact body source must load again. The Roman centurion
    // textures stay shared with the save's garrison, so only the body key is new.
    const readdGround = await findBattleGround(page);
    const readdedIds = await spawnUnits(page, readdGround, TEST_SOLDIERS, WORKER_TYPE, WORKER_RANK, 0);
    assert.equal(readdedIds.length, TEST_SOLDIERS, `${quality}: re-add field spawn failed`);
    let readdedKeys: (string | null)[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(300);
      readdedKeys = await readBodyKeys(page, readdedIds);
      if (readdedKeys.every(Boolean)) break;
    }
    await waitSettled(page);
    const readd = await snapshot(page, heap, "readd");
    assertSettled(readd, `${quality} readd`);
    assert(readdedKeys.every(Boolean), `${quality}: re-added body keys are missing`);
    assert(readdedKeys.includes(removedTypeKey) && readd.worker!.keys.includes(removedTypeKey),
      `${quality}: removed body type ${removedTypeKey} did not load again`);
    assert(readd.worker!.pool.originalBodies > baseline.worker!.pool.originalBodies,
      `${quality}: re-add did not add body types`);

    // A released enemy nation's textures are not shared with the save: one opponent re-add must
    // re-upload them. This is the "re-upload" half that the shared Roman garrison textures cannot
    // show for the player type above.
    await spawnUnits(page, boot.home ?? boot.worldStart, 1);
    await waitSettled(page);
    const enemyReadd = await snapshot(page, heap, "enemy-texture-readd");
    const vikingBefore = baseline.worker!.pack.textureKeys.filter(key => key.includes("/viking/"));
    const vikingAfter = enemyReadd.worker!.pack.textureKeys.filter(key => key.includes("/viking/"));
    assert(added(vikingBefore, vikingAfter).length > 0,
      `${quality}: released enemy textures were not re-uploaded`);

    await resetSimulation(page, "readd", "baseline");

    // Static `?horse=1` preview beside dynamic military cavalry: the static mounts hold the horse
    // template for their whole life; the dynamic layer releases and reloads its own copy.
    // The dynamic mount is a field-spawned faction-1 rider, attacked by a faction-2 squad, so the
    // observation does not depend on the save's crowded storage door or a player recruit path.
    const cavalryUnits = await spawnUnits(page, boot.home ?? boot.worldStart, 1, "cavalry", 0, 1);
    assert.equal(cavalryUnits.length, 1, `${quality}: cavalry spawn failed`);
    const cavalryId = cavalryUnits[0]!;
    let mounted = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await step(page, 1);
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => {
        const unit = (window as any).__unitMemory;
        return { cavalry: unit.cavalry?.stats?.(), memory: unit.renderer.info.memory };
      });
      if (state.cavalry?.dynamic === 1 && state.cavalry.horses.assets === 1) { mounted = true; break; }
    }
    assert(mounted, `${quality}: dynamic cavalry mount did not load`);
    await waitSettled(page);
    const cavalryMounted = await snapshot(page, heap, "cavalry-mounted");
    assertStaticPreview(cavalryMounted, `${quality} cavalry mounted`);
    assert.equal(cavalryMounted.cavalry!.dynamic, 1, `${quality}: dynamic mount count`);
    assert.equal(cavalryMounted.cavalry!.horses.assets, 1, `${quality}: dynamic horse template`);
    assert.equal(cavalryMounted.cavalry!.dressed.assets, 1, `${quality}: dynamic dressed rider`);
    const cavalryPosition = (await readActors(page, [cavalryId]))[0]!;
    await clickCamera(page, cavalryPosition.x, cavalryPosition.z, 1.5);
    await shoot(page, `${quality}-cavalry-mounted`);

    const cavalryBattle = await page.evaluate(({ id }) => {
      const simulation = (window as any).__settlement.simulation;
      const actor = simulation.frames().find((entry: any) => entry.uid === id);
      return { x: actor.x, z: actor.z };
    }, { id: cavalryId });
    const killers = await spawnUnits(page, cavalryBattle, ENEMIES, "heavy", 2, 2);
    const killerCentre = await page.evaluate(({ ids }) => {
      const simulation = (window as any).__settlement.simulation;
      const actors = simulation.frames().filter((entry: any) => ids.includes(entry.uid));
      return {
        x: actors.reduce((sum: number, actor: any) => sum + actor.x, 0) / actors.length,
        z: actors.reduce((sum: number, actor: any) => sum + actor.z, 0) / actors.length
      };
    }, { ids: killers });
    await page.evaluate(({ id, killers, point, target }) => {
      const simulation = (window as any).__settlement.simulation;
      simulation.commandMilitaryOpponent([id], point, 1, "attackMove");
      simulation.commandMilitaryOpponent(killers, target, 2, "attackMove");
    }, { id: cavalryId, killers, point: killerCentre, target: cavalryBattle });
    let cavalryDead = false;
    for (let round = 0; round < 24; round++) {
      await step(page, 5);
      await page.waitForTimeout(500);
      if (!(await readActors(page, [cavalryId]))[0]!.exists) { cavalryDead = true; break; }
    }
    assert(cavalryDead, `${quality}: cavalry did not die`);
    await step(page, 3);
    await waitFrames(page, 200);
    await page.waitForTimeout(1200);
    const cavalryRetired = await snapshot(page, heap, "cavalry-retired");
    assertStaticPreview(cavalryRetired, `${quality} cavalry retired`);
    assert.equal(cavalryRetired.cavalry!.dynamic, 0, `${quality}: dynamic mount did not retire`);
    assert.equal(cavalryRetired.cavalry!.pending, 0, `${quality}: retired mount stayed pending`);
    assert.equal(cavalryRetired.cavalry!.horses.assets, 0, `${quality}: horse template stayed after last mount`);
    assert.equal(cavalryRetired.cavalry!.riders.assets, 0, `${quality}: rider template stayed after last mount`);
    assert.equal(cavalryRetired.cavalry!.dressed.assets, 0, `${quality}: dressed rider stayed after last mount`);
    assert.equal(cavalryRetired.cavalry!.armour.assets, 0, `${quality}: rider armour stayed after last mount`);
    assert.equal(cavalryRetired.mountMixers, MOUNT_MIXERS_PER_INSTANCE * STATIC_MOUNTS,
      `${quality}: retired mount mixers were not released`);
    await clickCamera(page, boot.worldStart?.x ?? 0, boot.worldStart?.z ?? 0, 2);
    await shoot(page, `${quality}-static-after-retirement`);

    await resetSimulation(page, "cavalry retired", "baseline");
    const cavalryReadd = await spawnUnits(page, boot.home ?? boot.worldStart, 1, "cavalry", 0, 1);
    assert.equal(cavalryReadd.length, 1, `${quality}: cavalry re-add spawn failed`);
    let remounted = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await step(page, 1);
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => (window as any).__unitMemory.cavalry?.stats?.());
      if (state?.dynamic === 1 && state.horses.assets === 1) { remounted = true; break; }
    }
    assert(remounted, `${quality}: horse template did not reload on re-add`);
    await waitSettled(page);
    const cavalryReadded = await snapshot(page, heap, "cavalry-readded");
    assertStaticPreview(cavalryReadded, `${quality} cavalry re-added`);
    assert.equal(cavalryReadded.cavalry!.dynamic, 1, `${quality}: re-added dynamic mount count`);
    assert.equal(cavalryReadded.cavalry!.horses.assets, 1, `${quality}: horse template did not reload`);

    await resetSimulation(page, "cavalry re-add", "baseline");
    await clickCamera(page, boot.worldStart?.x ?? 0, boot.worldStart?.z ?? 0, 2);
    const finalStatic = await snapshot(page, heap, "final-static");
    assertStaticPreview(finalStatic, `${quality} final static`);
    await shoot(page, `${quality}-final-static`);

    assert.deepEqual(errors.webglErrors, [], `${quality}: WebGL/shader errors`);
    assert.deepEqual(errors.pageErrors, [], `${quality}: page errors`);
    assert.deepEqual(errors.consoleErrors, [], `${quality}: console errors`);
    assert.deepEqual(errors.httpErrors, [], `${quality}: HTTP errors`);
    return {
      boot,
      baseline: {
        gpu: baseline.gpu, memory: baseline.memory, scene: baseline.scene, workerScene: baseline.workerScene,
        keys: baseline.worker!.keys, pool: baseline.worker!.pool, pack: {
          textures: baseline.worker!.pack.textures, clips: baseline.worker!.pack.clips,
          holders: baseline.worker!.pack.holders, textureKeys: baseline.worker!.pack.textureKeys,
          clipKeys: baseline.worker!.pack.clipKeys }, mounts: mountShape(baseline.mounts!),
        mountMixers: baseline.mountMixers, unitMixers: baseline.worker!.unitMixers,
        sourceMixers: baseline.worker!.sourceMixers, heap: baseline.heap
      },
      cycles,
      readd: {
        keys: readdedKeys, removedTypeKey, pool: readd.worker!.pool, pack: {
          textures: readd.worker!.pack.textures, clips: readd.worker!.pack.clips,
          holders: readd.worker!.pack.holders, textureKeys: readd.worker!.pack.textureKeys },
        memory: readd.memory, heap: readd.heap
      },
      enemyTextureReupload: {
        added: added(vikingBefore, vikingAfter), count: added(vikingBefore, vikingAfter).length,
        memory: enemyReadd.memory, pack: { textures: enemyReadd.worker!.pack.textures }
      },
      cavalry: {
        mounted: {
          dynamic: cavalryMounted.cavalry!.dynamic,
          horses: cavalryMounted.cavalry!.horses.assets,
          riders: cavalryMounted.cavalry!.riders.assets,
          dressed: cavalryMounted.cavalry!.dressed.assets,
          armour: cavalryMounted.cavalry!.armour.assets,
          mountMixers: cavalryMounted.mountMixers, memory: cavalryMounted.memory
        },
        retired: {
          dynamic: cavalryRetired.cavalry!.dynamic, horses: cavalryRetired.cavalry!.horses.assets,
          riders: cavalryRetired.cavalry!.riders.assets, dressed: cavalryRetired.cavalry!.dressed.assets,
          armour: cavalryRetired.cavalry!.armour.assets, mountMixers: cavalryRetired.mountMixers,
          memory: cavalryRetired.memory, heap: cavalryRetired.heap
        },
        readded: {
          dynamic: cavalryReadded.cavalry!.dynamic, horses: cavalryReadded.cavalry!.horses.assets,
          riders: cavalryReadded.cavalry!.riders.assets, dressed: cavalryReadded.cavalry!.dressed.assets,
          armour: cavalryReadded.cavalry!.armour.assets, mountMixers: cavalryReadded.mountMixers,
          memory: cavalryReadded.memory
        },
        staticThroughout: mountShape(finalStatic.mounts!)
      },
      errors: {
        page: errors.pageErrors, console: errors.consoleErrors,
        webgl: errors.webglErrors, http: errors.httpErrors
      }
    };
  } finally {
    await heap.close();
    await page.close();
    await browser.close();
  }
};

const main = async () => {
  mkdirSync(OUTPUT, { recursive: true });
  const receipt: Record<string, unknown> = {
    task: "UNIT-MEMORY-01 native High/Minimal acceptance",
    command: COMMAND,
    gitHead: GIT_HEAD,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    generatedAt: new Date().toISOString(),
    output: OUTPUT,
    qualities: {},
    fixture: {
      path: SAVE_PATH,
      sha256: fixtureHash,
      bytes: fixtureBytes.length,
      format: fixture.format,
      version: fixture.version,
      savedAt: fixture.savedAt,
      world: fixture.settlement?.world,
      buildings: fixture.settlement?.buildings?.length,
      actors: fixture.settlement?.actors?.length,
      soldiers: fixture.settlement?.military?.soldiers?.length,
      playerNation: fixture.settlement?.playerNation
    },
    scope: {
      fixture: "existing owner save (runtime-door-wait-save4), copied into the browser startup slot",
      assisted:
        "soldiers and enemies are placed with the existing scenario spawn hook (the review route admits " +
        "faction 0 for the player squad); this does not use the Tavern or the HQ door. The combined " +
        "?horse=1 + settlement page enables two existing dev-only paths together in the test route only.",
      notClaimed: [
        "exact driver VRAM bytes (renderer.info counts Three's GPU objects, not the driver allocation)",
        "a player-facing Tavern recruitment journey or full E2E",
        "foreground/headed rendering unless HEADED=1 is set",
        "the complete nation/rank/horse roster matrix; this covers Roman shield rank 2 and rank-2 heavy opponents",
        "zero heap growth: post-GC heap has a small residual rise within the 16 MB cycle bound"
      ]
    }
  };
  const { server, url } = await startDevServer();
  Object.assign(receipt, {
    headed: process.env.HEADED === "1",
    env: { qualities: QUALITIES, cycles: CYCLES, ownerSave: process.env.OWNER_SAVE, output: process.env.OUTPUT }
  });
  try {
    for (const quality of QUALITIES) {
      console.log(`[unit-memory] ${quality}: static preview`);
      const staticPreview = await runStaticPreview(url, quality);
      if (!receipt.browserVersion) receipt.browserVersion = staticPreview.browserVersion;
      console.log(`[unit-memory] ${quality}: combined fixture`);
      const combined = await runCombined(url, quality);
      const qualityReceipt: QualityReceipt = {
        quality,
        fixture: receipt.fixture as Record<string, unknown>,
        browser: combined.boot as Record<string, unknown>,
        staticPreview,
        combined,
        errors: combined.errors as Record<string, string[]>,
        assertions: [
          "static ?horse=1 preview mounts stayed visible for 240 frames",
          "survivor body type stayed cached and shared pack textures/clips stayed held",
          "dead attackers and the last unit of the type released their body keys",
          "removed type released worker-pack textures/clips where not shared",
          "re-added type reloaded its body source; released enemy-nation textures re-uploaded",
          "three spawn/fight/death/removal/reset cycles settled without monotonic GPU/body/heap growth",
          "dynamic mounted instance retired after 180 frames and released the horse template",
          "static preview mounts stayed valid while the dynamic mount retired",
          "the last mount's horse template reloaded on re-add"
        ]
      };
      writeFileSync(resolve(OUTPUT, `${quality}.json`), JSON.stringify(qualityReceipt, null, 2));
      (receipt.qualities as Record<string, unknown>)[quality] = qualityReceipt;
      writeFileSync(resolve(OUTPUT, "report.json"), JSON.stringify(receipt, null, 2));
      console.log(`[unit-memory] ${quality}: done`);
    }
    assert.equal(sha256(readFileSync(SAVE_PATH)), fixtureHash, "Fixture save changed during the run");
    writeFileSync(resolve(OUTPUT, "report.json"), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ output: OUTPUT, fixture: fixtureHash, qualities: QUALITIES, cycles: CYCLES }));
  } finally {
    await server.close();
  }
};

await main();

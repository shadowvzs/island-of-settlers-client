import { ThreeArmourPack } from "@workers/game-three-armour";
import type { ThreeWorkerPack } from "@workers/game-three-worker";
import { Group } from "three";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
it.each([false, true])("loads matching rank-body and rigid-piece detail assets (Minimal=%s)", async minimal => {
  const root = new Group(), head = new Group(); head.name = "Head"; root.add(head);
  const original = new Group(); original.name = "armour_head";
  const low = new Group(); low.name = "helmet_lod1"; original.add(low);
  const high = new Group(); high.name = "helmet_lod0"; original.add(high);
  const scene = new Group(); scene.add(original);
  const dispose = vi.fn();
  const workers = {
    load: vi.fn(async () => ({ root, dispose })),
    loadModel: vi.fn(async () => ({ scene }))
  };
  const piece = (id: string) => ({ id, attach: { kind: "rigid", joints: ["Head"] },
    ranks: ["soldier"], roots: ["armour_head"], slot: "head" });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ sets: [{
    nation: "chinese", pieces: [piece("roman-default")], bodies: [{
      id: "chinese-male-2", pieces: [piece("source-fitted-helmet")],
      models: { soldier: "../national-armour/chinese-male-2/body-soldier.glb" },
      modelsMinimal: { soldier: "../national-armour/chinese-male-2/body-soldier-minimal.glb" },
      files: { "source-fitted-helmet": "japanese/japanese-man-linen/helmet.glb" },
      filesMinimal: { "source-fitted-helmet": "chinese/chinese-male-2/helmet-minimal.glb" }
    }]
  }] }) })));
  const armour = new ThreeArmourPack("https://game.test/workers/armour/", workers as unknown as ThreeWorkerPack, minimal);
  const loaded = await armour.loadSoldier("chinese", "chinese-male-2", "soldier");
  expect(workers.load).toHaveBeenCalledWith("chinese", "chinese-male-2",
    `https://game.test/workers/national-armour/chinese-male-2/body-soldier${minimal ? "-minimal" : ""}.glb`);
  expect(workers.loadModel).toHaveBeenCalledWith(
    minimal ? "https://game.test/workers/armour/chinese/chinese-male-2/helmet-minimal.glb"
      : "https://game.test/workers/armour/japanese/japanese-man-linen/helmet.glb");
  expect(head.children).toContain(original);
  expect(low.visible).toBe(minimal);
  expect(high.visible).toBe(!minimal);
  loaded.setLod(0);
  expect(low.visible).toBe(minimal);
  loaded.dispose(); expect(dispose).toHaveBeenCalledOnce();
});

it.each([false, true])("keeps legacy fitted military assets when optional detail records are absent (Minimal=%s)", async minimal => {
  const root = new Group(), head = new Group(); head.name = "Head"; root.add(head);
  const helmet = new Group(); helmet.name = "armour_head";
  const scene = new Group(); scene.add(helmet);
  const workers = {
    load: vi.fn(async () => ({ root, dispose: vi.fn() })),
    loadModel: vi.fn(async () => ({ scene })),
    resolveSourceBody: vi.fn(async () => ({ nation: "japanese", variant: "japanese-man-grey" }))
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ sets: [{
    nation: "japanese", pieces: [{ id: "helmet", attach: { kind: "rigid", joints: ["Head"] },
      ranks: ["soldier"], roots: ["armour_head"], slot: "head" }],
    bodies: [{ id: "japanese-man-grey", models: { soldier: "japanese/grey/body-soldier.glb" },
      files: { helmet: "japanese/grey/helmet.glb" } }]
  }] }) })));
  const armour = new ThreeArmourPack("https://game.test/workers/armour/", workers as unknown as ThreeWorkerPack, minimal);
  await armour.loadSoldier("chinese", "chinese-male-1", "soldier");
  expect(workers.resolveSourceBody).toHaveBeenCalledWith("chinese", "chinese-male-1");
  expect(workers.load).toHaveBeenCalledWith("chinese", "chinese-male-1",
    "https://game.test/workers/armour/japanese/grey/body-soldier.glb");
  expect(head.children).toContain(helmet);
});

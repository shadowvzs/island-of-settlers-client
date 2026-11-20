import type { ThreeArmourPack } from "@workers/game-three-armour";
import type { ThreeWorkerPack } from "@workers/game-three-worker";
import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture
} from "three";
import { afterEach, expect, it, vi } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createVisibleWorkerPool } from "../src/render-common/workers/worker-visible-pool";
import { createWorkerBodyPool } from "../src/renderers/three/worker-body-pool";

const appearance = (variant: string) => ({ nation: "roman", variant } as const);
const frame = (actorId: number): WorkerFrame => ({
  actorId,
  action: "idle_breathe",
  animationTime: 0,
  gaitPhase: 0,
  heading: 0,
  nation: "roman",
  runBlend: 0,
  selected: false,
  target: null,
  variant: "alpha",
  x: 0,
  y: 0,
  z: 0
});
const source = (variant: string, dispose: () => void) => {
  const root = new Group();
  root.name = variant;
  root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
  return {
    clips: [new AnimationClip("idle_breathe", 1, [])],
    dispose,
    entry: { nation: "roman", variant },
    mixer: new AnimationMixer(root),
    root,
    setTeamColor: vi.fn()
  };
};
type FakeSource = ReturnType<typeof source>;

const fakePack = () => {
  const sources: { dispose: ReturnType<typeof vi.fn>; worker: FakeSource }[] = [];
  const load = vi.fn(async (_nation: string, variant: string) => {
    const dispose = vi.fn();
    const worker = source(variant, dispose);
    sources.push({ dispose, worker });
    return worker;
  });
  return { load, pack: { load } as unknown as ThreeWorkerPack, sources };
};

const sourceWithAssets = (
  variant: string,
  texture: Texture,
  clip: AnimationClip,
  clipPath: string,
  dispose: () => void
) => {
  const root = new Group();
  root.name = variant;
  root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture })));
  return {
    clips: [clip],
    dispose,
    entry: { animationOverrides: null, animations: clipPath, nation: "roman", variant },
    mixer: new AnimationMixer(root),
    root,
    setTeamColor: vi.fn()
  };
};
type FakeSharedSource = ReturnType<typeof sourceWithAssets>;

/** A pack whose body variants share one texture and one clip-cache entry, as the real pack does. */
const fakeSharedPack = () => {
  const clip = new AnimationClip("idle_breathe", 1, []);
  const clipPath = "actions.glb";
  const clips = new Map<string, Promise<AnimationClip[]>>();
  const textures = new Map<string, Texture>();
  const textureDisposals = vi.fn();
  const sources: { dispose: ReturnType<typeof vi.fn>; worker: FakeSharedSource }[] = [];
  const load = vi.fn(async (_nation: string, variant: string) => {
    // The real pack's loadClips/shareTextures repopulate an evicted entry from the manifest.
    clips.set(clipPath, Promise.resolve([clip]));
    let texture = textures.get("shared");
    if (!texture) {
      texture = new Texture();
      const disposeTexture = texture;
      vi.spyOn(disposeTexture, "dispose").mockImplementation(() => textureDisposals());
      textures.set("shared", texture);
    }
    const dispose = vi.fn();
    const worker = sourceWithAssets(variant, texture, clip, clipPath, dispose);
    sources.push({ dispose, worker });
    return worker;
  });
  return {
    clip,
    clipPath,
    clips,
    load,
    pack: { clips, load, textures } as unknown as ThreeWorkerPack,
    sources,
    textureDisposals,
    textures
  };
};

afterEach(() => vi.restoreAllMocks());

it("keeps a body type while a surviving unit wears it", async () => {
  const { load, pack, sources } = fakePack();
  const pool = createWorkerBodyPool(pack);
  const first = await pool.load(appearance("alpha"));
  const second = await pool.load(appearance("alpha"));
  expect(load).toHaveBeenCalledTimes(1);
  first.dispose();
  expect(sources[0]!.dispose).not.toHaveBeenCalled();
  expect(pool.stats()).toMatchObject({ instances: 1, originalBodies: 1 });
  second.dispose();
  expect(sources[0]!.dispose).toHaveBeenCalledOnce();
  expect(pool.stats()).toMatchObject({ instances: 0, originalBodies: 0 });
});

it("keeps a shared pack texture and clip while another body type survives", async () => {
  const { clipPath, clips, pack, textureDisposals } = fakeSharedPack();
  const pool = createWorkerBodyPool(pack);
  const alpha = await pool.load(appearance("alpha"));
  const beta = await pool.load(appearance("beta"));
  expect(clips.has(clipPath)).toBe(true);
  alpha.dispose();
  // Beta still samples the same clip and draws the same cached texture.
  expect(textureDisposals).not.toHaveBeenCalled();
  expect(clips.has(clipPath)).toBe(true);
  beta.dispose();
  expect(textureDisposals).toHaveBeenCalledOnce();
  expect(clips.has(clipPath)).toBe(false);
});

it("keeps shared pack entries for a body type after it is released and loaded again", async () => {
  const { clipPath, clips, load, pack, sources, textureDisposals, textures } = fakeSharedPack();
  const pool = createWorkerBodyPool(pack);
  const first = await pool.load(appearance("alpha"));
  first.dispose();
  expect(textureDisposals).toHaveBeenCalledOnce();
  expect(clips.has(clipPath)).toBe(false);
  expect(textures.size).toBe(0);

  const second = await pool.load(appearance("alpha"));
  expect(load).toHaveBeenCalledTimes(2);
  expect(clips.has(clipPath)).toBe(true);
  expect(textures.size).toBe(1);
  expect(sources[1]!.worker).not.toBe(sources[0]!.worker);
  second.dispose();
  expect(textureDisposals).toHaveBeenCalledTimes(2);
  expect(clips.has(clipPath)).toBe(false);
});

it("keeps shared pack entries while another body type is still loading", async () => {
  const texture = new Texture(), textureDispose = vi.spyOn(texture, "dispose");
  const clip = new AnimationClip("idle_breathe", 1, []);
  const clipPath = "actions.glb";
  const clips = new Map([[clipPath, Promise.resolve([clip])]]);
  const textures = new Map([["shared", texture]]);
  let finish!: (worker: FakeSharedSource) => void;
  const pending = new Promise<FakeSharedSource>(resolve => { finish = resolve; });
  const load = vi.fn()
    .mockResolvedValueOnce(sourceWithAssets("alpha", texture, clip, clipPath, vi.fn()))
    .mockReturnValueOnce(pending);
  const pool = createWorkerBodyPool({ clips, load, textures } as unknown as ThreeWorkerPack);
  const alpha = await pool.load(appearance("alpha"));
  const beta = pool.load(appearance("beta"));
  alpha.dispose();
  // The pending beta still needs the same shared entries.
  expect(textureDispose).not.toHaveBeenCalled();
  expect(clips.has(clipPath)).toBe(true);
  const dispose = vi.fn();
  finish(sourceWithAssets("beta", texture, clip, clipPath, dispose));
  const betaBody = await beta;
  expect(clips.has(clipPath)).toBe(true);
  betaBody.dispose();
  expect(textureDispose).toHaveBeenCalledOnce();
  expect(clips.has(clipPath)).toBe(false);
});

it("releases pack entries from a body load that was discarded before it finished", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const texture = new Texture(), textureDispose = vi.spyOn(texture, "dispose");
  const clip = new AnimationClip("idle_breathe", 1, []);
  const clipPath = "actions.glb";
  const clips = new Map([[clipPath, Promise.resolve([clip])]]);
  const textures = new Map([["shared", texture]]);
  const dispose = vi.fn();
  let finish!: (worker: FakeSharedSource) => void;
  const pending = new Promise<FakeSharedSource>(resolve => { finish = resolve; });
  const pool = createWorkerBodyPool({
    clips,
    load: vi.fn(() => pending),
    textures
  } as unknown as ThreeWorkerPack);
  const visible = createVisibleWorkerPool({
    attach: vi.fn(),
    load: async visibleFrame => {
      const body = await pool.load(visibleFrame);
      return { dispose: body.dispose, setColor: vi.fn(), update: vi.fn() };
    },
    onError: vi.fn()
  });
  visible.update([frame(1)]);
  expect(pool.stats()).toMatchObject({ pending: 1 });
  visible.update([]);
  finish(sourceWithAssets("alpha", texture, clip, clipPath, dispose));
  await visible.whenReady();
  expect(dispose).toHaveBeenCalledOnce();
  expect(textureDispose).toHaveBeenCalledOnce();
  expect(clips.has(clipPath)).toBe(false);
  expect(pool.stats()).toMatchObject({ instances: 0, originalBodies: 0, pending: 0 });
  visible.dispose();
});

it("releases only the last unit's type, not a different surviving type", async () => {
  const { pack, sources } = fakePack();
  const pool = createWorkerBodyPool(pack);
  const alpha = await pool.load(appearance("alpha"));
  const beta = await pool.load(appearance("beta"));
  alpha.dispose();
  expect(sources[0]!.dispose).toHaveBeenCalledOnce();
  expect(sources[1]!.dispose).not.toHaveBeenCalled();
  beta.dispose();
  expect(sources[1]!.dispose).toHaveBeenCalledOnce();
  expect(pool.stats()).toMatchObject({ instances: 0, originalBodies: 0 });
});

it("releases a pending body once its only unit disappears", async () => {
  const dispose = vi.fn();
  let finish!: (worker: FakeSource) => void;
  const pending = new Promise<FakeSource>(resolve => { finish = resolve; });
  const pack = { load: vi.fn(() => pending) } as unknown as ThreeWorkerPack;
  const pool = createWorkerBodyPool(pack);
  const visible = createVisibleWorkerPool({
    attach: vi.fn(),
    load: async visibleFrame => {
      const body = await pool.load(visibleFrame);
      return { dispose: body.dispose, setColor: vi.fn(), update: vi.fn() };
    },
    onError: vi.fn()
  });
  visible.update([frame(1)]);
  expect(pool.stats()).toMatchObject({ pending: 1 });
  visible.update([]);
  finish(source("alpha", dispose));
  await visible.whenReady();
  expect(dispose).toHaveBeenCalledOnce();
  expect(pool.stats()).toMatchObject({ instances: 0, originalBodies: 0, pending: 0 });
  visible.dispose();
});

it("discards a body load that finishes after its pool was released", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dispose = vi.fn();
  let finish!: (worker: FakeSource) => void;
  const pending = new Promise<FakeSource>(resolve => { finish = resolve; });
  const pack = { load: vi.fn(() => pending) } as unknown as ThreeWorkerPack;
  const pool = createWorkerBodyPool(pack);
  const loading = pool.load(appearance("alpha"));
  expect(pool.stats()).toMatchObject({ pending: 1 });
  pool.dispose();
  finish(source("alpha", dispose));
  await expect(loading).rejects.toThrow(/No roman worker body/);
  expect(dispose).toHaveBeenCalledOnce();
  expect(pool.stats()).toMatchObject({ instances: 0, originalBodies: 0, pending: 0 });
});

it("loads a released body type again when it is recruited", async () => {
  const { load, pack, sources } = fakePack();
  const pool = createWorkerBodyPool(pack);
  const first = await pool.load(appearance("alpha"));
  first.dispose();
  expect(sources[0]!.dispose).toHaveBeenCalledOnce();
  const second = await pool.load(appearance("alpha"));
  expect(load).toHaveBeenCalledTimes(2);
  expect(sources[1]!.worker).not.toBe(sources[0]!.worker);
  second.dispose();
  expect(sources[1]!.dispose).toHaveBeenCalledOnce();
});

it("tracks armour ranks separately and releases the rank nobody wears", async () => {
  const ranks: { dispose: ReturnType<typeof vi.fn>; rank: string }[] = [];
  const loadSoldier = vi.fn(async (_nation: string, variant: string, rank: string) => {
    const dispose = vi.fn();
    ranks.push({ dispose, rank });
    return source(`${variant}-${rank}`, dispose);
  });
  const pack = { load: vi.fn() } as unknown as ThreeWorkerPack;
  const armour = { loadSoldier } as unknown as ThreeArmourPack;
  const pool = createWorkerBodyPool(pack, armour);
  const recruit = await pool.load(appearance("alpha"), "recruit");
  const soldier = await pool.load(appearance("alpha"), "soldier");
  expect(loadSoldier).toHaveBeenCalledTimes(2);
  recruit.dispose();
  expect(ranks[0]!.dispose).toHaveBeenCalledOnce();
  expect(ranks[1]!.dispose).not.toHaveBeenCalled();
  soldier.dispose();
  expect(ranks[1]!.dispose).toHaveBeenCalledOnce();
});

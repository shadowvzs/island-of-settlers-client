import {
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial
} from "three";
import { describe, expect, it, vi } from "vitest";

import type { ExplorationSessionIdentity } from "../src/app/exploration/contracts";
import type { ExplorationAppearanceFrame } from "../src/render-common/exploration/exploration-frame";
import {
  createExplorationAppearanceAdapter,
  createLiveExplorationBodyLoader,
  createSharedExplorationBodyLoader,
  EXPLORATION_APPEARANCE_ASSET_GAPS,
  EXPLORATION_NATIONS,
  EXPLORATION_PORTRAIT_BODIES,
  type ExplorationBodyLoader,
  explorationBodyVisibility,
  type ExplorationLoadedBody,
  measureExplorationRig,
  resolveExplorationAppearance
} from "../src/renderers/three/exploration/exploration-appearance";
import { PORTRAITS } from "../tools/bench/player-portrait-renderer";

const identity: ExplorationSessionIdentity = {
  accountId: "account",
  generation: 4,
  islandKey: "home",
  slotId: "slot"
};

const pose = (mode: "eye" | "transition") => ({
  eyeHeight: 1.7,
  fov: 1.05,
  mode,
  pitch: 0.1,
  x: 6,
  y: 1.2,
  yaw: 0.4,
  z: 8
} as const);

const frame = (
  mode: "eye" | "transition",
  changes: Partial<ExplorationAppearanceFrame> = {}
): ExplorationAppearanceFrame => ({
  pose: pose(mode),
  spyglass: false,
  visible: true,
  ...changes
});

const fakeBody = (clips: AnimationClip[] = []) => {
  const root = new Group();
  root.name = "fake-tripo-body";
  root.add(new Mesh(new BoxGeometry(1, 1.16, 1), new MeshBasicMaterial()));
  const update = vi.fn();
  const dispose = vi.fn();
  const play = vi.fn();
  const reset = vi.fn(() => ({ play }));
  const clipAction = vi.fn(() => ({ reset }));
  const body = {
    clips,
    dispose,
    entry: {},
    mixer: { clipAction, update } as unknown as AnimationMixer,
    root,
    setTeamColor: vi.fn()
  } as unknown as ExplorationLoadedBody;
  return { body, clipAction, dispose, play, reset, update };
};

const fakeLoader = (body: ExplorationLoadedBody) => {
  const load = vi.fn(async () => body);
  const dispose = vi.fn();
  return { dispose, load, loader: { dispose, load } satisfies ExplorationBodyLoader };
};

describe("exploration portrait appearance", () => {
  it("matches the canonical HUD portrait recipe for every nation and gender", () => {
    const portraitRecipe = new Map(PORTRAITS.map(portrait => [
      `${portrait.nation}/${portrait.gender}`,
      portrait.variant
    ]));
    for (const nation of EXPLORATION_NATIONS) {
      const defaultBody = EXPLORATION_PORTRAIT_BODIES[nation];
      const recipe = portraitRecipe.get(`${nation}/${defaultBody.gender}`);
      expect(defaultBody.variant).toBe(recipe);
      const resolution = resolveExplorationAppearance({ nation });
      expect(resolution.appearance.nation).toBe(nation);
      expect(resolution.appearance.variant).toBe(recipe);
      expect(resolution.gender).toBe(defaultBody.gender);
      expect(resolution.nationFallback).toBe(false);
      expect(resolution.gaps.map(gap => gap.field)).toEqual(
        expect.arrayContaining(["skin", "head", "hair", "facialHair"])
      );
    }
  });

  it("falls back to the Roman portrait for an unsupported nation and reports the gap", () => {
    const resolution = resolveExplorationAppearance({ nation: "atlantis" });
    expect(resolution.appearance).toEqual({
      nation: "roman",
      variant: EXPLORATION_PORTRAIT_BODIES.roman.variant
    });
    expect(resolution.nationFallback).toBe(true);
    expect(resolution.gaps).toContainEqual({
      field: "nation",
      reason: "unsupported",
      requested: "atlantis"
    });
  });

  it("uses a requested gender body and reports an unavailable body or mismatched gender", () => {
    const female = resolveExplorationAppearance({ gender: "female", nation: "viking" });
    expect(female.appearance.variant).toBe("viking-woman-blue");
    expect(female.gender).toBe("female");

    const male = resolveExplorationAppearance({ gender: "male", nation: "viking" });
    expect(male.appearance.variant).toBe("viking-man-blond");
    expect(male.gender).toBe("male");

    const missing = resolveExplorationAppearance({ body: "roman-man-missing", nation: "roman" });
    expect(missing.appearance.variant).toBe("roman-man-white");
    expect(missing.gaps).toContainEqual({
      field: "body",
      reason: "unavailable",
      requested: "roman-man-missing"
    });

    const mismatch = resolveExplorationAppearance({
      body: "roman-woman-grey",
      gender: "male",
      nation: "roman"
    });
    expect(mismatch.appearance.variant).toBe("roman-man-white");
    expect(mismatch.gaps).toContainEqual({
      field: "gender",
      reason: "body-gender-mismatch",
      requested: "male"
    });
  });

  it("keeps requested skin/head/hair/facial-hair as honest baked-body gaps", () => {
    const resolution = resolveExplorationAppearance({
      facialHair: "full beard",
      hair: "braids",
      head: "round",
      nation: "nubian",
      skin: "deep"
    });
    expect(resolution.portrait).toMatchObject({
      facialHair: "full beard",
      hair: "braids",
      head: "round",
      skin: "deep"
    });
    for (const [field, requested] of [["skin", "deep"], ["head", "round"], ["hair", "braids"],
      ["facialHair", "full beard"]] as const)
      expect(resolution.gaps).toContainEqual({
        field,
        reason: "baked-into-body",
        requested
      });
    expect(EXPLORATION_APPEARANCE_ASSET_GAPS.map(gap => gap.id)).toContain("separate-head-geometry");
  });

  it("measures the body rig into a stable ~0.97 world-unit eye height", () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(1, 1.16, 1), new MeshBasicMaterial()));
    const metrics = measureExplorationRig(root);
    expect(metrics.bodyHeight).toBeCloseTo(1.0625);
    expect(metrics.eyeHeight).toBeCloseTo(0.966875);
    const bounds = new Box3().setFromObject(root);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(1.0625);
  });

  it("grounds a body whose native height already matches but whose origin is not at the sole", () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1.0625, 1), new MeshBasicMaterial());
    mesh.position.y = 0.2;
    root.add(mesh);
    const metrics = measureExplorationRig(root);
    expect(metrics.bodyHeight).toBeCloseTo(1.0625);
    const bounds = new Box3().setFromObject(root);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(1.0625);
  });

  it("hides the single-mesh body at eye view and shows it during approach/return", () => {
    expect(explorationBodyVisibility(frame("transition"))).toMatchObject({
      bodyVisible: true,
      headVisible: true,
      reason: "approach",
      spyglassVisible: true
    });
    const eye = explorationBodyVisibility(frame("eye"));
    expect(eye).toMatchObject({ bodyVisible: false, headVisible: false, reason: "eye-level" });
    expect(eye.hiddenParts).toEqual(expect.arrayContaining(["head", "hair", "face", "facialHair"]));
    expect(explorationBodyVisibility(frame("transition", { visible: false })).bodyVisible).toBe(false);
    expect(explorationBodyVisibility(null).bodyVisible).toBe(false);
  });

  it("installs, poses, hides and disposes one explorer body exactly once", async () => {
    const { body, dispose, update } = fakeBody();
    const { dispose: loaderDispose, loader } = fakeLoader(body);
    const parent = new Group();
    const spyglassDispose = vi.fn();
    let time = 0;
    const adapter = createExplorationAppearanceAdapter({
      createSpyglass: () => ({
        dispose: spyglassDispose,
        root: new Group()
      }),
      groundHeight: () => 3,
      loader,
      now: () => time,
      parent,
      portrait: { nation: "roman" }
    });

    const lease = await adapter.acquire(identity);
    expect(parent.children).toHaveLength(1);
    const group = parent.children[0] as Group;
    expect(group.name).toBe("exploration-explorer");
    expect(group.visible).toBe(false);
    expect(lease.eyeHeight()).toBeCloseTo(0.966875);
    expect(lease.descriptor()?.appearance).toEqual({ nation: "roman", variant: "roman-man-white" });
    expect(adapter.stats()).toEqual({ active: true, disposed: false, pending: 0 });

    lease.update(frame("transition"));
    expect(group.visible).toBe(true);
    expect(group.position.toArray()).toEqual([6, 3, 8]);
    expect(group.rotation.y).toBeCloseTo(0.4);
    time = 16;
    lease.update(frame("transition"));
    expect(update).toHaveBeenCalledWith(0.016);

    lease.update(frame("eye"));
    expect(group.visible).toBe(false);
    lease.update(null);
    expect(group.visible).toBe(false);

    lease.dispose();
    lease.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(spyglassDispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(loaderDispose).not.toHaveBeenCalled();

    adapter.dispose();
    adapter.dispose();
    expect(loaderDispose).toHaveBeenCalledTimes(1);
  });

  it("starts the idle clip so the approach body is not left in bind pose", async () => {
    const clip = new AnimationClip("idle_breathe", 1, []);
    const { body, clipAction, play, reset } = fakeBody([clip]);
    const { loader } = fakeLoader(body);
    const adapter = createExplorationAppearanceAdapter({
      createSpyglass: () => ({ dispose: vi.fn(), root: new Group() }),
      groundHeight: () => 0,
      loader,
      parent: new Group(),
      portrait: { nation: "roman" }
    });
    const lease = await adapter.acquire(identity);
    expect(clipAction).toHaveBeenCalledWith(clip);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    lease.dispose();
    adapter.dispose();
  });

  it("releases a late body instead of installing it after disposal", async () => {
    const { body, dispose } = fakeBody();
    let resolveLoad!: (value: ExplorationLoadedBody) => void;
    const loaderDispose = vi.fn();
    const loader: ExplorationBodyLoader = {
      dispose: loaderDispose,
      load: () => new Promise(resolve => { resolveLoad = resolve; })
    };
    const parent = new Group();
    const adapter = createExplorationAppearanceAdapter({
      createSpyglass: () => ({ dispose: vi.fn(), root: new Group() }),
      groundHeight: () => 0,
      loader,
      parent,
      portrait: { nation: "roman" }
    });

    const acquiring = adapter.acquire(identity);
    adapter.dispose();
    expect(parent.children).toHaveLength(0);
    resolveLoad(body);
    await expect(acquiring).rejects.toThrow(/released|disposed/);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(loaderDispose).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale identity before loading and shares a pool without owning it", async () => {
    const { body } = fakeBody();
    const { load, loader } = fakeLoader(body);
    const adapter = createExplorationAppearanceAdapter({
      createSpyglass: () => ({ dispose: vi.fn(), root: new Group() }),
      groundHeight: () => 0,
      isCurrentIdentity: current => current.generation === identity.generation + 1,
      loader,
      parent: new Group(),
      portrait: { nation: "roman" }
    });
    await expect(adapter.acquire(identity)).rejects.toThrow(/Stale/);
    expect(load).not.toHaveBeenCalled();
    adapter.dispose();

    const poolLoad = vi.fn(async () => body);
    const shared = createSharedExplorationBodyLoader({ load: poolLoad as never });
    expect(await shared.load({ nation: "roman", variant: "roman-man-white" })).toMatchObject({
      root: body.root
    });
    shared.dispose();
    expect(poolLoad).toHaveBeenCalledTimes(1);
  });
});

const flushPromises = async () => {
  for (let index = 0; index < 6; index++) await Promise.resolve();
};

describe("live exploration body source", () => {
  it("loads from the current crowd and retries a load that lost its pool", async () => {
    const first = fakeBody();
    const second = fakeBody();
    const firstLoad = vi.fn(async () => first.body);
    const secondLoad = vi.fn(async () => second.body);
    let current: ExplorationBodyLoader = { dispose: vi.fn(), load: firstLoad };
    let revision = 0;
    let notify: (() => void) | undefined;
    const live = createLiveExplorationBodyLoader({
      current: () => current,
      nation: () => "viking",
      revision: () => revision,
      subscribe: listener => {
        notify = listener;
        return () => { notify = undefined; };
      }
    });

    expect(live.nation?.()).toBe("viking");
    expect((await live.load({ nation: "roman", variant: "roman-man-white" })).root)
      .toBe(first.body.root);
    current = { dispose: vi.fn(), load: secondLoad };
    revision++;
    notify?.();
    expect((await live.load({ nation: "viking", variant: "viking-woman-blue" })).root)
      .toBe(second.body.root);
    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(secondLoad).toHaveBeenCalledTimes(1);

    let rejectFirst!: (error: unknown) => void;
    const pending = new Promise<ExplorationLoadedBody>((_resolve, reject) => {
      rejectFirst = reject;
    });
    current = { dispose: vi.fn(), load: vi.fn(() => pending) };
    const loading = live.load({ nation: "nubian", variant: "nubian-man-kilt" });
    current = { dispose: vi.fn(), load: secondLoad };
    revision++;
    rejectFirst(new Error("Asset cache disposed"));
    expect((await loading).root).toBe(second.body.root);
    expect(secondLoad).toHaveBeenCalledTimes(2);
    live.dispose();
  });

  it("rebuilds the active explorer from the replacement crowd and live nation", async () => {
    const roman = fakeBody();
    const viking = fakeBody();
    const loaded: { nation: string; variant: string }[] = [];
    let listener: (() => void) | undefined;
    let useViking = false;
    const loaderDispose = vi.fn();
    const loader: ExplorationBodyLoader = {
      dispose: loaderDispose,
      load: vi.fn(async appearance => {
        loaded.push(appearance);
        return useViking ? viking.body : roman.body;
      }),
      onSourceChange: next => {
        listener = next;
        return () => { listener = undefined; };
      }
    };
    const parent = new Group();
    const adapter = createExplorationAppearanceAdapter({
      createSpyglass: () => ({ dispose: vi.fn(), root: new Group() }),
      groundHeight: () => 0,
      loader,
      parent,
      portrait: () => ({ nation: useViking ? "viking" : "roman" })
    });

    const lease = await adapter.acquire(identity);
    const firstGroup = parent.children[0];
    expect(loaded[0]).toEqual({ nation: "roman", variant: "roman-man-white" });

    useViking = true;
    listener?.();
    await flushPromises();

    expect(loaded[1]).toEqual({ nation: "viking", variant: "viking-woman-blue" });
    expect(lease.descriptor()?.appearance).toEqual({
      nation: "viking",
      variant: "viking-woman-blue"
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).not.toBe(firstGroup);
    expect(roman.dispose).toHaveBeenCalledTimes(1);
    expect(viking.dispose).not.toHaveBeenCalled();

    lease.update(frame("transition"));
    const group = parent.children[0] as Group;
    expect(group.visible).toBe(true);
    expect(group.position.toArray()).toEqual([6, 0, 8]);

    lease.dispose();
    expect(viking.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    adapter.dispose();
    expect(loaderDispose).toHaveBeenCalledTimes(1);
  });

  it("reads the portrait nation when each body is acquired instead of at startup", async () => {
    let nation: "roman" | "viking" = "roman";
    const loaded: { nation: string; variant: string }[] = [];
    const loader: ExplorationBodyLoader = {
      dispose: vi.fn(),
      load: vi.fn(async appearance => {
        loaded.push(appearance);
        return fakeBody().body;
      })
    };
    const adapter = createExplorationAppearanceAdapter({
      createSpyglass: () => ({ dispose: vi.fn(), root: new Group() }),
      groundHeight: () => 0,
      loader,
      parent: new Group(),
      portrait: () => ({ nation })
    });

    const first = await adapter.acquire(identity);
    first.dispose();
    nation = "viking";
    const second = await adapter.acquire(identity);
    second.dispose();

    expect(loaded.map(appearance => appearance.nation)).toEqual(["roman", "viking"]);
    expect(loaded[1]?.variant).toBe("viking-woman-blue");
    adapter.dispose();
  });
});

import { type GLTF,GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { afterEach, expect, it, vi } from "vitest";

import { minimalRiderPath, mountAssetPaths, type MountManifest, type MountRiderEntry } from "../src/render-common/mounts/mount-assets";
import { NATION_RIDERS } from "../src/render-common/mounts/nation-riders";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";
import { loadRiderArmour } from "../src/renderers/three/mount-rider-armour";

vi.mock("../src/render-common/workers/worker-assets", () => ({ WORKER_ASSET_BASE: "http://localhost/workers/" }));

const legacy = ["roman", "viking", "japanese", "nubian"] as const;
const expansion = ["chinese", "persian", "maya", "indigenous"] as const;
const armourSet = (nation: string, id: string) => ({ nation,
  bodies: [{ id, models: { soldier: `${nation}/soldier.glb`, centurion: `${nation}/centurion.glb` },
    files: { helmet: `${nation}/helmet.glb` } }],
  pieces: [{ id: "helmet", ranks: ["soldier", "centurion"], attach: { kind: "rigid" }, roots: ["helmet"] }] });
const mockManifest = (sets = legacy.map(nation => armourSet(nation, NATION_RIDERS[nation]))) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sets }))));
  const loader = new GLTFLoader();
  const load = vi.spyOn(loader, "loadAsync").mockResolvedValue({} as GLTF);
  return { load, loader };
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([...legacy, ...expansion].flatMap(nation =>
  (["soldier", "centurion"] as const).map(rank => ({ nation, rank }))))(
  "loads compatible $rank gear without changing the $nation rider identity", async ({ nation, rank }) => {
    const { load, loader } = mockManifest();
    await loadRiderArmour(loader, nation, rank);
    const source = expansion.includes(nation as typeof expansion[number]) ? "roman" : nation;
    expect(load.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining(`/armour/${source}/${rank}.glb`),
      expect.stringContaining(`/armour/${source}/helmet.glb`)
    ]);
    expect(NATION_RIDERS[nation]).toBe(NATION_RIDERS[source as WorkerNation]);
  });

it("uses legacy mounted gear when a national foot-only armour set has no matching riding body", async () => {
  const sets = [...legacy.map(nation => armourSet(nation, NATION_RIDERS[nation])), armourSet("chinese", "chinese-male-1")];
  const { load, loader } = mockManifest(sets);
  await loadRiderArmour(loader, "chinese", "soldier");
  expect(load.mock.calls[0]![0]).toContain("/armour/roman/soldier.glb");
});

it("prefers an exact compatible national riding set when it exists", async () => {
  const { load, loader } = mockManifest([armourSet("chinese", NATION_RIDERS.chinese)]);
  await loadRiderArmour(loader, "chinese", "centurion");
  expect(load.mock.calls[0]![0]).toContain("/armour/chinese/centurion.glb");
});

it("rejects gear fitted to another body instead of silently binding the wrong rider rig", async () => {
  const { load, loader } = mockManifest([armourSet("roman", "roman-man-grey")]);
  await expect(loadRiderArmour(loader, "indigenous", "soldier")).rejects.toThrow("No rider armour for indigenous");
  expect(load).not.toHaveBeenCalled();
});

const riderEntry = (nation: string, variant: string): MountRiderEntry => ({ nation, variant,
  model: `riders/${variant}/model.glb`, animations: `riders/${variant}/actions.glb`, tunicTint: "#fff" });
it.each(expansion)("prefetches %s's actual fallback rider and matching Minimal body", nation => {
  const roman = riderEntry("roman", "roman-man-white");
  const manifest = { horse: { model: "horse/model.glb", coat: { mask: "horse/coat-mask.png" } },
    riders: legacy.map(source => riderEntry(source, NATION_RIDERS[source])) } as MountManifest;
  for (const detailed of [true, false]) {
    const paths = mountAssetPaths(manifest, new Set([nation]), detailed);
    expect(paths).toContain(roman.animations);
    expect(paths).toContain(minimalRiderPath(roman));
    expect(paths.includes(roman.model)).toBe(detailed);
    expect(paths).not.toContain("riders/japanese-man-linen/model.glb");
  }
});

it.each(legacy)("keeps the %s source rig's Minimal mesh when its display nation changes", nation => {
  const original = riderEntry(nation, NATION_RIDERS[nation]);
  expect(minimalRiderPath({ ...original, nation: "chinese" })).toBe(minimalRiderPath(original));
});

it.each(["nubian", "viking"] as const)("selects the bounded %s Commander surface without replacing ordinary riders", nation => {
  const entry = riderEntry(nation, NATION_RIDERS[nation]);
  expect(minimalRiderPath(entry)).toContain(`${nation}-rider-minimal`);
  expect(minimalRiderPath(entry, true)).toContain(`${nation}-commander-surface`);
  expect(minimalRiderPath({ ...entry, nation: "chinese" }, true)).toBe(minimalRiderPath(entry, true));
  const manifest = { horse: { model: "horse/model.glb", coat: { mask: "horse/coat-mask.png" } }, riders: [entry] } as MountManifest;
  expect(mountAssetPaths(manifest, new Set([nation]), false)).toContain(minimalRiderPath(entry, true));
});

it.each(["roman", "japanese"] as const)("retains the existing %s Commander/ordinary body binding", nation => {
  const entry = riderEntry(nation, NATION_RIDERS[nation]);
  expect(minimalRiderPath(entry, true)).toBe(minimalRiderPath(entry));
});

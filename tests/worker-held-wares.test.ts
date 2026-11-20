import type { ThreeWorkerPack } from "@workers/game-three-worker";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial
} from "three";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import type { createWorkerProp as CreateWorkerProp } from "../src/renderers/three/three-worker-prop";

vi.mock("../src/renderers/three/settlement/ware-material-cache", async () => {
  const { MeshStandardMaterial } = await import("three");
  const material = new MeshStandardMaterial();
  return {
    acquireWareMaterials: () => ({
      materials: new Proxy({}, { get: () => material }),
      release: vi.fn()
    })
  };
});

let createWorkerProp: typeof CreateWorkerProp;
// isolate:false shares the module cache: load the subject fresh so it sees this file's mocks,
// then drop the mocks and the mocked graph so later files of the worker get the real modules.
beforeAll(async () => {
  vi.resetModules();
  ({ createWorkerProp } = await import("../src/renderers/three/three-worker-prop"));
});
afterAll(() => {
  vi.doUnmock("../src/renderers/three/settlement/ware-material-cache");
  vi.resetModules();
});

const frame = (action: WorkerFrame["action"], ware: string | null = null): WorkerFrame => ({
  nation: "roman",
  variant: "base",
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  selected: false,
  action,
  animationTime: 0,
  gaitPhase: 0,
  runBlend: 0,
  target: null,
  carryingWare: ware,
  workerJob: "Builder"
});

it.each([true, false])("attaches tools, front-held iron and other outputs (detailed=%s)", async detailed => {
  const root = new Group();
  root.position.set(11, 2, 7);
  root.rotation.y = 0.6;
  const chest = new Bone();
  chest.name = "chest";
  chest.position.y = 0.76;
  root.add(chest);
  const hand = new Bone();
  hand.name = "socket_hand_R";
  hand.position.set(-0.23, 0.5, 0.025);
  root.add(hand);
  const pack = {
    loadProp: vi.fn(async (name: string) => {
      const scene = new Group();
      scene.name = name;
      scene.add(new Mesh(new BoxGeometry(0.05, 0.3, 0.03), new MeshStandardMaterial()));
      return { scene };
    })
  } as unknown as ThreeWorkerPack;
  const worker = {
    root,
    clips: [
      "build_hammer",
      "chop_tree",
      "carry_shoulder",
      "carry_back",
      "walk",
      "idle_breathe"
    ].map((name) => new AnimationClip(name, 1.3, [])),
    mixer: new AnimationMixer(root)
  } as Awaited<ReturnType<ThreeWorkerPack["load"]>>;
  const held = createWorkerProp(pack, worker, detailed);
  held.update(frame("build_hammer"));
  await vi.waitFor(() => expect(root.getObjectByName("hammer")).toBeDefined());
  held.update(frame("build_hammer"));
  const hammer = root.getObjectByName("hammer")!;
  expect(hammer.visible).toBe(true);
  const firstPosition = hammer.position.clone();
  held.update({ ...frame("build_hammer"), animationTime: 0.6 });
  expect(hammer.position.equals(firstPosition)).toBe(false);
  held.update({ ...frame("walk"), workerJob: "Settler", workerTool: "hammer" });
  expect(hammer.visible).toBe(true);
  expect(hammer.position.x).toBeCloseTo(-0.23);
  expect(hammer.position.y).toBeCloseTo(0.445);
  held.update({ ...frame("idle_breathe"), workerJob: "Settler", workerTool: undefined });
  expect(hammer.visible).toBe(false);
  held.update(frame("chop_tree"));
  await vi.waitFor(() => expect(root.getObjectByName("axe")).toBeDefined());
  held.update(frame("chop_tree"));
  expect(root.getObjectByName("axe")!.visible).toBe(true);
  expect(hammer.visible).toBe(false);
  for (const [action, ware] of [
    ["carry_shoulder", "logs"],
    ["carry_shoulder", "planks"],
    ["carry_back", "fish"],
    ["carry_shoulder", "stone"],
    ["carry_back", "iron"],
    ["carry_back", "coal"]
  ] as const) {
    held.update(frame(action, ware));
    // The first visible carrying frame already has its load, with no asynchronous pop-in.
    expect(root.getObjectByName(`ware_${ware}`)?.visible).toBe(true);
    held.update(frame(action, ware));
    const cargo = root.getObjectByName(`ware_${ware}`)!;
    expect(cargo.visible).toBe(true);
    expect(cargo.userData.ware).toBe(ware);
    if (ware === "fish" || ware === "stone" || ware === "iron") {
      const height = ware === "iron" ? .84 : .79;
      expect(cargo.position.y).toBeCloseTo(ware === "fish" ? .68 : height);
      expect(cargo.position.x).toBe(0);
      expect(cargo.position.z).toBeGreaterThan(.1);
    } else {
      expect(cargo.position.y).toBeCloseTo(action === "carry_shoulder" ? .895 : .86);
      expect(cargo.position.x).toBeCloseTo(action === "carry_shoulder" ? .178 : 0);
    }
  }
  held.update(frame("idle_breathe"));
  expect(root.getObjectByName("ware_iron")!.visible).toBe(false);
  held.update(frame("carry_back", "iron"));
  expect(root.getObjectByName("ware_iron")!.visible).toBe(true);
  expect(root.getObjectByName("ware_iron")!.position.z).toBeGreaterThan(0);
  held.update(frame("chop_tree"));
  expect(pack.loadProp).toHaveBeenCalledTimes(2);
  expect(root.getObjectByName("axe")!.visible).toBe(true);
  expect(root.getObjectByName("ware_coal")!.visible).toBe(false);
  held.dispose();
});

it("equips a soldier with an actual gladius and left-hand shield, then removes both on retirement", async () => {
  const root = new Group();
  root.position.set(6, 1, 9);
  root.rotation.y = 0.7;
  for (const side of ["R", "L"]) {
    const hand = new Bone();
    hand.name = `socket_hand_${side}`;
    hand.position.set(side === "R" ? -0.2 : 0.2, 0.6, 0.04);
    root.add(hand);
  }
  const pack = { loadProp: vi.fn() } as unknown as ThreeWorkerPack;
  const worker = {
    root,
    clips: [new AnimationClip("walk", 1, []), new AnimationClip("idle_breathe", 1, [])],
    mixer: new AnimationMixer(root)
  } as Awaited<ReturnType<ThreeWorkerPack["load"]>>;
  const controller = createWorkerProp(pack, worker, false);
  const soldier = { ...frame("walk"), workerJob: "Soldier", workerTool: "sword" };
  controller.update(soldier);
  await vi.waitFor(() =>
    expect(root.children.filter((child) => child.userData.ware).length).toBe(2)
  );
  controller.update(soldier);
  const sword = root.children.find((child) => child.userData.ware === "sword")!;
  const shield = root.children.find((child) => child.userData.ware === "shield")!;
  expect(sword.visible).toBe(true);
  expect(shield.visible).toBe(true);
  expect(sword.position.x).toBeCloseTo(-0.2);
  expect(shield.position.x).toBeCloseTo(0.2);
  expect(sword.position.y).toBeCloseTo(0.6);
  expect(shield.position.y).toBeCloseTo(0.6);
  expect(pack.loadProp).not.toHaveBeenCalled();
  controller.update({ ...frame("idle_breathe"), workerJob: "Settler", workerTool: undefined });
  expect(sword.visible).toBe(false);
  expect(shield.visible).toBe(false);
  controller.dispose();
});

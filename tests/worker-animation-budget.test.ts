import { OrthographicCamera } from "three";
import { describe, expect, it, vi } from "vitest";

import type { MountFrame } from "../src/render-common/mounts/mount-frame";
import { WORKER_HEIGHT } from "../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createMountAnimationBudget } from "../src/renderers/three/mount-animation-budget";
import {
  classifyWorkerTier,
  createWorkerAnimationBudget,
  isWorkerActiveContact,
  mixStableId,
  updateWorkerAnimation,
  WORKER_ANIMATION_FULL_SCREEN_FRACTION,
  WORKER_ANIMATION_HALF_SCREEN_FRACTION,
  WORKER_ANIMATION_THIRD_SCREEN_FRACTION,
  workerAnimationCadence,
  workerAnimationPhase,
  workerScreenFraction
} from "../src/renderers/three/worker-animation-budget";

/**
 * The real isometric framing (tier-distribution fixture): 1600x1000, 64/sqrt2 pixels per world
 * unit, 30-degree pitch. Zoom 1 keeps workers above the full-cadence threshold, zoom .5 is half,
 * zoom .2 is quarter.
 */
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
const PIXELS_PER_UNIT = 64 / Math.SQRT2;
const PITCH = Math.PI / 6;
/** The budget measures head above the +.05 foot sample, not the abstract model origin. */
const PROJECTED_WORKER_HEIGHT = WORKER_HEIGHT - .05;

const isoCamera = (zoom: number) => {
  const halfHeight = VIEWPORT_HEIGHT / 2 / (PIXELS_PER_UNIT * zoom);
  const halfWidth = VIEWPORT_WIDTH / 2 / (PIXELS_PER_UNIT * zoom);
  const camera = new OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 1800);
  const horizontal = Math.cos(PITCH) / Math.SQRT2;
  camera.position.set(horizontal * 600, Math.sin(PITCH) * 600, horizontal * 600);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
};

/** Zoom that projects a worker to the requested fraction of viewport height. */
const zoomForFraction = (fraction: number) =>
  fraction * VIEWPORT_HEIGHT / (PROJECTED_WORKER_HEIGHT * Math.cos(PITCH) * PIXELS_PER_UNIT);

const actor = (overrides: Partial<WorkerFrame> = {}): WorkerFrame => ({
  actorId: 1,
  nation: "roman",
  variant: "man",
  x: 40,
  y: 0,
  z: 40,
  heading: 0,
  selected: false,
  action: "idle_breathe",
  animationTime: 0,
  gaitPhase: 0,
  runBlend: 0,
  target: null,
  ...overrides
});

/** Step the presentation clock until the state reaches the requested tier. */
const settleTier = (
  budget: ReturnType<typeof createWorkerAnimationBudget>,
  camera: OrthographicCamera,
  state: ReturnType<typeof budget.newState>,
  frame: WorkerFrame,
  tier: number
) => {
  let time = 0;
  budget.beginFrame(camera, time);
  budget.due(state, frame);
  while (state.tier < tier) {
    time += .5;
    budget.beginFrame(camera, time);
    budget.due(state, frame);
  }
  return time;
};

describe("worker animation budget", () => {
  it("classifies projected size, focus distance and contact into four cadence tiers", () => {
    expect(classifyWorkerTier(WORKER_ANIMATION_FULL_SCREEN_FRACTION, 100, false)).toBe(0);
    expect(classifyWorkerTier(WORKER_ANIMATION_FULL_SCREEN_FRACTION - .0001, 100, false)).toBe(1);
    expect(classifyWorkerTier(WORKER_ANIMATION_HALF_SCREEN_FRACTION, 100, false)).toBe(1);
    expect(classifyWorkerTier(WORKER_ANIMATION_HALF_SCREEN_FRACTION - .0001, 100, false)).toBe(2);
    expect(classifyWorkerTier(WORKER_ANIMATION_THIRD_SCREEN_FRACTION, 100, false)).toBe(2);
    expect(classifyWorkerTier(WORKER_ANIMATION_THIRD_SCREEN_FRACTION - .0001, 100, false)).toBe(3);

    expect(classifyWorkerTier(.001, 6, false)).toBe(0);
    expect(classifyWorkerTier(.001, 6.1, false)).toBe(1);
    expect(classifyWorkerTier(.001, 14, false)).toBe(1);
    expect(classifyWorkerTier(.001, 14.1, false)).toBe(2);
    expect(classifyWorkerTier(.001, 28, false)).toBe(2);
    expect(classifyWorkerTier(.001, 28.1, false)).toBe(3);

    // Nearby contact pins full; a distant, tiny contact may still be demoted.
    expect(classifyWorkerTier(.008, 100, true)).toBe(0);
    expect(classifyWorkerTier(.0079, 25, true)).toBe(0);
    expect(classifyWorkerTier(.0079, 25.1, true)).toBe(2);
    expect(classifyWorkerTier(.0079, 100, true)).toBe(3);

    const distance = Math.hypot(20, 20);
    expect(classifyWorkerTier(workerScreenFraction(isoCamera(1), 20, 0, 20), distance, false)).toBe(0);
    expect(classifyWorkerTier(workerScreenFraction(isoCamera(.5), 20, 0, 20), distance, false)).toBe(1);
    expect(classifyWorkerTier(workerScreenFraction(isoCamera(.2), 20, 0, 20), distance, false)).toBe(3);
    expect(workerScreenFraction(isoCamera(1), 20, 0, 20)).toBeCloseTo(
      PROJECTED_WORKER_HEIGHT * Math.cos(PITCH) * PIXELS_PER_UNIT / VIEWPORT_HEIGHT, 12);
  });

  it("treats handoffs, work, combat and hand contacts as active while plain idle is not", () => {
    const transfer = { direction: "pickup" as const, progress: .5, target: { x: 0, y: 0, z: 0 }, ware: "logs" };
    expect(isWorkerActiveContact(actor({ wareTransfer: transfer }))).toBe(true);
    expect(isWorkerActiveContact(actor({ fieldWork: "sow" }))).toBe(true);
    expect(isWorkerActiveContact(actor({ shipHullWork: true }))).toBe(true);
    expect(isWorkerActiveContact(actor({ action: "build_hammer" }))).toBe(true);
    expect(isWorkerActiveContact(actor({ action: "push_trunk" }))).toBe(true);
    expect(isWorkerActiveContact(actor({
      combat: { attackProgress: null, faction: 0, type: "shield" }
    }))).toBe(true);
    expect(isWorkerActiveContact(actor({
      combat: { attackProgress: .3, faction: 0, type: "shield" }
    }))).toBe(true);
    expect(isWorkerActiveContact(actor({
      combat: { attackProgress: null, defending: true, faction: 0, type: "shield" }
    }))).toBe(true);
    expect(isWorkerActiveContact(actor({
      combat: { attackProgress: null, faction: 0, flinch: .2, type: "shield" }
    }))).toBe(true);
    expect(isWorkerActiveContact(actor({ fall: .3 }))).toBe(true);
    expect(isWorkerActiveContact(actor({ action: "walk" }))).toBe(false);
    expect(isWorkerActiveContact(actor({ action: "idle_breathe", carryingWare: "logs" }))).toBe(false);
  });

  it("gives every cadence tier its exact share of pose frames", () => {
    const fractions = [.04, .025, .012, .00625];
    const cadences = [1, 2, 3, 4];
    for (const [tier, fraction] of fractions.entries()) {
      const budget = createWorkerAnimationBudget();
      const camera = isoCamera(zoomForFraction(fraction));
      const frame = actor({ actorId: 70 + tier });
      const state = budget.newState();
      let time = settleTier(budget, camera, state, frame, tier);
      let poses = 0;
      for (let index = 0; index < 12; index++) {
        time += 1 / 60;
        budget.beginFrame(camera, time);
        if (budget.due(state, frame)) poses++;
      }
      expect(state.tier).toBe(tier);
      expect(poses).toBe(12 / cadences[tier]!);
    }
  });

  it("forces the next frame's pose after a view reset, even when the cadence would skip it (C11)", () => {
    const budget = createWorkerAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    const frame = actor({ actorId: 150 });
    const state = budget.newState();
    let time = settleTier(budget, camera, state, frame, 3);
    expect(state.tier).toBe(3);
    let skipped = false;
    for (let index = 0; index < 8 && !skipped; index++) {
      time += 1 / 60;
      budget.beginFrame(camera, time);
      skipped = !budget.due(state, frame);
    }
    expect(skipped).toBe(true);
    budget.resetTiers();
    time += 1 / 60;
    budget.beginFrame(camera, time);
    expect(budget.due(state, frame)).toBe(true);
  });

  it("slows only reduced tiers under the budget controller's cadence bias (C13)", () => {
    expect([0, 1, 2, 3].map(tier => workerAnimationCadence(tier as 0 | 1 | 2 | 3, 0))).toEqual([1, 2, 3, 4]);
    expect([0, 1, 2, 3].map(tier => workerAnimationCadence(tier as 0 | 1 | 2 | 3, 1))).toEqual([1, 3, 4, 6]);
    expect([0, 1, 2, 3].map(tier => workerAnimationCadence(tier as 0 | 1 | 2 | 3, 2))).toEqual([1, 4, 6, 8]);
    expect(workerAnimationCadence(3, 9)).toBe(8);
    const bias = { bias: 2, floor: 0 };
    const budget = createWorkerAnimationBudget(bias);
    const camera = isoCamera(zoomForFraction(.00625));
    const frame = actor({ actorId: 90 });
    const state = budget.newState();
    let time = settleTier(budget, camera, state, frame, 3);
    let poses = 0;
    for (let index = 0; index < 24; index++) {
      time += 1 / 60;
      budget.beginFrame(camera, time);
      if (budget.due(state, frame)) poses++;
    }
    expect(poses).toBe(3);
    const selected = budget.newState();
    let selectedPoses = 0;
    for (let index = 0; index < 8; index++) {
      budget.beginFrame(camera, time += 1 / 60);
      if (budget.due(selected, actor({ actorId: 91, selected: true }))) selectedPoses++;
    }
    expect(selectedPoses).toBe(8);
  });

  it("keeps phase offsets stable per cadence and spread across every phase", () => {
    const ids = Array.from({ length: 24 }, (_, index) => 200 + index);
    for (const cadence of [1, 2, 3, 4]) {
      const phases = ids.map(id => workerAnimationPhase(id, cadence));
      expect(Math.min(...phases)).toBe(0);
      expect(Math.max(...phases)).toBe(cadence - 1);
      expect(new Set(phases).size).toBe(cadence);
      // Recomputing from the same actor ID is stable: no array position or RNG.
      expect(ids.map(id => workerAnimationPhase(id, cadence))).toEqual(phases);
    }
    expect(mixStableId(1)).not.toBe(mixStableId(2));
  });

  it("demotes one tier at a time after the hold and beyond the 15% band, but promotes at once", () => {
    const budget = createWorkerAnimationBudget();
    const frame = actor({ actorId: 7 });
    const state = budget.newState();
    const at = (fraction: number, time: number) => {
      budget.beginFrame(isoCamera(zoomForFraction(fraction)), time);
      budget.due(state, frame);
    };

    at(.035, 0);
    expect(state.tier).toBe(0);
    at(.035, .39);
    expect(state.tier).toBe(0);
    // .035 is below the full boundary but inside the 15% band: no demotion yet.
    at(.035, .41);
    expect(state.tier).toBe(0);
    at(.030, 1);
    expect(state.tier).toBe(1);
    at(.005, 1.39);
    expect(state.tier).toBe(1);
    at(.005, 1.41);
    expect(state.tier).toBe(2);
    // The focus boundary also keeps a band: 56 cells is beyond the third band only.
    at(.005, 1.80);
    expect(state.tier).toBe(2);
    at(.005, 1.82);
    expect(state.tier).toBe(3);
    at(.05, 1.83);
    expect(state.tier).toBe(0);
  });

  it("staggers distant actors by stable actor ID, independent of frame-array order", () => {
    const ids = Array.from({ length: 8 }, (_, index) => 100 + index);
    const camera = isoCamera(zoomForFraction(.00625));

    const run = (order: readonly number[]) => {
      const budget = createWorkerAnimationBudget();
      const states = new Map(ids.map(id => [id, budget.newState()]));
      const frames = new Map(ids.map(id => [id, actor({ actorId: id })]));
      let time = 0;
      // Four demotions take every state from full to quarter cadence.
      for (let step = 0; step < 5; step++) {
        budget.beginFrame(camera, time);
        for (const id of order) budget.due(states.get(id)!, frames.get(id)!);
        time += .5;
      }
      expect([...states.values()].every(state => state.tier === 3)).toBe(true);
      const patterns = new Map(ids.map(id => [id, [] as boolean[]]));
      for (let index = 0; index < 16; index++) {
        budget.beginFrame(camera, 3 + index / 60);
        for (const id of order) patterns.get(id)!.push(budget.due(states.get(id)!, frames.get(id)!));
      }
      return patterns;
    };

    const forward = run(ids);
    const reverse = run([...ids].reverse());
    const phases = new Set(ids.map(id => mixStableId(id) & 3));
    expect([...phases].sort((left, right) => left - right)).toEqual([0, 1, 2, 3]);
    for (const id of ids) {
      const pattern = forward.get(id)!;
      // 16 recorded frames at quarter cadence: exactly four pose refreshes.
      expect(pattern.filter(Boolean)).toHaveLength(4);
      const phase = mixStableId(id) & 3;
      expect(pattern).toEqual(Array.from({ length: 16 }, (_, index) => (6 + index + phase) % 4 === 0));
      // Reordering the compact frame array cannot change any actor's cadence.
      expect(reverse.get(id)).toEqual(pattern);
    }
  });

  it("forces a refresh on camera entry, off-screen entry, action and selection changes", () => {
    const budget = createWorkerAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    const frame = actor({ actorId: 21 });
    const state = budget.newState();
    let time = settleTier(budget, camera, state, frame, 3);
    time += .5;

    // No camera (preparation) and the first camera frame are both full cadence.
    budget.beginFrame(undefined, time);
    expect(budget.due(state, frame)).toBe(true);
    budget.beginFrame(camera, time + .1);
    expect(budget.due(state, frame)).toBe(true);
    time += .1;
    // Camera entry resets hysteresis; settle back to quarter cadence with the clock.
    for (let step = 0; step < 4 && state.tier < 3; step++) {
      time += .5;
      budget.beginFrame(camera, time);
      budget.due(state, frame);
    }
    expect(state.tier).toBe(3);

    // Find a frame on which the distant actor is not due, then change its action.
    let skipped = false;
    for (let index = 0; index < 8 && !skipped; index++) {
      time += 1 / 60;
      budget.beginFrame(camera, time);
      skipped = !budget.due(state, frame);
    }
    expect(skipped).toBe(true);
    const changedAction = { ...frame, action: "look_around" as const };
    budget.beginFrame(camera, time + 1 / 60);
    expect(budget.due(state, changedAction)).toBe(true);

    // An off-screen actor is refreshed within cadence - 1 frames on its stable phase.
    time += 1 / 60;
    budget.offscreen(state);
    budget.beginFrame(camera, time + 1 / 60);
    let posed = budget.due(state, changedAction);
    let entryFrames = 0;
    while (!posed && entryFrames < 3) {
      entryFrames++;
      budget.beginFrame(camera, time + (1 + entryFrames) / 60);
      posed = budget.due(state, changedAction);
    }
    expect(posed).toBe(true);
    expect(entryFrames).toBeLessThanOrEqual(3);

    // Selection bypasses hysteresis and forces full immediately, even on entry.
    time += 4 / 60;
    budget.offscreen(state);
    budget.beginFrame(camera, time);
    expect(budget.due(state, { ...changedAction, selected: true })).toBe(true);
    expect(state.tier).toBe(0);
  });

  it.each([
    ["carrying ware", { carryingWare: "logs", action: "carry_shoulder" as const }],
    ["held tool", { workerTool: "axe" }],
    ["armour rank", { armourRank: "soldier" as const }],
    ["field work", { fieldWork: "sow" as const }],
    ["ship hull work", { shipHullWork: true }]
  ])("forces a pose when the %s changes on a skipped frame", (_, change) => {
    const budget = createWorkerAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    const frame = actor({ actorId: 33 });
    const state = budget.newState();
    let time = settleTier(budget, camera, state, frame, 3);
    let skipped = false;
    for (let index = 0; index < 8 && !skipped; index++) {
      time += 1 / 60;
      budget.beginFrame(camera, time);
      skipped = !budget.due(state, frame);
    }
    expect(skipped).toBe(true);
    budget.beginFrame(camera, time + 1 / 60);
    expect(budget.due(state, { ...frame, ...change })).toBe(true);
  });

  it("skips pose work for a distant actor while its visible position still updates every frame", () => {
    const budget = createWorkerAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    let frame = actor({ actorId: 44 });
    const state = budget.newState();
    const present = vi.fn((next: WorkerFrame) => next.x);
    const animate = vi.fn();
    const work = { present, animate };
    let time = 0;
    for (let index = 0; index < 5; index++) {
      budget.beginFrame(camera, time);
      updateWorkerAnimation(budget, state, frame, work);
      time += .5;
    }
    expect(state.tier).toBe(3);
    const warmPresents = present.mock.calls.length;
    const warmAnimates = animate.mock.calls.length;

    let skipped = 0;
    for (let index = 0; index < 8; index++) {
      frame = { ...frame, x: frame.x + .01 };
      budget.beginFrame(camera, time);
      if (!updateWorkerAnimation(budget, state, frame, work)) skipped++;
      time += 1 / 60;
    }
    expect(skipped).toBeGreaterThan(0);
    // Position/selection presentation ran every frame; phase work only on due frames.
    expect(present.mock.calls.length).toBe(warmPresents + 8);
    expect(animate.mock.calls.length).toBe(warmAnimates + 8 - skipped);
    expect(present.mock.calls.at(-1)![0].x).toBe(frame.x);
  });

  it("retains the last pose on a skipped frame while presenting the new position", () => {
    const budget = createWorkerAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    let frame = actor({ actorId: 46, x: 40, z: 40 });
    const state = budget.newState();
    let presentX = 0, posedX = -1;
    const work = {
      present: (next: WorkerFrame) => { presentX = next.x; },
      animate: (next: WorkerFrame) => { posedX = next.x; }
    };
    for (let step = 0; step < 6; step++) {
      budget.beginFrame(camera, step * .5);
      updateWorkerAnimation(budget, state, frame, work);
    }
    expect(state.tier).toBe(3);

    let skipped = false;
    for (let step = 0; step < 8 && !skipped; step++) {
      frame = { ...frame, x: frame.x + .01 };
      const poseBefore = posedX;
      budget.beginFrame(camera, 3 + step / 60);
      const posed = updateWorkerAnimation(budget, state, frame, work);
      if (posed) continue;
      skipped = true;
      expect(posedX).toBe(poseBefore);
      expect(presentX).toBe(frame.x);
    }
    expect(skipped).toBe(true);
  });

  it("never writes the frame, simulation or RNG state", () => {
    const budget = createWorkerAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    const frame = Object.freeze(actor({ actorId: 55, selected: true }));
    const snapshot = JSON.stringify(frame);
    const state = budget.newState();
    const random = vi.spyOn(Math, "random");
    for (let index = 0; index < 12; index++) {
      budget.beginFrame(camera, index / 10);
      budget.due(state, frame);
    }
    expect(JSON.stringify(frame)).toBe(snapshot);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe("mount animation budget (C02 e)", () => {
  const mount = (overrides: Partial<MountFrame> = {}): MountFrame => ({
    actorId: 1,
    clip: "walk",
    clipTime: 0,
    coat: "bay",
    heading: 0,
    rider: "roman-man",
    turnRate: 0,
    x: 40,
    y: 0,
    z: 40,
    ...overrides
  });

  const settleTier = (
    budget: ReturnType<typeof createMountAnimationBudget>,
    camera: OrthographicCamera,
    state: ReturnType<typeof budget.newState>,
    frame: MountFrame,
    tier: number
  ) => {
    let time = 0;
    budget.beginFrame(camera, time);
    budget.due(state, frame);
    while (state.tier < tier) {
      time += .5;
      budget.beginFrame(camera, time);
      budget.due(state, frame);
    }
    return time;
  };

  it("keeps a preview mount (no camera or no actor identity) on full cadence", () => {
    const budget = createMountAnimationBudget();
    const state = budget.newState();
    const frame = mount();
    for (let index = 0; index < 4; index++) {
      budget.beginFrame(undefined, index / 10);
      expect(budget.due(state, frame)).toBe(true);
    }
    const camera = isoCamera(zoomForFraction(.00625));
    const preview = mount({ actorId: undefined });
    for (let index = 0; index < 4; index++) {
      budget.beginFrame(camera, index / 10);
      expect(budget.due(state, preview)).toBe(true);
    }
  });

  it("poses a distant mount on its tier cadence", () => {
    const budget = createMountAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    const frame = mount({ actorId: 70 });
    const state = budget.newState();
    let time = settleTier(budget, camera, state, frame, 3);
    let poses = 0;
    for (let index = 0; index < 12; index++) {
      time += 1 / 60;
      budget.beginFrame(camera, time);
      if (budget.due(state, frame)) poses++;
    }
    expect(state.tier).toBe(3);
    expect(poses).toBe(3);
  });

  it("pins a selected or fighting mount near the view to full cadence", () => {
    const budget = createMountAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    const selected = mount({ actorId: 71, selected: true });
    const fighting = mount({ actorId: 72, attackProgress: .4, x: 2, z: 2 });
    for (const frame of [selected, fighting]) {
      const state = budget.newState();
      let time = 0;
      for (let index = 0; index < 4; index++) {
        time += .5;
        budget.beginFrame(camera, time);
        expect(budget.due(state, frame)).toBe(true);
      }
      expect(state.tier).toBe(0);
    }
  });

  it("forces a pose when the clip changes on a skipped frame", () => {
    const budget = createMountAnimationBudget();
    const camera = isoCamera(zoomForFraction(.00625));
    const frame = mount({ actorId: 73 });
    const state = budget.newState();
    let time = settleTier(budget, camera, state, frame, 3);
    let skipped = false;
    for (let index = 0; index < 8 && !skipped; index++) {
      time += 1 / 60;
      budget.beginFrame(camera, time);
      skipped = !budget.due(state, frame);
    }
    expect(skipped).toBe(true);
    budget.beginFrame(camera, time + 1 / 60);
    expect(budget.due(state, { ...frame, clip: "trot" })).toBe(true);
  });
});

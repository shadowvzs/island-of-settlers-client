import { expect, it } from "vitest";

import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import { LOADED_RUN_BLEND, RUN_SPEED, WALK_SPEED } from "../src/render-common/workers/worker-gait";
import { getWorkerHeldProp } from "../src/render-common/workers/worker-job-actions";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { recordMovementOutcome } from "../src/shared/settlement/settlement-navigation-recovery";
import { createActor } from "../src/shared/settlement/settlement-paths";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";

it("keeps visible embarked passengers attached to their ship pose without smoothing or civilian nudges", () => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const passenger = { uid: 0, x: 12, y: 3, z: 14, yaw: .5, job: "Soldier", action: "idle",
    visible: true, phase: "navalAboard", ware: null, tool: "sword", animationTime: 0,
    path: [], pathIndex: 0 } as unknown as SettlementActor;
  const civilian = { ...passenger, uid: 1, job: "Settler" };
  frames.updateWorkers([passenger, civilian], .1);
  Object.assign(passenger, { x: 15, y: 4, z: 16, yaw: 1 });
  Object.assign(civilian, { x: 15.1, y: 4, z: 16 });
  frames.updateWorkers([passenger, civilian], .1, [], .25);
  const drawn = frames.workers.find(worker => worker.actorId === passenger.uid)!;
  expect(drawn).toMatchObject({ x: 15, y: 4, z: 16, heading: 1, workerTool: "sword", visible: true });
});

it("reuses actual worker slots, advances motion by distance and preserves carried tools until arrival", () => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, target: null } as WorkerFrame;
  const supplied = Array.from({ length: 20 }, () => ({ ...template }));
  const frames = createSettlementRenderFrames(supplied);
  expect(frames.workers).toHaveLength(0);
  expect(frames.workers.every((worker) => worker.visible === false)).toBe(true);
  const actor = { uid: 0, x: 5, y: 0, z: 5, yaw: 0, job: "Settler", action: "walk",
    visible: true, ware: null, tool: "hammer", animationTime: 0, path: [{ x: 6, z: 5 }], pathIndex: 0 } as SettlementActor;
  frames.updateWorkers([actor], 0.1);
  actor.x += 0.1; frames.updateWorkers([actor], 0.1);
  expect(frames.workers[0]!.gaitPhase).toBeGreaterThan(0);
  expect(frames.workers[0]!.workerTool).toBe("hammer");
  actor.visible = false; actor.tool = undefined;
  frames.updateWorkers([actor], 0.1);
  expect(frames.workers).toHaveLength(0);
  expect(supplied[0]!.workerTool).toBeUndefined();
});

it.each([0.9, 1.2, 1.8])("selects a ground-matched walk blend, never a loaded run, at %s cells per second", (speed) => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 0, x: 0, y: 0, z: 0, yaw: 0, job: "Carrier", action: "carry",
    visible: true, ware: "logs", animationTime: 0, path: [], pathIndex: 0 } as unknown as SettlementActor;
  frames.updateWorkers([actor], 0.1);
  actor.z = speed * 0.1;
  frames.updateWorkers([actor], 0.1);
  const blend = Math.min(LOADED_RUN_BLEND, Math.max(0, Math.min(1, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED))));
  expect(frames.workers[0]!.runBlend).toBeCloseTo(blend, 8);
  const phase = frames.workers[0]!.gaitPhase;
  actor.action = "idle";
  frames.updateWorkers([actor], 1);
  expect(frames.workers[0]!.runBlend).toBeCloseTo(blend, 8);
  expect(frames.workers[0]!.gaitPhase).toBe(phase);
});

it.each(["logs", "coal"])("locks loaded %s steps to actual travel and freezes a waiting carrier", (ware) => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 0, x: 0, y: 0, z: 0, yaw: 0, job: "Carrier", action: "carry",
    visible: true, ware, animationTime: 10, path: [], pathIndex: 0 } as unknown as SettlementActor;
  frames.updateWorkers([actor], 0.1);
  // Exactly one authored loaded gait cycle: stride sweep / stance, scaled into world cells.
  actor.z = 0.36 * 0.78 / 0.58 * WORKER_SCALE;
  frames.updateWorkers([actor], 0.2);
  expect(frames.workers[0]!.animationTime).toBeCloseTo(ware === "logs" ? 1.4 : 1.45, 8);
  const time = frames.workers[0]!.animationTime;
  actor.action = "idle";
  frames.updateWorkers([actor], 5);
  expect(frames.workers[0]!.animationTime).toBe(time);
});


it.each([60, 144])("keeps a fixed-step builder's gait stable at %s render frames per second", (fps) => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 0, x: 0, y: 0, z: 0, yaw: 0, job: "Builder", action: "walk",
    visible: true, ware: null, tool: "hammer", locomotionSpeed: .9,
    animationTime: 0, path: [{ x: 10, z: 0 }], pathIndex: 0 } as SettlementActor;
  frames.updateWorkers([actor], 0);
  const expected = Math.max(0, Math.min(1, (.9 - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
  let accumulator = 0;
  for (let index = 0; index < fps * 2; index++) {
    const delta = (index % 2 === 0 ? .8 : 1.2) / fps;
    accumulator += delta;
    while (accumulator >= .05) {
      actor.x += .9 * .05;
      accumulator -= .05;
    }
    const previousX = frames.workers[0]!.x;
    const previousPhase = frames.workers[0]!.gaitPhase;
    frames.updateWorkers([actor], delta);
    if (actor.x > 0) expect(frames.workers[0]!.runBlend).toBeCloseTo(expected, 8);
    if (actor.x === previousX) expect(frames.workers[0]!.gaitPhase).toBe(previousPhase);
  }
  actor.action = "work";
  frames.updateWorkers([actor], 1 / fps);
  expect(frames.workers[0]!.action).toBe("build_hammer");
  expect(frames.workers[0]!.runBlend).toBe(0);
  actor.action = "walk";
  actor.x += .9 * .05;
  frames.updateWorkers([actor], 1 / fps);
  expect(frames.workers[0]!.runBlend).toBeCloseTo(expected, 8);
  expect(frames.workers[0]!.workerTool).toBe("hammer");
});

it("keeps delivered upgrade materials in the frame until the builder starts and exposes progress",()=>{
  const frames=createSettlementRenderFrames([{nation:"roman",variant:"test"} as WorkerFrame]);
  const hq={uid:0,typeId:0,x:8,y:0,z:8,rotation:0,construction:1,door:0,input:{},output:{},
    workshopUpgrade:{level:0,requested:true,reserved:{planks:2},incoming:{stone:1},progress:0}} as unknown as SettlementBuilding;
  frames.updateBuildings([hq]);
  let frame=frames.buildings[0]!;
  expect(frame.upgradeStock).toEqual({planks:2});
  expect(frame.upgradeProgress).toBe(0);
  hq.workshopUpgrade!.progress=.35;
  frames.updateBuildings([hq]);
  frame=frames.buildings[0]!;
  expect(frame.upgradeStock).toEqual({planks:2});
  expect(frame.upgradeProgress).toBe(.35);
  hq.workshopUpgrade!.requested=undefined;
  frames.updateBuildings([hq]);
  expect(frames.buildings[0]!.upgradeStock).toBeUndefined();
  expect(frames.buildings[0]!.upgradeProgress).toBeUndefined();
});

it("removes demolished plans and models from render frames and their ID cache",()=>{
  const template={nation:"roman",variant:"test",x:0,y:0,z:0,heading:0,selected:false,action:"idle_breathe",animationTime:0,gaitPhase:0,runBlend:0,target:null} as WorkerFrame;
  const frames=createSettlementRenderFrames([template]);
  const hq={uid:0,typeId:0,x:8,y:0,z:8,rotation:0,construction:1,door:0,input:{},output:{}} as SettlementBuilding;
  const plan={...hq,uid:1,typeId:17,construction:0} as SettlementBuilding;
  frames.updateBuildings([hq,plan]);expect(frames.buildings).toHaveLength(2);
  frames.updateBuildings([hq]);expect(frames.buildings.map(frame=>frame.id)).toEqual(["settlement-0"]);
  const replacement={...plan,uid:2,construction:1};
  frames.updateBuildings([hq,replacement]);expect(frames.buildings.map(frame=>frame.id)).toEqual(["settlement-0","settlement-2"]);
});

it("keeps sparse high actor IDs visible without allocating idle slots", () => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const supplied = Array.from({ length: 100 }, () => ({ ...template }));
  const frames = createSettlementRenderFrames(supplied);
  expect(frames.workers).toHaveLength(0);
  const actor = { uid: 10099, x: 4, y: 1, z: 6, yaw: .5, visible: true, job: "Carrier",
    ware: null, action: "idle", path: [], pathIndex: 0, animationTime: 0 } as unknown as SettlementActor;
  frames.updateWorkers([actor], .1);
  expect(frames.workers.filter(worker => worker.visible)).toHaveLength(1);
  expect(frames.workers[0]).toMatchObject({ actorId: 10099, visible: true, x: 4, y: 1, z: 6, workerJob: "Carrier" });
  frames.updateWorkers([], .1);
  expect(frames.workers).toHaveLength(0);
});

it("conserves all hundred settlers when recruiting the final slot and reusing retirement", () => {
  const home = { uid: 0, y: 0, doorThreshold: { x: 1, z: 1 } } as SettlementBuilding;
  const context = { buildings: [home], actors: [], settlers: 100, nextActor: 0 } as unknown as SettlementContext;
  for (let index = 0; index < 100; index++) {
    const actor = createActor(context, "Carrier", 0);
    expect(actor.uid).toBe(index);
    expect(context.settlers + context.actors.filter(entry => entry.phase !== "retired").length).toBe(100);
  }
  expect(context.settlers).toBe(0);
  expect(context.actors[99]!.uid).toBe(99);
  context.actors[25]!.phase = "retired"; context.settlers++;
  const reassigned = createActor(context, "Builder", 0);
  expect(reassigned.uid).toBe(25); expect(reassigned.job).toBe("Builder");
  expect(context.actors).toHaveLength(100); expect(context.settlers).toBe(0);
});

it.each(["Farmer", "Rice farmer"])(
  "scatters seed without a scythe during sowing and equips it for mature harvesting (%s)",
  job => {
    const home = { uid: 0, y: 0, doorThreshold: { x: 1, z: 1 } } as SettlementBuilding;
    const context = { buildings: [home], actors: [], settlers: 1, nextActor: 0 } as unknown as SettlementContext;
    const actor = createActor(context, job, 0);
    const frames = createSettlementRenderFrames([{ nation: "roman", variant: "test" } as WorkerFrame]);
    actor.visible = true; actor.tool = "scythe"; actor.fieldWork = "sow"; actor.action = "work";
    frames.updateWorkers([actor], .05);
    const frame = frames.workers[actor.uid]!;
    expect(frame.action).toBe("idle_breathe"); expect(frame.fieldWork).toBe("sow");
    expect(frame.workerTool).toBeUndefined();
    expect(getWorkerHeldProp(frame)).toBeNull();
    actor.action = "idle"; actor.phase = "workerRestWait";
    frames.updateWorkers([actor], .05);
    expect(frame.fieldWork).toBeUndefined();
    actor.action = "work"; actor.fieldWork = "harvest"; actor.phase = "work";
    frames.updateWorkers([actor], .05);
    expect(frame.action).toBe("harvest_wheat");
    expect(getWorkerHeldProp(frame)).toEqual({ id: "scythe", source: "pack" });
  }
);

it("maps three military ranks to their equipment tiers and removes armour on civilian reassignment", () => {
  const template = { nation: "nubian", variant: "nubian-man-kilt", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 0, x: 0, y: 0, z: 0, yaw: 0, job: "Soldier", action: "walk",
    visible: true, ware: null, animationTime: 0, path: [], pathIndex: 0 } as unknown as SettlementActor;
  for (const [rank, tier] of ["recruit", "soldier", "centurion"].entries()) {
    frames.updateWorkers([actor], 0.1, [{ actor: 0, rank }]);
    expect(frames.workers[0]!.armourRank).toBe(tier);
  }
  actor.job = "Settler";
  frames.updateWorkers([actor], 0.1);
  expect(frames.workers[0]!.armourRank).toBeUndefined();
});

it("renders more than one hundred active recruits and releases frames after storage entry", () => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actors = Array.from({ length: 150 }, (_, index) => ({
    uid: index + 1000, x: index, y: 0, z: 0, yaw: 0, visible: true, job: "Carrier",
    ware: null, action: "idle", path: [], pathIndex: 0, animationTime: 0
  }) as unknown as SettlementActor);
  frames.updateWorkers(actors, .05);
  expect(frames.workers).toHaveLength(150);
  expect(new Set(frames.workers.map(frame => frame.actorId)).size).toBe(150);
  actors.forEach(actor => { actor.visible = false; });
  frames.updateWorkers(actors, .05);
  expect(frames.workers).toHaveLength(0);
});

it.each([60, 144])("keeps log carriers walking between fixed ticks at %s FPS", fps => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 0, x: 0, y: 0, z: 0, yaw: 0, job: "Carrier", action: "carry",
    visible: true, ware: "logs", locomotionSpeed: 1.2, animationTime: 0,
    path: [{ x: 10, z: 0 }], pathIndex: 0 } as SettlementActor;
  recordMovementOutcome(actor, "moving");
  frames.updateWorkers([actor], 0);
  let accumulator = 0;
  for (let frame = 0; frame < fps; frame++) {
    accumulator += 1 / fps;
    while (accumulator >= .05) { actor.x += .06; accumulator -= .05; }
    frames.updateWorkers([actor], 1 / fps);
    expect(frames.workers[0]!.standingCarry).toBe(false);
  }
  recordMovementOutcome(actor, "person-blocked");
  frames.updateWorkers([actor], 1 / fps);
  expect(frames.workers[0]!.standingCarry).toBe(true);
});

it("renders a cavalry actor once, grounds a steady gait in travel, and swaps to a foot rider at the storage door", () => {
  const template = { nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0,
    heading: 0, action: "idle_breathe", animationTime: 0, gaitPhase: 0,
    runBlend: 0, selected: false, target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 7, x: 3, y: .2, z: 3, yaw: 0, mounted: true,
    visible: true, job: "Soldier", action: "walk", phase: "militaryField",
    ware: null, animationTime: 4, path: [], pathIndex: 0,
    building: 0, home: 0, timer: 0 } as SettlementActor;
  const soldier = { actor: 7, rank: 0, combat: { type: "cavalry" as const,
    faction: 0, hp: 105, cooldown: 0, selected: true } };
  frames.updateWorkers([actor], .1, [soldier]);
  expect(frames.workers).toHaveLength(0);
  expect(frames.cavalryMounts[0]!.actorId).toBe(7);
  expect(frames.cavalryMounts[0]!.clip).toBe("idle");
  for (let step = 0; step < 8; step++) { actor.z += .36; frames.updateWorkers([actor], .1, [soldier]); }
  expect(frames.cavalryMounts[0]!.clip).toBe("gallop");
  expect(frames.cavalryMounts[0]!.clipTime).toBeGreaterThan(0);
  // A frame without a simulation tick must not flicker the horse to idle.
  frames.updateWorkers([actor], .1, [soldier]);
  expect(frames.cavalryMounts[0]!.clip).not.toBe("idle");
  for (let step = 0; step < 15; step++) frames.updateWorkers([actor], .1, [soldier]);
  expect(frames.cavalryMounts[0]!.clip).toBe("idle");
  actor.mounted = false; actor.phase = "enterRetire";
  frames.updateWorkers([actor], .1, [soldier]);
  expect(frames.cavalryMounts).toHaveLength(0);
  expect(frames.workers).toHaveLength(1);
  expect(frames.workers[0]!.actorId).toBe(7);
  actor.visible = false; actor.phase = "militaryReserve";
  frames.updateWorkers([actor], .1, [soldier]);
  expect(frames.workers).toHaveLength(0);
  expect(frames.cavalryMounts).toHaveLength(0);
});

it("shows a fallen soldier tipping over for a moment before only its smoke remains", () => {
  const template = { nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0, heading: 0,
    action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, selected: false, target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 4, x: 2, y: 0, z: 3, yaw: 0, visible: true, job: "Soldier", action: "idle", phase: "militaryField",
    ware: null, animationTime: 0, path: [], pathIndex: 0, building: 0, home: 0, timer: 0 } as SettlementActor;
  const soldier = { actor: 4, rank: 0, combat: { type: "shield" as const, faction: 0, hp: 10, cooldown: 0 } };
  frames.updateWorkers([actor], .05, [soldier]);
  frames.updateWorkers([], .05, []);
  frames.addFallen([{ age: .4, faction: 0, id: 4, x: 2, y: 0, z: 3 }]);
  expect(frames.workers).toHaveLength(1);
  expect(frames.workers[0]!.lean).toBeGreaterThan(0);
  expect(frames.workers[0]!.combat).toBeUndefined();
  frames.updateWorkers([], .05, []);
  frames.addFallen([{ age: 1.2, faction: 0, id: 4, x: 2, y: 0, z: 3 }]);
  expect(frames.workers).toHaveLength(0);
});

it("brings a slain rider down with his horse and points the smoke at the fallen figure", () => {
  const template = { nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0, heading: 0,
    action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, selected: false, target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 9, x: 2, y: 0, z: 3, yaw: 1.2, mounted: true, visible: true, job: "Soldier", action: "idle",
    phase: "militaryField", ware: null, animationTime: 0, path: [], pathIndex: 0, building: 0, home: 0,
    timer: 0 } as SettlementActor;
  const soldier = { actor: 9, rank: 0, combat: { type: "cavalry" as const, faction: 1, hp: 10, cooldown: 0 } };
  frames.updateWorkers([actor], .05, [soldier]);
  frames.updateWorkers([], .05, []);
  const [falling] = frames.addFallen([{ age: .4, faction: 1, id: 9, x: 2, y: 0, z: 3 }]);
  expect(frames.workers).toHaveLength(0);
  expect(frames.cavalryMounts).toHaveLength(1);
  expect(frames.cavalryMounts[0]).toMatchObject({ actorId: 9, attackProgress: null, fall: .5, selected: false });
  expect(falling).toMatchObject({ mounted: true, yaw: 1.2 });
  frames.updateWorkers([], .05, []);
  const [lying] = frames.addFallen([{ age: 1.2, faction: 1, id: 9, x: 2, y: 0, z: 3 }]);
  expect(frames.cavalryMounts).toHaveLength(0);
  expect(lying!.mounted).toBe(true);
});

it("seats each nation's rider on its own body and raises its parry when an enemy winds up at it", () => {
  const template = { nation: "nubian", variant: "nubian-man-scarf", x: 0, y: 0, z: 0, heading: 0,
    action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, selected: false, target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 5, x: 2, y: 0, z: 3, yaw: 0, mounted: true, visible: true, job: "Soldier", action: "idle",
    phase: "militaryField", ware: null, animationTime: 0, path: [], pathIndex: 0, building: 0, home: 0,
    timer: 0 } as SettlementActor;
  const rider = { actor: 5, rank: 0, combat: { type: "cavalry" as const, faction: 0, hp: 105, cooldown: 0 } };
  const enemy = { actor: 6, rank: 0, combat: { type: "shield" as const, faction: 1, hp: 100, cooldown: 0,
    attackTime: .4, pendingTarget: 5 } };
  frames.updateWorkers([actor], .05, [rider]);
  expect(frames.cavalryMounts[0]).toMatchObject({ nation: "nubian", rider: "nubian-man-kilt", guard: 0 });
  for (let step = 0; step < 6; step++) frames.updateWorkers([actor], .05, [rider, enemy]);
  expect(frames.cavalryMounts[0]!.guard).toBeGreaterThan(.8);
  for (let step = 0; step < 10; step++) frames.updateWorkers([actor], .05, [rider]);
  expect(frames.cavalryMounts[0]!.guard).toBeLessThan(.05);
});

it("dresses enemy soldiers and riders in their own nation's bodies, the player's in the player's", () => {
  const template = { nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0, heading: 0,
    action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, selected: false, target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template], nation => nation === "roman"
    ? [{ nation: "japanese", variant: "japanese-man-grey" }] : [{ nation: "viking", variant: "viking-man-red" }]);
  const body = (uid: number, mounted: boolean) => ({ uid, x: uid, y: 0, z: 3, yaw: 0, mounted, visible: true,
    job: "Soldier", action: "idle", phase: "militaryField", ware: null, animationTime: 0, path: [], pathIndex: 0,
    building: 0, home: 0, timer: 0 }) as SettlementActor;
  const soldier = (actor: number, type: "shield" | "cavalry", faction: number) =>
    ({ actor, rank: 0, combat: { type, faction, hp: 100, cooldown: 0 } });
  const actors = [body(1, false), body(2, false), body(3, true)];
  frames.updateWorkers(actors, .05, [soldier(1, "shield", 0), soldier(2, "shield", 1), soldier(3, "cavalry", 1)]);
  expect(frames.workers.map(frame => [frame.nation, frame.variant])).toEqual([
    ["roman", "roman-man-white"], ["japanese", "japanese-man-grey"]]);
  expect(frames.cavalryMounts[0]).toMatchObject({ faction: 1, nation: "japanese", rider: "japanese-man-linen" });
  frames.setAppearances([{ nation: "nubian", variant: "nubian-man-kilt" }]);
  expect(frames.workers.map(frame => frame.nation)).toEqual(["nubian", "viking"]);
});

it("adds themed bandit metadata only to hostile adventure soldiers and clears it on legacy reload", () => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actors = [1, 2].map(uid => ({ uid, x: uid, y: 0, z: 0, yaw: 0, job: "Soldier", action: "idle",
    visible: true, ware: null, tool: "bow", animationTime: 0, path: [], pathIndex: 0, phase: "guard", building: 0, home: 0, timer: 0 })) as SettlementActor[];
  const soldiers = actors.map((actor, index) => ({ actor: actor.uid, rank: 0,
    combat: { id: actor.uid, faction: index, type: "archer", hp: 10, attackTime: .3, cooldown: 0 } as
      import("../src/shared/settlement/military-combat-rules").MilitaryCombatant }));
  const before = structuredClone(soldiers);
  frames.updateWorkers(actors, .1, soldiers, 1, "desert");
  expect(frames.workers.find(worker => worker.actorId === 1)!.combat!.bandit).toBeUndefined();
  expect(frames.workers.find(worker => worker.actorId === 2)!.combat!.bandit!.theme).toBe("desert");
  expect(soldiers).toEqual(before);
  frames.updateWorkers(actors, .1, soldiers);
  expect(frames.workers.every(worker => worker.combat!.bandit === undefined)).toBe(true);
});

const PUTDOWN = { direction: "putdown", progress: .2, target: { x: 4, y: 0, z: 6 }, ware: "water" };
it.each([
  ["Well worker", "the windlass", { action: "work", phase: "wellWork" }],
  ["Well worker", "the bucket set-down", { action: "carry", phase: "outputPutdown", wareTransfer: PUTDOWN }],
  ["Carrier", "a stock shelf", { action: "carry", phase: "pickup",
    wareTransfer: { ...PUTDOWN, direction: "pickup", ware: "planks" } }],
  ["Smith", "its workshop output shelf", { action: "carry", phase: "outputPutdown",
    wareTransfer: { ...PUTDOWN, ware: "axe" } }],
  ["Builder", "the construction site", { action: "work", phase: "construct" }]
])("turns a %s from the way walked to face %s", (job, _, work) => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 0, x: 5, y: 0, z: 5, yaw: Math.PI / 2, job, action: "walk",
    visible: true, phase: "walk", ware: null, animationTime: 0, path: [],
    pathIndex: 0 } as unknown as SettlementActor;
  frames.updateWorkers([actor], .05);
  // The last step (walking +x) and the simulation's work facing (-x) land in the same tick.
  Object.assign(actor, { x: 5.1, yaw: -Math.PI / 2, ...work });
  for (let frame = 0; frame < 20; frame++) frames.updateWorkers([actor], .05);
  expect(frames.workers[0]!.heading).toBeCloseTo(-Math.PI / 2);
});

it("keeps an idle walker's heading the way it walked while the simulation facing still lags", () => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 0, x: 5, y: 0, z: 5, yaw: .3, job: "Carrier", action: "walk",
    visible: true, phase: "walk", ware: null, animationTime: 0, path: [],
    pathIndex: 0 } as unknown as SettlementActor;
  frames.updateWorkers([actor], .05);
  Object.assign(actor, { x: 5.1, action: "idle" });
  for (let frame = 0; frame < 20; frame++) frames.updateWorkers([actor], .05);
  expect(frames.workers[0]!.heading).toBeCloseTo(Math.PI / 2);
});

it("keeps the Catapult operator on its moving upper frame and faces the actual pickup target", () => {
  const template = { nation: "roman", variant: "test", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const operator = { uid: 0, x: 5, y: 3, z: 5, yaw: 0, job: "Soldier", action: "walk",
    visible: true, phase: "garrisonView", ware: null, tool: undefined, animationTime: 0,
    path: [], pathIndex: 0, catapultOperator: { phase: "pick", progress: 0, stoneDiameter: .16 }
  } as unknown as SettlementActor;
  frames.updateWorkers([operator], .1);
  Object.assign(operator, { x: 5.4, y: 3, z: 5.1, yaw: Math.PI, action: "idle" });
  frames.updateWorkers([operator], .1, [], .25);
  expect(frames.workers[0]).toMatchObject({ x: 5.4, y: 3, z: 5.1, heading: Math.PI });
});

it("rings the enemy the player's soldiers chase in sight, on foot and on a horse (targetMilitary)", () => {
  const template = { nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0, heading: 0,
    action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, selected: false, target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const body = (uid: number, x: number, mounted = false) => ({ uid, x, y: 0, z: 3, yaw: 0, mounted, visible: true,
    job: "Soldier", action: "idle", phase: "militaryField", ware: null, animationTime: 0, path: [], pathIndex: 0,
    building: 0, home: 0, timer: 0 }) as SettlementActor;
  const combat = (faction: number, type: "cavalry" | "shield") => ({ cooldown: 0, faction, hp: 100, type });
  const chaser = { actor: 1, rank: 0, combat: { ...combat(0, "shield"), chase: { uid: 2 } } };
  const foot = { actor: 2, rank: 0, combat: combat(1, "shield") };
  const rider = { actor: 3, rank: 0, combat: combat(1, "cavalry") };
  const actors = [body(1, 1), body(2, 4), body(3, 8, true)];
  frames.updateWorkers(actors, .1, [chaser, foot, rider]);
  expect(frames.workers.find(frame => frame.actorId === 2)?.targeted).toBe(true);
  expect(frames.workers.find(frame => frame.actorId === 1)?.targeted).toBe(false);
  expect(frames.cavalryMounts[0]?.targeted).toBe(false);
  // Chasing the rider; and a chase whose foe is out of sight draws no ring.
  const lost = { actor: 4, rank: 0, combat: { ...combat(0, "shield"), chase: { lost: { seconds: 1, x: 0, z: 0 },
    uid: 2 } } };
  frames.updateWorkers([...actors, body(4, 0)], .1, [{ ...chaser, combat: { ...chaser.combat, chase: { uid: 3 } } },
    foot, rider, lost]);
  expect(frames.cavalryMounts[0]?.targeted).toBe(true);
  expect(frames.workers.find(frame => frame.actorId === 2)?.targeted).toBe(false);
});

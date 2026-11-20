import { type ArmourRank,ThreeArmourPack } from "@workers/game-three-armour";
import { ThreeWorkerPack } from "@workers/game-three-worker";
import * as three from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { locomotionClipTime } from "../../src/render-common/workers/worker-gait";
import type { WorkerFrame, WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createWorkerPoser, createWorkerTextureLoader } from "../../src/renderers/three/three-worker";
import { createWorkerProp } from "../../src/renderers/three/three-worker-prop";
import { captureArmourFitDiagnostics, captureArmourFitWitness } from "./armour-fit-diagnostics";

/** Actual game poser, procedural equipment and published/staged glTFs; no hand-authored review poses. */
export const createArmourFitScene = (assetRoot: string, minimal: boolean, pilots: boolean, motionPilots = false,
  armourFolder?: string) => {
  const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(800, 800); renderer.setPixelRatio(1);
  renderer.toneMapping = three.ACESFilmicToneMapping;
  const scene = new three.Scene(); scene.background = new three.Color("#9ca49c");
  scene.add(new three.HemisphereLight(0xffffff, 0x777777, 2));
  const light = new three.DirectionalLight(0xfff4e4, 2.2); light.position.set(-2, 4, 3); scene.add(light);
  const camera = new three.PerspectiveCamera(32, 1, .01, 20);
  const root = new URL(`/@fs${assetRoot}/`, location.href);
  const textures = createWorkerTextureLoader(renderer);
  const workers = new ThreeWorkerPack(new URL(motionPilots ? "foot-calibration-pilots/" : "tripo/", root).href,
    textures, minimal);
  const folder = armourFolder ?? (pilots ? "armour-repair-pilots" : "armour");
  const armour = new ThreeArmourPack(new URL(`${folder}/`, root).href,
    workers, minimal);
  const publishedArmour = new ThreeArmourPack(new URL("armour/", root).href, workers, minimal);
  const now = performance.now.bind(performance); let clock = now();
  Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
  return {
    async captureCivilian(nation: WorkerNation, variant: string, staged: boolean,
      pilotFolder = "civilian-composition-pilots",
      review: { modes?: string[]; waist?: boolean } = {}) {
      const model = staged ? new URL(`${pilotFolder}/${variant}/${minimal ? "model-minimal.glb" : "model.glb"}`, root).href : undefined;
      const worker = await workers.load(nation, variant, model);
      worker.root.scale.setScalar(WORKER_SCALE); scene.add(worker.root);
      const pose = createWorkerPoser(worker), prop = createWorkerProp(workers, worker, !minimal);
      const modes = review.modes ?? ["walk", "carry_back", "carry_shoulder"];
      const sheets = Array.from({ length: review.waist ? 6 : 5 }, () => document.createElement("canvas"));
      for (const sheet of sheets) { sheet.width = 2048; sheet.height = modes.length * 256; }
      const contexts = sheets.map(sheet => sheet.getContext("2d")!);
      const heldProps: { mode: string; sample: number; name: string }[] = [];
      try {
        for (const [row, mode] of modes.entries()) for (let sample = 0; sample < 8; sample++) {
          let action = mode;
          let carryingWare = null;
          if (action === "carry_back") carryingWare = "flour";
          if (action === "carry_shoulder") carryingWare = "logs";
          if (mode === "front") { action = "carry_shoulder"; carryingWare = "stone"; }
          if (mode === "bucket") { action = "carry_back"; carryingWare = "water"; }
          const frame = { actorId: 1, nation, variant, x: 0, y: 0, z: 0, heading: 0,
            visible: true, selected: false, action, gaitPhase: sample / 8, runBlend: 0,
            animationTime: sample / 8 * 3, target: null, workerJob: "Carrier",
            carryingWare } as WorkerFrame;
          for (let tick = 0; tick < 4; tick++) {
            clock += 1000; pose(frame); prop.update(frame); await new Promise(done => setTimeout(done, 20));
          }
          if (mode === "front" || mode === "bucket") {
            const name = mode === "front" ? "ware_stone" : "ware_water_well";
            const held = worker.root.getObjectByName(name);
            if (!held?.visible) throw new Error(`${variant}/${mode}/${sample}: actual held cargo is missing`);
            heldProps.push({ mode, sample, name });
          }
          for (const [index, context] of contexts.entries()) {
            const feet = index === 1;
            camera.position.set(.12, .88, 2.15); camera.lookAt(0, .65, 0);
            if (feet) { camera.position.set(.12, .32, .66); camera.lookAt(0, .12, 0); }
            if (index >= 2) { camera.position.set(.12, .88, .9); camera.lookAt(0, .77, 0); }
            if (index === 5) { camera.position.set(.10, .64, .67); camera.lookAt(0, .55, 0); }
            const hidden: three.Object3D[] = [];
            // Review-only ownership isolation distinguishes original donor surfaces from the new garment.
            worker.root.traverse(node => {
              if (!node.visible || index !== 3 && index !== 4) return;
              const source = /^body(?:_|$)/.test(node.name);
              const garment = /^(national_(garment|tailoring|trousers)|faction_sash)/.test(node.name);
              if (index === 3 && source || index === 4 && garment) { node.visible = false; hidden.push(node); }
            });
            camera.updateMatrixWorld(true); renderer.render(scene, camera);
            context.drawImage(renderer.domElement, sample * 256, row * 256, 256, 256);
            context.fillStyle = "#152015"; context.font = "13px sans-serif";
            context.fillText(`${variant} ${mode} ${sample}/8`, sample * 256 + 3, row * 256 + 14);
            for (const node of hidden) node.visible = true;
          }
        }
        return { heldProps, images: sheets.map((sheet, index) => ({ name: ["body", "feet", "chest", "without-source", "without-garment", "waist"][index],
          png: sheet.toDataURL("image/png").split(",")[1]! })) };
      } finally { prop.dispose(); worker.dispose(); }
    },
    async capture(nation: WorkerNation, variant: string, rank: ArmourRank,
      review: { close?: boolean; diagnostics?: boolean; layerMode?: "all" | "source" | "linen" | "torso";
        head?: boolean; includeRun?: boolean; neck?: boolean; published?: boolean; runAngle?: number; runBlend?: number; runPhase?: number;
        runWitnessPoint?: number[];
        sourceModel?: string; waist?: boolean; windupPhase?: number; witnessViews?: boolean } = {}) {
      const worker = review.sourceModel
        ? { ...await workers.load(nation, variant, new URL(review.sourceModel, root).href), setLod: (_lod: number) => {} }
        : await (review.published ? publishedArmour : armour).loadSoldier(nation, variant, rank);
      worker.root.scale.setScalar(WORKER_SCALE); scene.add(worker.root); worker.setLod(minimal ? 1 : 0);
      const pose = createWorkerPoser(worker), prop = createWorkerProp(workers, worker, !minimal);
      const sheet = document.createElement("canvas"); sheet.width = 1600; sheet.height = 960;
      const context = sheet.getContext("2d")!, cells = [];
      const troops = ["shield", "heavy", "archer"] as const;
      const views = [{ name: "idle front", action: "idle_breathe", progress: null, phase: .2, angle: .18 },
        { name: "windup front", action: "idle_breathe", progress: review.windupPhase ?? .48, phase: .2, angle: .18 },
        { name: "impact front", action: "idle_breathe", progress: .75, phase: .2, angle: .18 },
        { name: "impact back", action: "idle_breathe", progress: .75, phase: .2, angle: Math.PI + .25 },
        { name: "walk side", action: "walk", progress: null, phase: .23, angle: Math.PI / 2 - .25 }];
      if (review.includeRun) views.push({ name: review.runWitnessPoint ? "run witness" : "run front", action: "run", progress: null,
        phase: review.runPhase ?? 0, angle: review.runAngle ?? .18 });
      if (review.includeRun && review.witnessViews) for (const [name, angle] of [
        ["run right", -Math.PI / 2], ["run back", Math.PI + .25]] as const)
        views.push({ name, action: "run", progress: null, phase: review.runPhase ?? 0, angle });
      sheet.width = views.length * 320;
      try {
        for (const [row, troop] of troops.entries()) for (const [column, view] of views.entries()) {
          const tool = { shield: "sword", heavy: "axe", archer: "bow" }[troop];
          const runBlend = view.name.startsWith("run") ? review.runBlend ?? 1 : 0;
          const action = view.action === "run" && runBlend < 1 ? "walk" : view.action;
          const frame = { actorId: 1, nation, variant, x: 0, y: 0, z: 0, heading: 0,
            selected: false, visible: true, action, gaitPhase: view.phase, runBlend,
            animationTime: ["walk", "run"].includes(action)
              ? locomotionClipTime(action as "walk" | "run", view.phase) : .6,
            target: null, workerJob: "Soldier",
            workerTool: tool, armourRank: rank, carryingWare: null,
            combat: { attackProgress: view.progress, defending: false, doorMelee: false,
              faction: 0, type: troop, variant: 0 } } as WorkerFrame;
          for (let tick = 0; tick < 4; tick++) {
            clock += 1000; pose(frame); prop.update(frame);
            await new Promise(done => setTimeout(done, 20));
          }
          // Apply after real pose/equipment updates: their LOD/material ownership may restore
          // visibility. A torso/linen isolation contains only that actual mesh, including no props.
          worker.root.traverse(node => {
            if (!node.visible || !review.layerMode || review.layerMode === "all") return;
            if (review.layerMode === "source" && node.name.startsWith("armour_")) node.visible = false;
            const draw = node as three.Mesh & three.Line & three.Points & three.Sprite;
            if (!draw.isMesh && !draw.isLine && !draw.isPoints && !draw.isSprite) return;
            if (review.layerMode === "source" && !/^body(?:_|$)/.test(node.name)) node.visible = false;
            if (review.layerMode === "linen" && !node.name.startsWith("armour_underclothes")) node.visible = false;
            if (review.layerMode === "torso" && !node.name.startsWith("armour_torso")) node.visible = false;
          });
          const visibleMeshes: string[] = [];
          const visibleDraws: { name: string; type: string }[] = [];
          if (review.layerMode && review.layerMode !== "all") worker.root.traverse(node => {
            const draw = node as three.Mesh & three.Line & three.Points & three.Sprite;
            if (!draw.isMesh && !draw.isLine && !draw.isPoints && !draw.isSprite) return;
            for (let owner: three.Object3D | null = node; owner; owner = owner.parent) if (!owner.visible) return;
            if (draw.isMesh) visibleMeshes.push(node.name);
            visibleDraws.push({ name: node.name, type: node.type });
          });
          let distance = review.close ? .95 : 2.15;
          if (review.neck) distance = .55;
          if (review.waist) distance = .85;
          if (review.head) distance = .65;
          let cameraHeight = .88;
          if (review.waist) cameraHeight = .65;
          if (review.head) cameraHeight = 1;
          camera.position.set(Math.sin(view.angle) * distance, cameraHeight, Math.cos(view.angle) * distance);
          if (view.name.startsWith("run") && review.runWitnessPoint) camera.position.fromArray(review.runWitnessPoint)
            .add(new three.Vector3(Math.sin(view.angle) * distance, 0, Math.cos(view.angle) * distance));
          let height = review.close ? .78 : .65;
          if (view.name.startsWith("run") && review.runWitnessPoint && !review.close && !review.waist) height = .55;
          if (review.neck) height = .84;
          if (review.waist) height = .45;
          if (review.head) height = .96;
          camera.lookAt(0, height, 0); camera.updateMatrixWorld(true);
          renderer.info.reset(); renderer.render(scene, camera);
          context.drawImage(renderer.domElement, column * 320, row * 320, 320, 320);
          context.fillStyle = "#152015"; context.font = "13px sans-serif";
          context.fillText(`${variant} ${rank} ${troop} ${view.name}`, column * 320 + 4, row * 320 + 15);
          const diagnostics = review.diagnostics
            ? captureArmourFitDiagnostics(worker.root, camera, column === 0 || column === 3) : undefined;
          cells.push({ troop, ...view, visibleDraws, visibleMeshes,
            cameraPosition: camera.position.toArray(), cameraQuaternion: camera.quaternion.toArray(), cameraFov: camera.fov,
            exactWitnessOwner: view.name.startsWith("run") && review.runWitnessPoint
              ? captureArmourFitWitness(worker.root, camera, new three.Vector3().fromArray(review.runWitnessPoint)) : undefined,
            diagnostics,
            frame: review.diagnostics ? frame : undefined,
            calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
        }
        return { png: sheet.toDataURL("image/png").split(",")[1]!, cells };
      } finally { prop.dispose(); worker.dispose(); }
    },
    dispose() {
      Object.defineProperty(performance, "now", { configurable: true, value: now });
      textures.dispose(); renderer.dispose();
    },
  };
};

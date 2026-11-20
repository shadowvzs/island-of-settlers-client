import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const yard = process.argv.includes("--yard"), measure = process.argv.includes("--measure-only"), putdown = process.argv.includes("--putdown");
const output = "/tmp/codex-fisher-boat/dense-probe" + (yard ? "/yard" : "") + (process.argv.includes("--arms") ? "/arms" : "") + (putdown ? "/putdown" : "");
const nation = process.argv[2] ?? "roman", variant = process.argv[3] ?? "roman-man-grey";
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.addInitScript("window.__name = value => value;");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${url}building-showcase.html?building=0&quality=minimal&sample=1`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady));
  const captures = await page.evaluate(async ({ includeArms, measure, nation, processSurface, putdown, variant, workerModule, yard }) => {
    const preview = (window as any).__buildingPreview;
    preview.renderer.setAnimationLoop(null); preview.model().root.visible = false;
    const workers = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
    const props = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker-prop.ts"));
    const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
    const packs = await import(/* @vite-ignore */ workerModule);
    const assets = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-assets.ts"));
    const dimensions = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-dimensions.ts"));
    const transfer = await import(/* @vite-ignore */ String("/src/renderers/three/worker-boat-transfer.ts"));
    const surfaceModule = await import(/* @vite-ignore */ String("/tools/bench/fisher-body-surface.ts"));
    const boatContact = await import(/* @vite-ignore */ String("/src/renderers/three/worker-boat-hand-contacts.ts"));
    const boatModule = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/three-fishing-boats.ts"));
    const peopleModule = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/three-small-boat-people.ts"));
    const textures = workers.createWorkerTextureLoader(preview.renderer);
    const pictures: { name: string; png: string; hands: number[][]; beforeHands?: number[][];
      gripErrors?: number[]; rowGripError?: number; joints?: Record<string, number[]>; clearance?: Record<string, number>; gripAlong?: number | number[]; hullMatrix?: number[]; workerPosition?: number[]; skinSurface?: any; gripTargets?: number[][]; freeHand?: boolean; wallGap?: number; rotations?: Record<string, number[]>; swivels?: any; wrists?: number[] }[] = [];
    for (const minimal of [false]) {
      const pack = new packs.ThreeWorkerPack(`${assets.WORKER_ASSET_BASE}tripo/`, textures, minimal);
      const worker = await pack.load(nation, variant);
      worker.root.scale.setScalar(dimensions.WORKER_SCALE);
      const poser = workers.createWorkerPoser(worker), held = props.createWorkerProp(pack, worker, !minimal);
      preview.scene.add(worker.root);
      const camera = new three.OrthographicCamera(-1.25, 1.25, 1.1, -1.1, .01, 20);
      camera.position.set(2, 1.6, 3); camera.lookAt(0, .55, 0);
      const samples = Array.from({length: 81}, (_, index) => ({ action: "boat_lift", carryingWare: "boat", time: Math.min(1.19999, index * 1.2 / 80), suffix: `-${index}` }));
      for (const sample of samples) {
        const frame: any = { nation, variant, x: 0, y: 0, z: 0, heading: 0,
          selected: false, animationTime: sample.time, gaitPhase: .25, runBlend: 0, target: null,
          workerJob: "Fisher", ...sample };
        worker.root.position.z = sample.action === "boat_lift"
          ? transfer.boatTransferTransform(sample.time / 1.2).workerForward * dimensions.WORKER_SCALE : 0;
        if (yard) {
          frame.fisherBoatYard = { x: .725, y: 0, z: .1, yaw: -Math.PI / 2 };
          frame.heading = transfer.yardBoatWorkerHeading(frame.fisherBoatYard.yaw, putdown ? 1 - sample.time / 1.2 : sample.time / 1.2);
          if (putdown) {
            frame.action = "putdown_material"; frame.workerJob = "Carrier";
            frame.wareTransfer = { ware: "boat", direction: "putdown", progress: sample.time / 1.2, target: frame.fisherBoatYard, yaw: frame.fisherBoatYard.yaw };
          }
        }
        worker.root.rotation.y = frame.heading;
        poser(frame); held.update(frame);
        await new Promise(resolve => setTimeout(resolve, sample.suffix === "-0" ? 300 : 5));
        poser(frame); worker.root.updateMatrixWorld(true);
        const beforeHands = ["socket_hand_L", "socket_hand_R"].map(name =>
          worker.root.getObjectByName(name)?.getWorldPosition(new three.Vector3()).toArray());
        held.update(frame); worker.root.updateMatrixWorld(true);
        if (!measure) preview.renderer.render(preview.scene, camera);
        const hands = ["socket_hand_L", "socket_hand_R"].map(name =>
          worker.root.getObjectByName(name)?.getWorldPosition(new three.Vector3()).toArray());
        const hull = worker.root.getObjectByName("fisher_carried_boat");
        let gripErrors: number[] | undefined;
        if (hull?.visible && (sample.action === "carry_overhead_boat" || sample.action === "boat_lift")) {
          const pose = transfer.boatTransferTransform(sample.action === "boat_lift" ? sample.time / 1.2 : 1);
          const along = hull.userData.fisherGripAlong ?? pose.gripAlong;
          gripErrors = hull.userData.fisherTransferGripPoints
            ? hull.userData.fisherTransferGripPoints.map((point: any, index: number) => point.distanceTo(new three.Vector3(...hands[index])))
            : [1, -1].map((sign, index) => hull.localToWorld(boatContact.boatRimPoint(sign * (hull.userData.fisherGripSide ?? 1), Array.isArray(along) ? along[index] : along)
            .add(new three.Vector3(0, pose.gripDepth + (hull.userData.fisherRailTop ?? 0), 0)))
            .distanceTo(new three.Vector3(...hands[index])));
        }
        const joints: Record<string, number[]> = {}, rotations: Record<string, number[]> = {};
        for (const name of ["Head", "Neck", "Spine", "Spine1", "Spine2", "Hips", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"]) {
          const object = worker.root.getObjectByName(name); if (object) {
            joints[name] = object.getWorldPosition(new three.Vector3()).toArray();
            if (/^(Left|Right)(Arm|ForeArm|Hand)$/.test(name)) rotations[name] = object.getWorldQuaternion(new three.Quaternion()).toArray();
          }
        }
        // Conservative body spheres against the actual rendered hull triangles. Negative is overlap.
        const clearance: Record<string, number> = {}; let hullMatrix: number[] | undefined; let wallGap: number | undefined;
        if (hull?.visible) {
          let hullMesh: any;
          hull.traverse((object: any) => { if (object.isMesh && !hullMesh) hullMesh = object; });
          if (!hullMesh) throw new Error("carried hull mesh missing");
          hullMesh.updateWorldMatrix(true, false); hullMatrix = hullMesh.matrixWorld.toArray();
          const geometry = hullMesh.geometry, positions = geometry.getAttribute("position"), index = geometry.getIndex();
          const triangle = new three.Triangle(), closest = new three.Vector3(), scale = hullMesh.getWorldScale(new three.Vector3()).x;
          if (yard) {
            wallGap = Infinity;
            const point = new three.Vector3();
            for (let at = 0; at < positions.count; at++)
              wallGap = Math.min(wallGap, frame.fisherBoatYard.x - point.fromBufferAttribute(positions, at).applyMatrix4(hullMesh.matrixWorld).x);
          }
          for (const [name, radius, offset] of [["Head", .09, .055], ["Spine2", .12, 0], ["Spine1", .12, 0],
            ["Hips", .10, 0], ["LeftLeg", .065, 0], ["RightLeg", .065, 0]] as const) {
            if (!joints[name]) throw new Error(`missing ${name} bone`);
            const point = new three.Vector3(...joints[name]); point.y += offset; hullMesh.worldToLocal(point);
            let nearest = Infinity;
            const count = index ? index.count : positions.count;
            for (let j = 0; j < count; j += 3) {
              const vertex = (k: number, out: any) => out.fromBufferAttribute(positions, index ? index.getX(j + k) : j + k);
              vertex(0, triangle.a); vertex(1, triangle.b); vertex(2, triangle.c);
              triangle.closestPointToPoint(point, closest); nearest = Math.min(nearest, point.distanceTo(closest) * scale);
            }
            clearance[name] = nearest - radius;
          }
        }
        const skinSurface = processSurface ? surfaceModule.fisherBodySurface(three, worker.root, hull, includeArms) : undefined;
        pictures.push({ skinSurface, wallGap, rotations, wrists: ["Left", "Right"].map(side => worker.root.getObjectByName(side + "Hand")?.userData.fisherWristBend), swivels: hull?.userData.fisherElbowSwivels ? { ...hull.userData.fisherElbowSwivels } : undefined, freeHand: hull?.userData.fisherTransferFreeHand, gripTargets: hull?.userData.fisherTransferGripPoints?.map((p: any) => p.toArray()), name: `${variant}-${minimal ? "minimal" : "high"}-${sample.action}${"suffix" in sample ? sample.suffix : ""}`, hands, gripErrors, joints, clearance, hullMatrix, workerPosition: worker.root.position.toArray(), gripAlong: hull?.userData.fisherGripAlong,
          beforeHands,
          png: measure ? "" : preview.renderer.domElement.toDataURL("image/png").split(",")[1] });
      }
      const carryFrame = { nation, variant, x: 0, y: 0, z: 0, heading: 0, selected: false,
        action: "carry_overhead_boat", carryingWare: "boat", animationTime: 0, gaitPhase: .25, runBlend: 0,
        target: null, workerJob: "Carrier" };
      poser(carryFrame); held.update(carryFrame);
      const isVisible = (object: any) => {
        for (let node = object; node; node = node.parent) if (!node.visible) return false;
        return true;
      };
      let looseFish = 0;
      worker.root.traverse((object: any) => { if (/^fish_\d$/.test(object.name) && isVisible(object)) looseFish++; });
      if (looseFish) throw new Error(`${variant}: ${looseFish} fish remained visible after basket-to-boat switch`);
      worker.root.visible = false;
      const people = peopleModule.createSmallBoatPeople(!minimal);
      people.setSource({ load: (appearance: any) => pack.load(appearance.nation, appearance.variant) },
        [{ nation, variant }]);
      const boats = boatModule.createThreeFishingBoats(!minimal, people);
      preview.scene.add(boats.group);
      const boatFrame = { id: 1, nation, person: 0, x: 0, y: 0, z: 0, yaw: 0,
        crewed: true, rowing: true };
      boats.update([boatFrame], 0); await people.whenReady();
      for (const sample of [{ name: "row", net: undefined }, { name: "cast", net: .07 },
        { name: "haul", net: .86 }]) {
        boats.update([{ ...boatFrame, rowing: sample.net === undefined, net: sample.net }], .35);
        preview.renderer.render(preview.scene, camera);
        pictures.push({ name: `${variant}-${minimal ? "minimal" : "high"}-${sample.name}`, hands: [],
          rowGripError: sample.name === "row" ? people.stats().boatGripError : undefined,
          png: measure ? "" : preview.renderer.domElement.toDataURL("image/png").split(",")[1] });
      }
      worker.root.visible = true;
      const launch = { nation, variant, x: 0, y: 0, z: 0, heading: 0, selected: false,
        action: "boat_launch", animationTime: 1.3, gaitPhase: 0, runBlend: 0, target: null, workerJob: "Fisher" };
      poser(launch); held.update(launch);
      await new Promise(resolve => setTimeout(resolve, 80));
      poser(launch); held.update(launch);
      boats.update([{ ...boatFrame, z: .8, crewed: false, rowing: false,
        handling: { kind: "launch", progress: .43 } }], .35);
      preview.renderer.render(preview.scene, camera);
      pictures.push({ name: `${variant}-${minimal ? "minimal" : "high"}-launch-with-boat`, hands: [],
        png: measure ? "" : preview.renderer.domElement.toDataURL("image/png").split(",")[1] });
      boats.dispose();
      if (boats.group.parent) throw new Error("Disposed skiff group remained in the scene");
      people.dispose();
      held.dispose(); worker.dispose(); pack.dispose();
    }
    textures.dispose(); return pictures;
  }, { nation, variant, yard, measure, putdown, processSurface: process.argv.includes("--surface"), includeArms: process.argv.includes("--arms"), workerModule: `/@fs${resolve("../island-of-settlers-worker-generation/src/game-three-worker.ts")}` });
  for (const capture of captures) if (capture.png) writeFileSync(resolve(output, `${capture.name}.png`), Buffer.from(capture.png, "base64"));
  writeFileSync(resolve(output, `${variant}-runtime-review.json`), JSON.stringify({ captures: captures.map(({ beforeHands, clearance, freeHand, gripAlong, gripErrors, gripTargets, hands, hullMatrix, joints, name, rowGripError, skinSurface, wallGap, workerPosition, rotations, swivels, wrists }) =>
    ({ name, hands, gripErrors, rowGripError, beforeHands, joints, clearance, gripAlong, hullMatrix, workerPosition, skinSurface, gripTargets, freeHand, wallGap, rotations, swivels, wrists })), errors }, null, 2));
  const measured = captures.filter(capture => capture.name.includes("boat_lift-"));
  const failures = measured.flatMap(capture => {
    const found: string[] = [];
    if (!capture.gripErrors || Math.max(...capture.gripErrors) > .02) found.push(`${capture.name}: grip error > 0.02`);
    if (!capture.clearance || Object.keys(capture.clearance).length !== 6) found.push(`${capture.name}: missing clearance measurement`);
    if (yard && (capture.wallGap === undefined || capture.wallGap < 0)) found.push(`${capture.name}: hull intersects yard wall`);
    if (capture.skinSurface?.crossings) found.push(`${capture.name}: posed body skin intersects hull (${capture.skinSurface.crossings} triangles)`);
    for (const [part, gap] of Object.entries(capture.clearance ?? {}))
      if (gap < 0) found.push(`${capture.name}: ${part} hull overlap ${gap.toFixed(3)}`);
    return found;
  });
  for (let index = 1; index < measured.length; index++) {
    const previous = measured[index - 1]!, current = measured[index]!;
    for (const joint of ["LeftForeArm", "RightForeArm"]) {
      const a = previous.joints?.[joint], b = current.joints?.[joint];
      if (a && b && Math.hypot(...a.map((value, at) => value - b[at]!)) > .08)
        failures.push(`${current.name}: ${joint} moved more than0.08 in15ms`);
    }
    for (const [joint, a] of Object.entries(previous.rotations ?? {})) {
      const b = current.rotations?.[joint];
      if (b && 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, value, at) => sum + value * b[at]!, 0)))) > .6)
        failures.push(`${current.name}: ${joint} rotated more than0.6rad in15ms`);
    }
    const before = Array.isArray(previous.gripAlong) ? previous.gripAlong : [previous.gripAlong, previous.gripAlong];
    const after = Array.isArray(current.gripAlong) ? current.gripAlong : [current.gripAlong, current.gripAlong];
    if (before.some((value, hand) => typeof value !== "number" || typeof after[hand] !== "number" ||
      Math.abs(after[hand]! - value) * (1.0625 / 1.16) > .1))
      failures.push(`${current.name}: grip jumped more than0.1 between samples`);
  }
  writeFileSync(resolve(output, `${variant}-gate.json`), JSON.stringify({ samples: measured.length, failures }, null, 2));
  if (errors.length) throw new Error(errors.join("\n"));
  if (process.argv.includes("--gate") && failures.length) throw new Error(`fisher lift gate: ${failures.length} failures; see ${output}/${variant}-gate.json`);
  console.log(`Captured ${captures.length} runtime poses to ${output}`);
} finally { await browser.close(); await server.close(); }

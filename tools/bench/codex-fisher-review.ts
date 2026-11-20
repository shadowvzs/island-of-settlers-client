import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser, startDevServer } from "./browser";

const output = "/tmp/codex-fisher-boat";
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
  const captures = await page.evaluate(async ({ nation, variant, workerModule }) => {
    const preview = (window as any).__buildingPreview;
    preview.renderer.setAnimationLoop(null); preview.model().root.visible = false;
    const workers = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
    const props = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker-prop.ts"));
    const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
    const packs = await import(/* @vite-ignore */ workerModule);
    const assets = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-assets.ts"));
    const dimensions = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-dimensions.ts"));
    const transfer = await import(/* @vite-ignore */ String("/src/renderers/three/worker-boat-transfer.ts"));
    const boatContact = await import(/* @vite-ignore */ String("/src/renderers/three/worker-boat-hand-contacts.ts"));
    const boatModule = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/three-fishing-boats.ts"));
    const peopleModule = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/three-small-boat-people.ts"));
    const textures = workers.createWorkerTextureLoader(preview.renderer);
    const pictures: { name: string; png: string; hands: number[][]; beforeHands?: number[][];
      gripErrors?: number[]; rowGripError?: number }[] = [];
    for (const minimal of [false, true]) {
      const pack = new packs.ThreeWorkerPack(`${assets.WORKER_ASSET_BASE}tripo/`, textures, minimal);
      const worker = await pack.load(nation, variant);
      worker.root.scale.setScalar(dimensions.WORKER_SCALE);
      const poser = workers.createWorkerPoser(worker), held = props.createWorkerProp(pack, worker, !minimal);
      preview.scene.add(worker.root);
      const camera = new three.OrthographicCamera(-1.25, 1.25, 1.1, -1.1, .01, 20);
      camera.position.set(2, 1.6, 3); camera.lookAt(0, .55, 0);
      const samples = [
        { action: "carry_overhead_boat", carryingWare: "boat", time: .3 },
        ...[0, .3, .6, .9, 1.19].map((time, index) => ({ action: "boat_lift", carryingWare: "boat", time,
          suffix: `-${index}` })),
        ...[0, .3, .6, .9, 1.19].map((time, index) => ({ action: "boat_lift", carryingWare: "boat", time,
          fisherBoatYard: { x: .725, y: 0, z: .1, yaw: -Math.PI / 2 }, suffix: `-yard-${index}` })),
        { action: "boat_launch", carryingWare: null, time: 1.3 },
        { action: "boat_beach", carryingWare: null, time: 1.1 },
        { action: "fish_basket_pickup", carryingWare: "fish", fisherBasket: true, time: .5 },
        { action: "walk", carryingWare: "fish", fisherBasket: true, time: .3 }
      ];
      for (const sample of samples) {
        const frame = { nation, variant, x: 0, y: 0, z: 0, heading: 0,
          selected: false, animationTime: sample.time, gaitPhase: .25, runBlend: 0, target: null,
          workerJob: "Fisher", ...sample };
        worker.root.position.z = sample.action === "boat_lift" && !("fisherBoatYard" in sample)
          ? transfer.boatTransferTransform(sample.time / 1.2).workerForward * dimensions.WORKER_SCALE : 0;
        if ("fisherBoatYard" in sample) frame.heading = transfer.yardBoatWorkerHeading((sample.fisherBoatYard as { yaw: number }).yaw, sample.time / 1.2);
        worker.root.rotation.y = frame.heading;
        poser(frame); held.update(frame);
        await new Promise(resolve => setTimeout(resolve, 240));
        poser(frame); worker.root.updateMatrixWorld(true);
        const beforeHands = ["socket_hand_L", "socket_hand_R"].map(name =>
          worker.root.getObjectByName(name)?.getWorldPosition(new three.Vector3()).toArray());
        held.update(frame); worker.root.updateMatrixWorld(true);
        preview.renderer.render(preview.scene, camera);
        const hands = ["socket_hand_L", "socket_hand_R"].map(name =>
          worker.root.getObjectByName(name)?.getWorldPosition(new three.Vector3()).toArray());
        const hull = worker.root.getObjectByName("fisher_carried_boat");
        let gripErrors: number[] | undefined;
        if (hull?.visible && (sample.action === "carry_overhead_boat" || sample.action === "boat_lift")) {
          const pose = transfer.boatTransferTransform(sample.action === "boat_lift" ? sample.time / 1.2 : 1);
          const along = hull.userData.fisherGripAlong ?? pose.gripAlong;
          gripErrors = hull.userData.fisherTransferGripPoints
            ? hull.userData.fisherTransferGripPoints.map((point: any, index: number) => point.distanceTo(new three.Vector3(...hands[index])))
            : [1, -1].map((sign, index) => hull.localToWorld(boatContact.boatRimPoint(sign * (hull.userData.fisherGripSide ?? 1), along)
            .add(new three.Vector3(0, pose.gripDepth + (hull.userData.fisherRailTop ?? 0), 0)))
            .distanceTo(new three.Vector3(...hands[index])));
        }
        pictures.push({ name: `${variant}-${minimal ? "minimal" : "high"}-${sample.action}${"suffix" in sample ? sample.suffix : ""}`, hands, gripErrors,
          beforeHands,
          png: preview.renderer.domElement.toDataURL("image/png").split(",")[1] });
        camera.position.set(0, .7, 3); camera.lookAt(0, .65, 0);
        preview.renderer.render(preview.scene, camera);
        pictures.push({ name: `${variant}-${minimal ? "minimal" : "high"}-${sample.action}${"suffix" in sample ? sample.suffix : ""}-front`, hands, gripErrors,
          png: preview.renderer.domElement.toDataURL("image/png").split(",")[1] });
        camera.position.set(2, 1.6, 3); camera.lookAt(0, .55, 0);
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
          png: preview.renderer.domElement.toDataURL("image/png").split(",")[1] });
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
        png: preview.renderer.domElement.toDataURL("image/png").split(",")[1] });
      boats.dispose();
      if (boats.group.parent) throw new Error("Disposed skiff group remained in the scene");
      people.dispose();
      held.dispose(); worker.dispose(); pack.dispose();
    }
    textures.dispose(); return pictures;
  }, { nation, variant, workerModule: `/@fs${resolve("../island-of-settlers-worker-generation/src/game-three-worker.ts")}` });
  for (const capture of captures) writeFileSync(resolve(output, `${capture.name}.png`), Buffer.from(capture.png, "base64"));
  writeFileSync(resolve(output, `${variant}-runtime-review.json`), JSON.stringify({ captures: captures.map(({ name, hands, gripErrors, rowGripError, beforeHands }) =>
    ({ name, hands, gripErrors, rowGripError, beforeHands })), errors }, null, 2));
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Captured ${captures.length} runtime poses to ${output}`);
} finally { await browser.close(); await server.close(); }

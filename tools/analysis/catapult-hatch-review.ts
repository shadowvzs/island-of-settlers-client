import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Group, Mesh, MeshBasicMaterial, Vector3 } from "three";

import type { ArmourRank } from "../../../island-of-settlers-worker-generation/src/game-three-armour";
import { TRIPO_ROSTER } from "../../../island-of-settlers-worker-generation/src/tripo-roster";
import { getAuthoredBuildingPlot } from "../../src/render-common/buildings/building-plot-profile";
import { CATAPULT_HATCH, CATAPULT_STONE_DIAMETER } from "../../src/render-common/buildings/catapult-mechanism";
import { playerAvatarBody } from "../../src/render-common/workers/player-avatar";
import { WORKER_HEIGHT, WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { getJobAction, getWorkerHeldProp, getWorkerSecondaryProp } from "../../src/render-common/workers/worker-job-actions";
import type { WorkerFrame, WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createCatapultRockGeometry } from "../../src/renderers/three/buildings/catapult-rock-geometry";
import { createWorkerCatapultSupport } from "../../src/renderers/three/worker-catapult-support";
import { createCradledWareHandContacts, placeCarriedStone } from "../../src/renderers/three/worker-stone-carry";
import { applyCarriedWareScale } from "../../src/renderers/three/worker-ware-transfer";
import { convexBandHull, hatchBandPolygons } from "./catapult-band-polygons";
import { measureCatapultTorsoRock } from "./catapult-body-rock-overlap";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { describeHatchBands, emptyHatchBands, fitHatchSweep, hatchBandEnvelope, headCenteredHatchBands, measureHatchPose, mergeHatchBands,
  optimizeHatchSweep, snapshotHatchGeometry } from "./catapult-hatch-sections";

const native = await loadCatapultCpuPoser(), { createWorkerPoser } = native;
const poseSources = ["src/renderers/three/three-worker.ts", "src/renderers/three/worker-catapult-stair-tuck.ts",
  "src/renderers/three/worker-stone-carry.ts", "src/renderers/three/worker-cradle-carry.ts",
  "src/shared/settlement/military-catapult-resupply-actors.ts", "src/app/settlement/catapult-render-frame.ts"];
const poseSourceHashes = Object.fromEntries(await Promise.all(poseSources.map(async path =>
  [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const output = resolve(process.env.HATCH_REVIEW_OUTPUT ?? "../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const scale = getAuthoredBuildingPlot(16)!.structureScale, half = CATAPULT_HATCH.size * scale / 2;
const proposedClimbHeading = Number(process.env.HATCH_CLIMB_HEADING_DEGREES ?? 41.9) * Math.PI / 180;
const bandStep = Number(process.env.HATCH_BAND_STEP ?? .01);
const assets = await createHatchAuditAssets();
const nowOriginal = performance.now.bind(performance);
let poseClock = nowOriginal();
Object.defineProperty(performance, "now", { configurable: true, value: () => poseClock });
const nations = (process.env.HATCH_NATIONS?.split(",") ?? Object.keys(TRIPO_ROSTER)) as WorkerNation[];
const civilian = process.env.HATCH_CIVILIAN === "1";
const tucked = process.env.HATCH_NORMAL_CARRY !== "1";
const ranks: (ArmourRank | undefined)[] = civilian ? [undefined] : ["recruit", "soldier", "centurion"];
const reports = [];
const allHulls = { up: [] as [number, number][], down: [] as [number, number][] };
const diagonalBands = { up: emptyHatchBands(bandStep), down: emptyHatchBands(bandStep) };
const headCenteredBands = { up: emptyHatchBands(bandStep), down: emptyHatchBands(bandStep) };
const diagonalPolygons = { up: Array.from({ length: Math.ceil(1.6 / bandStep) }, () => [] as [number, number][]),
  down: Array.from({ length: Math.ceil(1.6 / bandStep) }, () => [] as [number, number][]) };
try {
  for (const nation of nations) for (const variant of process.env.HATCH_ALL_BODIES
    ? [...TRIPO_ROSTER[nation].male, ...TRIPO_ROSTER[nation].female]
    : [process.env.HATCH_BODY ?? playerAvatarBody(nation, "male").variant])
    for (const minimal of [false, true]) for (const rank of ranks) {
    const worker = rank ? await assets.soldier(nation, variant, rank, minimal)
      : await assets.civilian(nation, variant, minimal);
    const group = new Group(); group.add(worker.root); group.position.y = .005;
    worker.root.scale.setScalar(WORKER_SCALE);
    const pose = createWorkerPoser(worker), support = createWorkerCatapultSupport(worker.root);
    const shape = new Group(); shape.name = "ware_geometry";
    const rockGeometry = createCatapultRockGeometry(!minimal);
    rockGeometry.scale(...Array(3).fill(CATAPULT_STONE_DIAMETER * scale / WORKER_SCALE) as [number, number, number]);
    shape.add(new Mesh(rockGeometry, new MeshBasicMaterial()));
    const stone = new Group(); stone.name = "carried_catapult_stone"; stone.add(shape); worker.root.add(stone);
    applyCarriedWareScale(stone, worker.root, undefined, true);
    const contacts = createCradledWareHandContacts(worker.root);
    const phases: (ReturnType<typeof measureHatchPose> & { direction: "up" | "down"; phase: number; heading: number;
      action: WorkerFrame["action"]; witnessElapsed: number | undefined;
      torsoRockOverlap?: ReturnType<typeof measureCatapultTorsoRock> })[] = [];
    const bodyBands = { up: emptyHatchBands(bandStep), down: emptyHatchBands(bandStep) };
    for (const direction of ["up", "down"] as const) for (const phase of [0, .25, .5, .75]) {
      const carrying = direction === "up", heading = carrying ? Math.PI : Math.atan2(.07, .22);
      const job = civilian ? "Carrier" : "Soldier";
      const frame = { actorId: 0, nation, variant, visible: true, action: getJobAction(job, "idle", carrying ? "stone" : null),
        workerJob: job, workerTool: undefined, carryingWare: carrying ? "stone" : null,
        standingCarry: carrying, catapultTuckedCarry: tucked, catapultStoneDiameter: CATAPULT_STONE_DIAMETER * scale,
        armourRank: rank, gaitPhase: phase, runBlend: 0, animationTime: phase * 3,
        heading, x: 0, y: 0, z: 0, selected: false, target: null } as WorkerFrame;
      worker.root.rotation.set(0, heading, 0); support.present(frame);
      poseClock += 1000; pose(frame); poseClock += 1000; pose(frame); support.capture(frame);
      stone.visible = carrying;
      if (carrying) { placeCarriedStone(stone, tucked); stone.userData.catapultTucked = tucked;
        contacts(stone, { direction: "pickup", ware: "stone", progress: 1, target: frame }, true); }
      assert(!getWorkerSecondaryProp(frame), "A porter must not carry a drawn offhand shield");
      assert.equal(getWorkerHeldProp(frame)?.id ?? null, carrying ? "stone" : null);
      const geometry = snapshotHatchGeometry(group), measured = measureHatchPose(geometry, half);
      const torsoRockOverlap = carrying && process.env.HATCH_TORSO_OVERLAP === "1"
        ? measureCatapultTorsoRock(worker.root, stone) : undefined;
      const diagonal = proposedClimbHeading + (direction === "up" ? Math.PI : 0) - heading;
      const bands = hatchBandEnvelope(geometry, diagonal, bandStep);
      if (process.env.HATCH_PROFILE_HULLS === "1") hatchBandPolygons(geometry, diagonal, bandStep).forEach((polygon, index) => {
        diagonalPolygons[direction][index] = convexBandHull([...diagonalPolygons[direction][index]!, ...polygon]);
      });
      mergeHatchBands(bodyBands[direction], bands); mergeHatchBands(diagonalBands[direction], bands);
      const head = worker.root.getObjectByName("Head")!.getWorldPosition(new Vector3());
      const headX = head.x * Math.cos(diagonal) + head.z * Math.sin(diagonal);
      const headZ = head.z * Math.cos(diagonal) - head.x * Math.sin(diagonal);
      mergeHatchBands(headCenteredBands[direction], headCenteredHatchBands(bands, headX, headZ));
      allHulls[direction].push(...measured.hull);
      const witness = measured.worst.witness;
      phases.push({ direction, phase, heading, action: frame.action, torsoRockOverlap, ...measured,
        witnessElapsed: witness ? (direction === "up" ? CATAPULT_HATCH.position[1] * scale - witness[1] : witness[1]) / .4 : undefined });
    }
    const fits = ["up", "down"].map(direction => {
      const hull = phases.filter(phase => phase.direction === direction).flatMap(phase => phase.hull);
      return { direction, current: fitHatchSweep(hull, 0), optimal: optimizeHatchSweep(hull) };
    });
    reports.push({ nation, variant, rank, detail: minimal ? "minimal" : "high", phases, fits,
      diagonalBands: Object.entries(bodyBands).map(([direction, bands]) => ({ direction, bands: describeHatchBands(bands) })) });
    console.log(`${nation}/${variant}/${rank}/${minimal ? "minimal" : "high"}: ${Math.min(...phases.map(phase => phase.clearance)).toFixed(5)} m`);
    worker.dispose(); rockGeometry.dispose();
  }
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/review.json`, JSON.stringify({ hatch: { ...CATAPULT_HATCH, structureScale: scale, worldWidth: half * 2 },
    workerScale: WORKER_SCALE, workerHeight: WORKER_HEIGHT, proposedClimbHeading, bandStep,
    sourceHashes: Object.fromEntries(assets.assets), poseSourceHashes,
    diagonalPolygons,
    headCenteredBands: Object.entries(headCenteredBands).map(([direction, bands]) => ({ direction, bands: describeHatchBands(bands) })),
    diagonalBands: Object.entries(diagonalBands).map(([direction, bands]) => ({ direction, bands: describeHatchBands(bands) })),
    aggregateFits: Object.entries(allHulls).map(([direction, hull]) => ({ direction, current: fitHatchSweep(hull, 0),
      optimal: optimizeHatchSweep(hull), candidates: [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2].map(yaw => fitHatchSweep(hull, yaw)) })), reports }, null, 2));
  await writeFile(`${output}/source-note.txt`, await readFile(import.meta.filename, "utf8"));
} finally { assets.restore(); native.restore(); Object.defineProperty(performance, "now", { configurable: true, value: nowOriginal }); }

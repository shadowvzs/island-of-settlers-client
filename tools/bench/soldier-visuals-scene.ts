/**
 * Browser half of tools/bench/soldier-visuals-review.ts: every nation's foot soldiers and rider,
 * each next to an enemy army of another nation in its own gear (red livery and tunics), through
 * the real crowd and cavalry layers; close and gameplay-distance contact sheets, the rider's
 * parry and cut, the High rider's near / far detail at the switch size, and triangle counts.
 */
import * as three from "three";

import { computeEnvironment } from "../../src/render-common/environment";
import type { MountFrame } from "../../src/render-common/mounts/mount-frame";
import { NATION_RIDERS } from "../../src/render-common/mounts/nation-riders";
import type { WorkerFrame, WorkerNation } from "../../src/render-common/workers/worker-unit";
import { NEAR_PIXELS_PER_CELL } from "../../src/renderers/three/mount-detail";
import { createThreeMounts } from "../../src/renderers/three/three-mounts";
import { createThreeWorkerCrowd, createWorkerTextureLoader } from "../../src/renderers/three/three-worker";

type Troop = "shield" | "heavy" | "archer";
type Point = [number, number, number];

const NATIONS: readonly WorkerNation[] = ["roman", "viking", "nubian", "japanese"];
/** The sheets show each nation against the next one's army. */
const SHOWN_ENEMY: Record<WorkerNation, WorkerNation> = {
  maya: "viking",
  persian: "viking",
  chinese: "viking",
  indigenous: "viking",
  japanese: "roman", nubian: "japanese", roman: "viking", viking: "nubian"
};
const VARIANTS: Record<WorkerNation, string> = {
  maya: "roman-man-dark",
  persian: "roman-man-dark",
  chinese: "roman-man-dark",
  indigenous: "roman-man-dark", japanese: "japanese-man-grey", nubian: "nubian-man-scarf",
  roman: "roman-man-dark", viking: "viking-man-blond" };
const TOOLS: Record<Troop, string> = { archer: "bow", heavy: "axe", shield: "sword" };
const TROOPS: readonly Troop[] = ["shield", "heavy", "archer"];
const BACKGROUND = "#9aa391";
/** Gameplay sheet: a map cell spans this many pixels (zoom 2 on a 1x display). */
const GAMEPLAY_PIXELS_PER_CELL = 90;
const FOV = 30;

const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

const soldierFrame = (nation: WorkerNation, troop: Troop, faction: number, actorId: number, x: number) => ({
  actorId, nation, variant: VARIANTS[nation], x, y: 0, z: 0, heading: 0, selected: false, visible: true,
  action: "idle_breathe", gaitPhase: 0, runBlend: 0, animationTime: .4, target: null, workerJob: "Soldier",
  workerTool: TOOLS[troop], armourRank: "soldier", carryingWare: null,
  combat: { attackProgress: null, defending: false, doorMelee: false, faction, type: troop, variant: 0 }
} as WorkerFrame);

const riderFrame = (nation: WorkerNation, faction: number, actorId: number, x: number): MountFrame => ({
  actorId, rider: NATION_RIDERS[nation], coat: ["bay", "chestnut", "dark-bay"][actorId % 3]!, nation, faction,
  x, y: 0, z: 0, heading: 0, clip: "idle", clipTime: .4, turnRate: 0, attackProgress: null, selected: false
});

/** Camera distance at which a map cell spans `pixels` screen pixels (vertical field of view). */
const rangeFor = (pixels: number) => innerHeight / (2 * pixels * Math.tan(FOV * Math.PI / 360));

export const runSoldierVisualsReview = async (quality: "high" | "minimal") => {
  const detailed = quality === "high";
  const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = three.ACESFilmicToneMapping; renderer.autoClear = false;
  renderer.setClearColor(BACKGROUND); document.body.append(renderer.domElement);
  const textures = createWorkerTextureLoader(renderer);
  const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
  const crowd = await createThreeWorkerCrowd(textures, [], detailed);
  const mounts = await createThreeMounts(textures, [], detailed);
  const ground = new three.Scene();
  ground.add(new three.HemisphereLight(0xffffff, 0x777777, 2));
  const floor = new three.Mesh(new three.PlaneGeometry(400, 400), new three.MeshLambertMaterial({ color: 0x8c8a6c }));
  floor.rotation.x = -Math.PI / 2; ground.add(floor);
  const camera = new three.PerspectiveCamera(FOV, innerWidth / innerHeight, .05, 400);
  let workers: WorkerFrame[] = [], riders: MountFrame[] = [];
  const draw = () => {
    renderer.clear(); renderer.render(ground, camera); crowd.render(renderer, camera); mounts.render(renderer, camera);
  };
  const settle = async (ticks = 30) => {
    for (let tick = 0; tick < 900; tick++) {
      crowd.update(workers, environment); mounts.update(riders, environment); draw();
      if (crowd.poolStats().instances >= workers.length && tick > (riders.length ? ticks + 20 : ticks)) break;
      await wait(20);
    }
  };
  const look = (target: Point, range: number, direction: Point = [.55, .42, .75]) => {
    const length = Math.hypot(...direction);
    camera.position.set(...target.map((value, axis) => value + direction[axis]! / length * range) as Point);
    camera.lookAt(...target); camera.updateMatrixWorld();
  };
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!;
  const sheets: { name: string; png: string }[] = [];
  const startSheet = (columns: number, rows: number, size: number) => {
    canvas.width = columns * size; canvas.height = rows * size;
    context.fillStyle = BACKGROUND; context.fillRect(0, 0, canvas.width, canvas.height);
  };
  /** Copies the centre of the view into a cell; `crop` px of the screen (unscaled when crop = size). */
  const capture = (column: number, row: number, size: number, crop = innerHeight) => {
    draw();
    context.drawImage(renderer.domElement, (innerWidth - crop) / 2, (innerHeight - crop) / 2, crop, crop,
      column * size, row * size, size, size);
  };
  const label = (text: string, column: number, row: number, size: number) => {
    context.fillStyle = "#1d2117"; context.font = "13px sans-serif";
    context.fillText(text, column * size + 5, row * size + 14);
  };
  const finish = (name: string) => sheets.push({ name, png: canvas.toDataURL("image/png").split(",")[1]! });
  const count = () => {
    renderer.info.reset(); renderer.info.autoReset = false; draw(); renderer.info.autoReset = true;
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  };

  // Triangles of one rider: close, at gameplay distance and from far out.
  const triangles: Record<string, unknown> = {};
  for (const [index, nation] of NATIONS.entries()) {
    riders = [riderFrame(nation, 0, 10 + index, 0)]; workers = [];
    const counts: Record<string, unknown> = {};
    for (const [name, pixels] of [["close", 220], ["gameplay", GAMEPLAY_PIXELS_PER_CELL], ["far", 40]] as const) {
      look([0, 1.1, 0], rangeFor(pixels));
      await settle(name === "close" ? 60 : 4);
      counts[name] = count();
    }
    triangles[`${nation}-rider`] = counts;
  }
  // Forty riders (ten per nation) at gameplay distance and close up: the many-riders budget.
  riders = Array.from({ length: 40 }, (_, index) =>
    riderFrame(NATIONS[index % 4]!, index % 8 < 4 ? 0 : 1, 100 + index, (index % 10) * 1.6 - 7.2));
  riders.forEach((rider, index) => { rider.z = Math.floor(index / 10) * 2.6 - 3.9; });
  look([0, .6, 0], rangeFor(32), [0, .9, .6]);
  await settle(60);
  triangles["riders-40-gameplay"] = count();
  const army = renderer.domElement.toDataURL("image/png").split(",")[1]!;
  sheets.push({ name: `${quality}-riders-40`, png: army });

  // Contact sheets: per nation its own troops, then an enemy army of another nation.
  const columns = ["shield", "heavy", "archer", "rider", "enemy shield", "enemy heavy", "enemy archer", "enemy rider"];
  for (const [view, size] of [["close", 230], ["gameplay", 200]] as const) {
    startSheet(columns.length, NATIONS.length, size);
    for (const [row, nation] of NATIONS.entries()) {
      const enemy = SHOWN_ENEMY[nation], base = 1000 + row * 20;
      workers = [...TROOPS.map((troop, index) => soldierFrame(nation, troop, 0, base + index, index * 3)),
        ...TROOPS.map((troop, index) => soldierFrame(enemy, troop, 1, base + 4 + index, 12 + index * 3))];
      riders = [riderFrame(nation, 0, base + 8, 9), riderFrame(enemy, 1, base + 9, 21)];
      const targets = [0, 3, 6, 9, 12, 15, 18, 21];
      for (const [column, x] of targets.entries()) {
        const mounted = column === 3 || column === 7;
        const close = view === "close";
        const closeRange = mounted ? 4.6 : 3;
        look([x, mounted ? 1.05 : .6, 0], close ? closeRange : rangeFor(GAMEPLAY_PIXELS_PER_CELL));
        await settle(close ? 30 : 6);
        capture(column, row, size, close ? innerHeight : size);
        label(`${row ? "" : `${columns[column]} `}${column < 4 ? nation : enemy}`, column, row, size);
      }
    }
    finish(`${quality}-nations-${view}`);
  }

  // Riders: rest, half and full parry, the cut's wind-up and blow (from the front, close).
  const poses = [["rest", null, 0], ["parry .5", null, .5], ["parry", null, 1], ["wind-up", .4, 0],
    ["cut", .78, 0]] as const;
  startSheet(poses.length, NATIONS.length, 230);
  for (const [row, nation] of NATIONS.entries()) {
    workers = [];
    riders = [riderFrame(nation, row % 2, 2000 + row, 0)];
    for (const [column, [name, progress, guard]] of poses.entries()) {
      Object.assign(riders[0]!, { attackProgress: progress, guard });
      look([0, 1.15, 0], 4.2, [.4, .3, 1]);
      await settle(30);
      capture(column, row, 230);
      label(`${name} ${nation}`, column, row, 230);
    }
  }
  finish(`${quality}-rider-parry`);

  // High: the same rider at the switch size, near detail (arriving from close) and far (from far).
  if (detailed) {
    startSheet(NATIONS.length, 2, 260);
    for (const [column, nation] of NATIONS.entries()) {
      workers = []; riders = [riderFrame(nation, 0, 3000 + column, 0)];
      for (const [row, from] of [[0, 400], [1, 20]] as const) {
        look([0, 1.1, 0], rangeFor(from)); await settle(40);
        look([0, 1.1, 0], rangeFor(NEAR_PIXELS_PER_CELL)); await settle(4);
        capture(column, row, 260, 260);
        label(`${nation} ${row ? "far" : "near"} detail`, column, row, 260);
      }
    }
    finish(`${quality}-rider-detail-switch`);
  }
  crowd.dispose(); mounts.dispose(); renderer.dispose();
  return { sheets, triangles };
};

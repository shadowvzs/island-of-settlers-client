/**
 * Browser half of tools/bench/troop-portraits.ts: every nation's troop types as the actual
 * soldier models in the game (real crowd and cavalry layers, nation body, rank-specific armour,
 * issued nation gear, player livery), standing idle, rendered on a transparent background with
 * one camera and light set per kind (foot / mounted).
 */
import { type SoldierEntry, soldierEntries } from "@shared/catalog";
import * as three from "three";

import { computeEnvironment } from "../../src/render-common/environment";
import type { MountFrame } from "../../src/render-common/mounts/mount-frame";
import { NATION_RIDERS } from "../../src/render-common/mounts/nation-riders";
import { playerAvatarBody } from "../../src/render-common/workers/player-avatar";
import { WORKER_NATIONS } from "../../src/render-common/workers/worker-appearance";
import type { WorkerFrame, WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createThreeMounts } from "../../src/renderers/three/three-mounts";
import { createThreeWorkerCrowd, createWorkerTextureLoader } from "../../src/renderers/three/three-worker";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { militaryArmourRank } from "../../src/shared/settlement/settlement-military-ranks";

type Point = [number, number, number];
/** One rendered portrait: ranked (`soldier.portrait.ranked`) or, without `rank`, the generic one. */
export interface TroopPortrait { nation: WorkerNation; png: string; rank?: number; troop: MilitaryTroopType }

/** The generic (unranked) portrait shows the Soldier tier. */
const GENERIC_PORTRAIT_RANK = 1;
/** Ranks a troop is drawn at: each declared rank with ranked portraits, else only the generic tier. */
const portraitRanks = (entry: SoldierEntry) => {
  const ranks = entry.variants?.rank;
  if (!entry.soldier.portrait.ranked || !ranks) return [GENERIC_PORTRAIT_RANK];
  return Array.from({ length: ranks.max - ranks.min + 1 }, (_, index) => ranks.min + index);
};
interface Framing { direction: Point; range: number; target: Point }

const NATIONS: readonly WorkerNation[] = WORKER_NATIONS;
/** Every soldier entry (retired cavalry included: its generic portrait stays in use for saved riders). */
const TROOPS = soldierEntries();
/** One recognisable body per nation (the soldier visuals review uses the same ones). */
const VARIANTS: Record<WorkerNation, string> = {
  maya: playerAvatarBody("maya", "male").variant,
  persian: playerAvatarBody("persian", "male").variant,
  chinese: playerAvatarBody("chinese", "male").variant,
  indigenous: playerAvatarBody("indigenous", "male").variant, japanese: "japanese-man-grey", nubian: "nubian-man-scarf",
  roman: "roman-man-dark", viking: "viking-man-blond" };
const TOOLS: Record<Exclude<MilitaryTroopType, "cavalry">, string> = { archer: "bow", heavy: "axe", shield: "sword" };
// One shared head-and-torso frame leaves room for the Veteran horns/plumes without clipping them.
const FOOT: Framing = { direction: [.42, .2, 1], range: 2.2, target: [0, .83, 0] };
const MOUNTED: Framing = { direction: [.75, .25, 1], range: 2.2, target: [.15, 1.11, -.05] };
const FOV = 30;
/** The soldier turned a little towards the camera's left, like the worker portraits. */
const HEADING = .35;
/** The horse turned further, so its flank and the rider's gear read in three-quarter view. */
const MOUNTED_HEADING = 1.25;

const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

const soldierFrame = (
  nation: WorkerNation, troop: Exclude<MilitaryTroopType, "cavalry">, actorId: number, rank: number
): WorkerFrame => ({
  actorId, nation, variant: VARIANTS[nation], x: 0, y: 0, z: 0, heading: HEADING, selected: false,
  visible: true, action: "idle_breathe", gaitPhase: 0, runBlend: 0, animationTime: .4, target: null,
  workerJob: "Soldier", workerTool: TOOLS[troop], armourRank: militaryArmourRank(rank), carryingWare: null,
  combat: { attackProgress: null, defending: false, doorMelee: false, faction: 0, type: troop, variant: 0 }
} as WorkerFrame);

const riderFrame = (nation: WorkerNation, actorId: number): MountFrame => ({
  actorId, rider: NATION_RIDERS[nation], coat: "bay", nation, faction: 0, x: 0, y: 0, z: 0,
  heading: MOUNTED_HEADING, clip: "idle", clipTime: .4, turnRate: 0, attackProgress: null, selected: false
});

export const renderTroopPortraits = async (size: number, nations: readonly WorkerNation[] = NATIONS) => {
  const renderer = new three.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(size, size);
  renderer.toneMapping = three.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
  document.body.append(renderer.domElement);
  const textures = createWorkerTextureLoader(renderer);
  const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
  const crowd = await createThreeWorkerCrowd(textures, [], true);
  const mounts = await createThreeMounts(textures, [], true);
  const camera = new three.PerspectiveCamera(FOV, 1, .05, 100);
  let workers: WorkerFrame[] = [], riders: MountFrame[] = [];
  const draw = () => { renderer.clear(); crowd.render(renderer, camera); mounts.render(renderer, camera); };
  const settle = async () => {
    for (let tick = 0; tick < 900; tick++) {
      crowd.update(workers, environment); mounts.update(riders, environment); draw();
      if (crowd.poolStats().instances >= workers.length && tick > (riders.length ? 90 : 40)) return;
      await wait(20);
    }
  };
  const look = ({ direction, range, target }: Framing) => {
    const length = Math.hypot(...direction);
    camera.position.set(...target.map((value, axis) => value + direction[axis]! / length * range) as Point);
    camera.lookAt(...target); camera.updateMatrixWorld();
  };
  const portraits: TroopPortrait[] = [];
  for (const nation of nations) for (const entry of TROOPS) {
    // Only the nations whose portraits the catalog lists (the others reuse a fallback body).
    if (!entry.soldier.portrait.nations.includes(nation)) continue;
    const troop = entry.key as MilitaryTroopType, mounted = troop === "cavalry";
    for (const rank of portraitRanks(entry)) {
      const actorId = portraits.length + 1;
      workers = mounted ? [] : [soldierFrame(nation, troop, actorId, rank)];
      riders = mounted ? [riderFrame(nation, actorId)] : [];
      look(mounted ? MOUNTED : FOOT);
      await settle();
      draw();
      const png = renderer.domElement.toDataURL("image/png").split(",")[1]!;
      if (entry.soldier.portrait.ranked) portraits.push({ nation, png, rank, troop });
      if (rank === GENERIC_PORTRAIT_RANK) portraits.push({ nation, png, troop });
    }
  }
  crowd.dispose(); mounts.dispose(); textures.dispose(); renderer.dispose();
  return portraits;
};

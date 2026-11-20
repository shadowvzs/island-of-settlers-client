/**
 * The owner's example sequence as data (CIN3 dev hook and tests): cinematic mode with letterbox, a 2 s blend from
 * the player's view to shot A with a dolly/orbit drift, an advisor line,
 * shot B over 3 s (low, so Minimal shows its pitch clamp) with a pan, a highlighted ridge with lightning and a
 * shake, a dip to black, then the 2 s restore.
 * Shots and regions are placed around the current view, so it plays on any map.
 */
import type { MapRegion } from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type {
  CameraShot, CampaignSpeaker, CinematicSequence, CinematicStep, CinematicStepBody
} from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { CameraOrbit } from "../../../render-common/cinematic/cinematic-frame";
import type { CinematicSequenceContext } from "./ports";

const DEGREE = Math.PI / 180;

/** Authored review layout (world units and radians), relative to the view the sequence starts from. */
const LAYOUT = {
  harbourOffsetX: 6,
  ridgeOffsetX: 16,
  ridgeOffsetZ: -12,
  ridgeRadius: 5,
  shotA: { distanceShare: 0.45, dollyShare: 0.7, fov: 30 * DEGREE, maxDistance: 70, minDistance: 28,
    pitch: 32 * DEGREE, yawBy: 0.5 },
  shotB: { distance: 34, fov: 34 * DEGREE, lift: 1, pitch: 16 * DEGREE, yawBy: -0.7 }
} as const;

export const FIXTURE_SEQUENCE_ID = "cin3-owner-example";

const FIXTURE_SPEAKERS: CampaignSpeaker[] = [{
  id: "advisor",
  name: { en: "Advisor Aurelia", hu: "Aurélia tanácsadó" },
  portraits: { neutral: "advisor-neutral" },
  side: "left"
}];

const step = (id: string, start: CinematicStep["start"], delayMs: number, body: CinematicStepBody): CinematicStep =>
  ({ ...body, delayMs, id, start });

const FIXTURE_STEPS: CinematicStep[] = [
  step("mode-on", "afterPrevious", 0, { kind: "cinematicMode", letterbox: true, on: true, transitionMs: 600 }),
  step("shot-a", "afterPrevious", 0, { drift: { distanceTo: 0, durationMs: 3000, ease: "linear", yawBy: 0.35 },
    ease: "easeInOut", kind: "camera", shotId: "shot-a", transitionMs: 2000 }),
  step("advisor", "withPrevious", 2200, { kind: "speak", speakerId: "advisor", text: {
    en: "Look there: storm clouds gather over the ridge.",
    hu: "Nézd: viharfelhők gyűlnek a gerinc felett."
  }, timing: "auto" }),
  step("shot-b", "afterPrevious", 300, { drift: { durationMs: 2500, ease: "easeOut", pitchBy: 0.06,
    targetToRegionId: "harbour" }, ease: "easeInOut", kind: "camera", shotId: "shot-b", transitionMs: 3000 }),
  step("ridge-on", "withPrevious", 3000, { kind: "highlight", on: true, regionId: "ridge" }),
  step("strike", "afterPrevious", 200, { count: 2, kind: "lightning", regionId: "ridge" }),
  step("shake", "withPrevious", 50, { durationMs: 700, kind: "cameraShake", strength: 0.8 }),
  step("dip-black", "afterPrevious", 700, { durationMs: 500, kind: "fade", to: "black" }),
  step("dip-clear", "afterPrevious", 300, { durationMs: 500, kind: "fade", to: "clear" }),
  step("ridge-off", "afterPrevious", 0, { kind: "highlight", on: false, regionId: "ridge" }),
  step("mode-off", "afterPrevious", 400, { kind: "cinematicMode", letterbox: false, on: false, transitionMs: 2000 })
];

type GroundHeight = (x: number, z: number) => number;

const fixtureShots = (start: CameraOrbit, groundHeight: GroundHeight): CameraShot[] => {
  const { shotA, shotB } = LAYOUT;
  const distanceA = Math.min(shotA.maxDistance, Math.max(shotA.minDistance, start.distance * shotA.distanceShare));
  const ridgeX = start.targetX + LAYOUT.ridgeOffsetX, ridgeZ = start.targetZ + LAYOUT.ridgeOffsetZ;
  return [
    { distance: distanceA, fov: shotA.fov, id: "shot-a", name: "Shot A", pitch: shotA.pitch,
      targetX: start.targetX, targetY: start.targetY, targetZ: start.targetZ, yaw: start.yaw + shotA.yawBy },
    { distance: shotB.distance, fov: shotB.fov, id: "shot-b", name: "Shot B", pitch: shotB.pitch, targetX: ridgeX,
      targetY: groundHeight(ridgeX, ridgeZ) + shotB.lift, targetZ: ridgeZ, yaw: start.yaw + shotB.yawBy }
  ];
};

const fixtureRegions = (start: CameraOrbit): MapRegion[] => {
  const ridgeX = start.targetX + LAYOUT.ridgeOffsetX, ridgeZ = start.targetZ + LAYOUT.ridgeOffsetZ;
  return [
    { id: "ridge", name: "Ridge", shape: { centerX: ridgeX, centerZ: ridgeZ, kind: "circle",
      radius: LAYOUT.ridgeRadius } },
    { id: "harbour", name: "Harbour", shape: { facing: 0, kind: "point", x: ridgeX + LAYOUT.harbourOffsetX,
      z: ridgeZ } }
  ];
};

/** The fixture around the view `start` (the drawn orbit); `pauseWorld` defaults to the editor default (on). */
export const createFixtureSequence = (start: CameraOrbit, groundHeight: GroundHeight, pauseWorld = true) => {
  const shots = fixtureShots(start, groundHeight);
  const steps = FIXTURE_STEPS.map(entry => entry.id === "shot-a" && entry.kind === "camera" && entry.drift
    ? { ...entry, drift: { ...entry.drift, distanceTo: shots[0]!.distance * LAYOUT.shotA.dollyShare } } : entry);
  const sequence: CinematicSequence = { id: FIXTURE_SEQUENCE_ID, name: "Owner example", pauseWorld, skippable: true,
    steps };
  const context: CinematicSequenceContext = { regions: fixtureRegions(start), shots, speakers: FIXTURE_SPEAKERS };
  return { context, sequence };
};

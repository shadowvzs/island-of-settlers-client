/**
 * CIN6 review fixture (dev hook `?cinematicTest=1`, `seek(ms, "strike")` / `play(true, "strike")`): a field next
 * to the current view is highlighted in the player's own view for 2.5 s (the glint at normal gameplay zoom), then
 * cinematic mode blends to a low shot of the field (9 degrees: Minimal lifts it to its 30 degree clamp), a
 * ground-reaching strike lands in the field, and the view is handed back.
 */
import type { MapRegion } from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type {
  CameraShot, CinematicSequence, CinematicStep, CinematicStepBody
} from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { CameraOrbit } from "../../../render-common/cinematic/cinematic-frame";
import type { CinematicSequenceContext } from "./ports";

const DEGREE = Math.PI / 180;

/** Review layout (world units, radians, ms) relative to the view the sequence starts from. */
const LAYOUT = {
  fieldOffsetX: 10,
  fieldOffsetZ: -6,
  fieldRadius: 6,
  low: { distance: 30, fov: 40 * DEGREE, lift: 0.8, pitch: 9 * DEGREE, yawBy: 0.4 }
} as const;

export const STRIKE_FIXTURE_ID = "cin6-ground-strike";
/** When the strike lands (ms from the start), for review stills. */
export const STRIKE_FIXTURE_STRIKE_MS = 5100;

const step = (id: string, start: CinematicStep["start"], delayMs: number, body: CinematicStepBody): CinematicStep =>
  ({ ...body, delayMs, id, start });

const STEPS: CinematicStep[] = [
  step("field-on", "afterPrevious", 0, { kind: "highlight", on: true, regionId: "field" }),
  step("mode-on", "afterPrevious", 2500, { kind: "cinematicMode", letterbox: true, on: true, transitionMs: 500 }),
  step("low-shot", "withPrevious", 0, { ease: "easeInOut", kind: "camera", shotId: "low", transitionMs: 2000 }),
  step("strike", "afterPrevious", 600, { count: 1, kind: "lightning", regionId: "field" }),
  step("field-off", "afterPrevious", 900, { kind: "highlight", on: false, regionId: "field" }),
  step("mode-off", "afterPrevious", 0, { kind: "cinematicMode", letterbox: false, on: false, transitionMs: 1500 })
];

type GroundHeight = (x: number, z: number) => number;

export const createStrikeFixture = (start: CameraOrbit, groundHeight: GroundHeight, pauseWorld = true) => {
  const fieldX = start.targetX + LAYOUT.fieldOffsetX, fieldZ = start.targetZ + LAYOUT.fieldOffsetZ;
  const { low } = LAYOUT;
  const shots: CameraShot[] = [{ distance: low.distance, fov: low.fov, id: "low", name: "Low shot", pitch: low.pitch,
    targetX: fieldX, targetY: groundHeight(fieldX, fieldZ) + low.lift, targetZ: fieldZ, yaw: start.yaw + low.yawBy }];
  const regions: MapRegion[] = [{ id: "field", name: "Field", shape: { centerX: fieldX, centerZ: fieldZ,
    kind: "circle", radius: LAYOUT.fieldRadius } }];
  const sequence: CinematicSequence = { id: STRIKE_FIXTURE_ID, name: "Ground strike review", pauseWorld,
    skippable: true, steps: STEPS };
  const context: CinematicSequenceContext = { regions, shots, speakers: [] };
  return { context, sequence };
};

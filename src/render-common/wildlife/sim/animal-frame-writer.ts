import { sampleBilinear } from "../../../shared/world/grid-geometry";
import { lerp } from "../../../shared/world/noise";
import { getViewDistance } from "../../birds/bird-view";
import { getCarcassFade, getDeathRoll } from "../../helpers";
import { type AnimalMotion,computeAnimalPose, createRestMotion } from "../model/animal-pose";
import { POSE_CHANNELS } from "../model/animal-rig";
import { TORSO } from "../model/leg-geometry";
import { getBodySway } from "../model/secondary-motion";
import { lerpAngle } from "../nav/nav-steering";
import { getSpecies } from "../wildlife-species";
import { getAnimalStage, getAnimalVariant, getAntlerScale } from "./animal-age";
import { readMotion } from "./animal-animation";
import { type FootPlacementBody,placeFeet } from "./animal-foot-placement";
import type { AnimalFrame, AnimalHistory } from "./animal-pool";
import type { WildlifeContext } from "./wildlife-context";

/**
 * Foot placement only for animals this large in the view (body length over the view's half
 * width): far ones keep the plain pose (distance LOD).
 */
const FOOT_IK_VIEW_SHARE = 0.03;

/** How much foot placement applies: standing and walking animals close to the camera. */
const getFootBlend = (
  context: WildlifeContext,
  species: number,
  motion: AnimalMotion,
  body: FootPlacementBody
) => {
  if (motion.death > 0 || motion.rest >= 1) return 0;
  const length = getSpecies(species).length;
  const { region } = context;
  if (getViewDistance(region, body.x, body.z) > 1.05) return 0;
  if (length * body.scale < region.halfU * FOOT_IK_VIEW_SHARE) return 0;
  return 1 - motion.rest;
};

/**
 * Writes animals into the renderer frame: position interpolated `alpha` between the last two
 * fixed steps, smoothed tilt, the joint angles of the shared pose (body lift included), feet
 * placed on the ground near the camera, and a carcass's fall, roll and fade.
 */
export const createFrameWriter = (
  context: WildlifeContext,
  history: AnimalHistory,
  vertexFog: Float32Array
) => {
  const motion = createRestMotion();
  const body: FootPlacementBody = { heading: 0, pitch: 0, roll: 0, scale: 1, x: 0, y: 0, z: 0 };
  const { pool, world } = context;

  /**
   * Body placement (instance transform) of an animal this frame, the pose lift included, the
   * walking weight shift and the lean into turns on top of the slope roll. Returns the ground.
   */
  const placeBody = (animal: number, alpha: number, lift: number) => {
    const size = pool.bodyScale[animal]!;
    const ground = lerp(history.y[animal]!, pool.y[animal]!, alpha);
    body.x = lerp(history.x[animal]!, pool.x[animal]!, alpha);
    body.z = lerp(history.z[animal]!, pool.z[animal]!, alpha);
    body.y = ground + lift * size;
    body.heading = lerpAngle(history.heading[animal]!, pool.heading[animal]!, alpha);
    body.pitch = context.motion.pitch[animal]!;
    body.roll =
      context.motion.roll[animal]! +
      getDeathRoll(motion.death) +
      getBodySway(pool.species[animal]!, motion);
    body.scale = size;
    return ground;
  };

  /** A carcass sinks into the ground while it fades out. */
  const writeCarcass = (frame: AnimalFrame, animal: number, slot: number) => {
    const fade = getCarcassFade(pool.deathTime[animal]!);
    const depth = TORSO[pool.species[animal]!]!.halfWidth * 2 * pool.bodyScale[animal]!;
    frame.y[slot] = frame.y[slot]! - fade * depth;
    frame.appear[slot] = frame.appear[slot]! * (1 - fade);
  };

  const writeLook = (frame: AnimalFrame, animal: number, slot: number) => {
    frame.shade[slot] = pool.shade[animal]!;
    for (let channel = 0; channel < 4; channel += 1) {
      frame.coat[slot * 4 + channel] = pool.coat[animal * 4 + channel]!;
    }
    frame.tone[slot] = pool.tone[animal]!;
    frame.species[slot] = pool.species[animal]!;
    frame.antlers[slot] = getAntlerScale(pool, animal);
    frame.stage[slot] = getAnimalStage(pool, animal);
    frame.variant[slot] = getAnimalVariant(pool, animal);
    frame.appear[slot] = pool.pending[animal] ? 0 : pool.appear[animal]!;
  };

  return (frame: AnimalFrame, animal: number, slot: number, alpha: number) => {
    readMotion(context, animal, motion);
    const species = pool.species[animal]!;
    const offset = slot * POSE_CHANNELS;
    const lift = computeAnimalPose(species, motion, frame.pose, offset);
    const ground = placeBody(animal, alpha, lift);
    const blend = getFootBlend(context, species, motion, body);
    const drop = placeFeet(species, frame.pose, offset, lift, body, world, blend);
    frame.x[slot] = body.x;
    frame.y[slot] = body.y + drop;
    frame.ground[slot] = ground;
    frame.z[slot] = body.z;
    frame.heading[slot] = body.heading;
    frame.pitch[slot] = body.pitch;
    frame.roll[slot] = body.roll;
    frame.scale[slot] = body.scale;
    writeLook(frame, animal, slot);
    if (pool.carcass[animal]) writeCarcass(frame, animal, slot);
    frame.visibility[slot] = sampleBilinear(world, vertexFog, body.x, body.z);
  };
};

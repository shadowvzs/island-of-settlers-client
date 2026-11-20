import { type AddBridgePart, type BridgeRecipeInput, copingTint, stoneTint } from "./bridge-recipe";
import { chordPlacement } from "./stone-bridge-parts";

/** Centre line of each parapet: outside the clear 2.6 deck, flush with the structure's outer face. */
export const PARAPET_OFFSET = 1.42;
const PARAPET_THICKNESS = 0.26;
/** Coursed wall height above the deck; the coping caps it. */
const WALL_HEIGHT = 0.45;
const COPING_HEIGHT = 0.1;
const COPING_WIDTH = 0.34;
/** Mortar joint left between neighbouring stones. */
const JOINT = 0.022;
/** End piers stand over the abutments and frame the bridge mouths. */
const END_PIER_LENGTH = 0.34;
const END_PIER_WIDTH = 0.3;
const END_PIER_RISE = 0.1;

interface WallDetail {
  copingLength: number;
  courses: number;
  /** Stone lengths cycled along a course (hand-cut, not identical). */
  stones: readonly number[];
}

const HIGH: WallDetail = { copingLength: 0.62, courses: 3, stones: [0.44, 0.34, 0.5, 0.38, 0.46, 0.36] };
const MINIMAL: WallDetail = { copingLength: 1.2, courses: 2, stones: [0.7, 0.56, 0.64] };

/** Stone boundaries of one course between `from` and `to`, offset per course for a running bond. */
const courseJoints = (detail: WallDetail, from: number, to: number, course: number, side: number) => {
  const joints = [from];
  const lengths = detail.stones;
  let index = course * 2 + side * 3, along = from + lengths[index % lengths.length]! * (course % 2 ? 0.5 : 1);
  while (along < to - 0.12) {
    joints.push(along);
    index += 1;
    along += lengths[index % lengths.length]!;
  }
  joints.push(to);
  return joints;
};

const addCourses = (
  input: BridgeRecipeInput, add: AddBridgePart, detail: WallDetail, from: number, to: number, across: number
) => {
  const courseHeight = WALL_HEIGHT / detail.courses;
  const side = across < 0 ? 0 : 1;
  for (let course = 0; course < detail.courses; course += 1) {
    const joints = courseJoints(detail, from, to, course, side);
    for (let stone = 0; stone + 1 < joints.length; stone += 1) {
      const start = joints[stone]! + JOINT / 2, end = joints[stone + 1]! - JOINT / 2;
      const placement = chordPlacement(input, start, end, course * courseHeight, courseHeight - JOINT);
      // Hand-dressed faces stand a few millimetres proud or back of the wall line.
      const face = ((stone * 7 + course * 3 + side) % 5 - 2) * 0.006;
      add({
        position: [placement.position[0], placement.position[1], across + face * Math.sign(across)],
        rotation: placement.rotation,
        shape: "stone-block",
        size: [placement.length, courseHeight - JOINT, PARAPET_THICKNESS],
        surface: "stone",
        tint: stoneTint(stone * 3 + course * 5 + side * 7)
      });
    }
  }
};

const addCoping = (
  input: BridgeRecipeInput, add: AddBridgePart, detail: WallDetail, from: number, to: number, across: number
) => {
  const pieces = Math.max(1, Math.round((to - from) / detail.copingLength));
  const pieceLength = (to - from) / pieces;
  for (let piece = 0; piece < pieces; piece += 1) {
    const start = from + piece * pieceLength, end = start + pieceLength;
    const placement = chordPlacement(input, start, end, WALL_HEIGHT, COPING_HEIGHT);
    add({
      position: [placement.position[0], placement.position[1], across],
      rotation: placement.rotation,
      shape: input.detailed ? "bevel-box" : "box",
      size: [placement.length - 0.012, COPING_HEIGHT, COPING_WIDTH],
      surface: "cut-stone",
      tint: copingTint(piece + (across < 0 ? 0 : 4))
    });
  }
};

/** Rise of a parapet pier's block above the deck (wall, coping and its own rise). */
const PIER_HEIGHT = WALL_HEIGHT + COPING_HEIGHT + END_PIER_RISE;
const PIER_CAP_HEIGHT = 0.09;

/** Top of a parapet pier's cap at `along`: finials and lamps stand here. */
export const parapetPierTop = (input: BridgeRecipeInput, along: number) =>
  input.deckTopAt(along) + PIER_HEIGHT + 0.04 + PIER_CAP_HEIGHT / 2;

/**
 * Squared pier with its own cap, standing on the deck edge. End piers frame the mouths over the
 * abutments; wider upgrade piers stand over the river piers and embrace the coursed wall and coping.
 */
export const addParapetPier = (
  input: BridgeRecipeInput, add: AddBridgePart, along: number, across: number, index: number,
  size: readonly [number, number] = [END_PIER_LENGTH, END_PIER_WIDTH]
) => {
  const deck = input.deckTopAt(along);
  add({
    position: [along, deck + PIER_HEIGHT / 2 - 0.02, across],
    shape: "stone-block",
    size: [size[0], PIER_HEIGHT, size[1]],
    surface: "stone",
    tint: stoneTint(index + 11)
  });
  add({
    position: [along, deck + PIER_HEIGHT + 0.04, across],
    shape: input.detailed ? "bevel-box" : "box",
    size: [size[0] + 0.08, PIER_CAP_HEIGHT, size[1] + 0.08],
    surface: "cut-stone",
    tint: copingTint(index + 6)
  });
};

/** Along positions of the four end piers' centres (both deck edges). */
export const parapetEndPiers = (input: BridgeRecipeInput) =>
  [END_PIER_LENGTH / 2, input.length - END_PIER_LENGTH / 2];

/**
 * Stone parapets on both deck edges: coursed, joint-separated ashlar in running bond that follows
 * the deck camber, a continuous coping, and capped end piers over the abutments at both mouths.
 */
export const addStoneParapet = (input: BridgeRecipeInput, add: AddBridgePart) => {
  const detail = input.detailed ? HIGH : MINIMAL;
  const from = END_PIER_LENGTH, to = input.length - END_PIER_LENGTH;
  for (const across of [-PARAPET_OFFSET, PARAPET_OFFSET]) {
    addParapetPier(input, add, END_PIER_LENGTH / 2, across, across < 0 ? 0 : 2);
    addParapetPier(input, add, input.length - END_PIER_LENGTH / 2, across, across < 0 ? 1 : 3);
    addCourses(input, add, detail, from, to, across);
    addCoping(input, add, detail, from, to, across);
  }
};

import type { ShipPose } from "./settlement-ship-kinematics";

const MAX_HEADINGS = 256;
const MAX_MOVES = 16;
const NEGATIVE_ZERO = Symbol("negative zero");
interface MotionTemplate { count: number; origin: ShipPose; samples: (ShipPose | undefined)[] }

/** Exact, lazy translation offsets for fixed move recipes; callers choose the provider's cache lifetime. */
export const createShipMotionTemplates = () => {
  const headings = new Map<number | typeof NEGATIVE_ZERO, Map<number, MotionTemplate>>();
  return (pose: ShipPose, moveId: number, count: number,
    calculate: (origin: ShipPose, index: number) => ShipPose) => {
    const key = Object.is(pose.yaw, -0) ? NEGATIVE_ZERO : pose.yaw;
    let moves = headings.get(key);
    if (!moves) {
      if (headings.size >= MAX_HEADINGS) headings.delete(headings.keys().next().value!);
      moves = new Map(); headings.set(key, moves);
    }
    let template = moves.get(moveId);
    if (!template || template.count !== count) {
      if (moves.size >= MAX_MOVES) moves.delete(moves.keys().next().value!);
      // -0 + delta retains both signs of zero and every finite nonzero displacement exactly.
      // The canonical kinematics already group their displacement before adding world position.
      template = { count, origin: { x: -0, yaw: pose.yaw, z: -0 }, samples: Array(count) };
      moves.set(moveId, template);
    }
    const shape = template;
    let end: ShipPose | undefined;
    const at = (index: number) => {
      if (index + 1 === count && end) return end;
      let offset = shape.samples[index];
      if (!offset) { offset = calculate(shape.origin, index); shape.samples[index] = offset; }
      return { x: pose.x + offset.x, yaw: offset.yaw, z: pose.z + offset.z };
    };
    end = at(count - 1);
    return { end, sampleAt: at };
  };
};

export type ShipMotionTemplates = ReturnType<typeof createShipMotionTemplates>;

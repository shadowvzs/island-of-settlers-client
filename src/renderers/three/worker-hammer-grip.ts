import { Matrix4, type Object3D,Quaternion, Vector3 } from "three";

/**
 * Forward lean of a travelling hammer's haft from vertical (radians), a relaxed thumb-up carry:
 * the head leads the fist at chest height and swings with the arm. Upright, the head stood at
 * chin height and, with the pumping arm of a run, right in front of the face.
 */
const HAMMER_TRAVEL_LEAN = 1;
/** Long-handled tools whose travel carry keeps a fixed haft direction instead of the wrist's. */
export const CARRIED_UPRIGHT_TOOLS = ["axe", "hammer", "pickaxe", "shovel"];
/**
 * A travelling shovel is carried like the woodcutter's axe: an upright haft with its spade up
 * beside the shoulder. Following the swinging wrist, spade down, it was planted ahead of the
 * feet on every step like a crutch and read as a limp.
 */
const HEAD_DOWN_AUTHORED_TOOLS = ["shovel"];
/**
 * Palm position along each tool's authored haft (+Y): hammer, axe and pickaxe start at the
 * handle end; the shovel's origin is mid shaft, gripped just towards its spade.
 */
const TRAVEL_GRIP_HEIGHTS: Record<string, number> = { shovel: -.06 };
const DEFAULT_TRAVEL_GRIP_HEIGHT = .055;
const rootTurn = new Quaternion();

/** World direction of a carried tool's haft: a hammer leans forward, other tools stand upright. */
export const carriedToolAxis = (root: Object3D, tool: string | undefined, target: Vector3) => {
  const lean = tool === "hammer" ? HAMMER_TRAVEL_LEAN : 0;
  return target.set(0, Math.cos(lean), Math.sin(lean)).applyQuaternion(root.getWorldQuaternion(rootTurn));
};

/** Grip across the fingers, with the tool head above the palm during travel. */
export const createWalkingHammerGrip = () => {
  const fingers = new Vector3(), palm = new Vector3(), wristPoint = new Vector3();
  const up = new Vector3(), right = new Vector3(), forward = new Vector3();
  const matrix = new Matrix4(), rotation = new Quaternion(), rootRotation = new Quaternion();
  const offset = new Vector3();
  return (prop: Object3D, root: Object3D, hand: Object3D, tool: string, wrist?: Object3D,
    worldCurrent = false) => {
    if (!worldCurrent) root.updateWorldMatrix(true, true);
    hand.getWorldPosition(palm);
    if (wrist) fingers.copy(palm).sub(wrist.getWorldPosition(wristPoint)).normalize();
    else fingers.set(0, 0, 1).applyQuaternion(hand.getWorldQuaternion(rotation));
    if (fingers.lengthSq() < .5) fingers.set(0, 0, 1);
    carriedToolAxis(root, tool, up).addScaledVector(fingers, -up.dot(fingers));
    if (up.lengthSq() < .001) {
      up.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(rootRotation));
      up.addScaledVector(fingers, -up.dot(fingers));
    }
    up.normalize();
    if (up.y < 0) up.negate();
    // Tools authored head down (+Y towards the handle end) are turned over: head up in travel.
    if (HEAD_DOWN_AUTHORED_TOOLS.includes(tool)) up.negate();
    forward.copy(fingers);
    right.crossVectors(up, forward).normalize();
    forward.crossVectors(right, up).normalize();
    rotation.setFromRotationMatrix(matrix.makeBasis(right, up, forward));
    root.getWorldQuaternion(rootRotation).invert();
    prop.quaternion.copy(rootRotation.multiply(rotation));
    offset.set(0, TRAVEL_GRIP_HEIGHTS[tool] ?? DEFAULT_TRAVEL_GRIP_HEIGHT, 0)
      .applyQuaternion(prop.quaternion);
    prop.position.copy(root.worldToLocal(palm)).sub(offset);
  };
};

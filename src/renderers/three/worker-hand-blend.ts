import { Matrix4, type Object3D } from "three";

/** Clip-placed hand tools follow these actions' baked trajectories, not the live hand bone. */
const HAND_TOOL_ACTIONS = ["build_hammer", "chop_tree", "dig", "harvest_wheat", "fish_cast", "fish_wait", "fish_reel",
  "spyglass_scan"];

const handInRoot = (root: Object3D, hand: Object3D, target: Matrix4) => {
  hand.updateWorldMatrix(true, false);
  return target.copy(root.matrixWorld).invert().multiply(hand.matrixWorld);
};

/**
 * A pose blend moves the right hand away from the clip pose that the baked tool trajectory
 * expects. Records that move (in the worker root's space) so the tool can follow the hand.
 */
export const createHandBlendTracker = (root: Object3D) => {
  const hand = root.getObjectByName("hand_R");
  const clipHand = new Matrix4(), offset = new Matrix4();
  let active = false;
  return {
    /** Call with the unblended clip pose applied. */
    before: () => {
      if (hand) handInRoot(root, hand, clipHand);
    },
    /** Call after the blend; `blending` false clears the offset once the blend has finished. */
    after: (blending: boolean) => {
      active = blending && Boolean(hand);
      if (!active) return;
      handInRoot(root, hand!, offset).multiply(clipHand.invert());
    },
    /** Moves a root-space tool by the hand's blend offset. */
    follow: (tool: Object3D, action: string) => {
      if (!active || !HAND_TOOL_ACTIONS.includes(action)) return;
      tool.updateMatrix();
      tool.applyMatrix4(offset);
    }
  };
};

export type HandBlendTracker = ReturnType<typeof createHandBlendTracker>;

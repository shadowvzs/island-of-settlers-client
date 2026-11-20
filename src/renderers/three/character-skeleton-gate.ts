import { Skeleton } from "three";

/**
 * C02 (f): a skinned actor whose pose and root transform did not change since the last render keeps
 * its bone matrices. Three's `Skeleton.update` would flatten the same matrices again and re-upload
 * the whole bone texture, so a gated skeleton returns early instead. The owner rule is presentation
 * only: the actor is gated on a frame without a pose while it stands still, exactly the frames the
 * animation budget already skips.
 *
 * Its first render must still build and fill the bone texture, so only skeletons that already own
 * one are gated. The gate is a `WeakSet`: it never keeps a disposed skeleton alive.
 */
const gatedSkeletons = new WeakSet<Skeleton>();
let updatePatched = false;

const patchSkeletonUpdate = () => {
  if (updatePatched) return;
  updatePatched = true;
  const update = Skeleton.prototype.update;
  Skeleton.prototype.update = function (this: Skeleton) {
    if (gatedSkeletons.has(this)) return;
    update.call(this);
  };
};

/**
 * Freezes or thaws the bone-matrix update of one actor's skeletons. Freezing is skipped for a
 * skeleton that has not uploaded a bone texture yet: its first render must compute the bind pose.
 */
export const setSkeletonsGated = (skeletons: Iterable<Skeleton>, gated: boolean) => {
  if (!gated) {
    for (const skeleton of skeletons) gatedSkeletons.delete(skeleton);
    return;
  }
  patchSkeletonUpdate();
  for (const skeleton of skeletons) if (skeleton.boneTexture !== null) gatedSkeletons.add(skeleton);
};

/** Whether a skeleton's update is currently gated (receipts and tests). */
export const isSkeletonGated = (skeleton: Skeleton) => gatedSkeletons.has(skeleton);

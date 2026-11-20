/** A mounted soldier may leave the frame briefly (a door, garrison or travel); ~3 s at 60 fps. */
export const MOUNT_RETIREMENT_FRAMES = 180;

/**
 * Counts how many update frames a mounted instance has been missing. The count resets as soon as
 * the actor is drawn again; once the grace period ends the owner must dispose the instance.
 */
export const createMountRetirementGrace = (frames = MOUNT_RETIREMENT_FRAMES) => {
  const ages = new Map<number, number>();
  return {
    /** The mount is active in this frame: do not retire it. */
    seen: (id: number) => { ages.delete(id); },
    /** Count one missing frame; true when the instance has outlived the grace period. */
    missing: (id: number) => {
      const age = (ages.get(id) ?? 0) + 1;
      if (age <= frames) { ages.set(id, age); return false; }
      ages.delete(id);
      return true;
    },
    forget: (id: number) => { ages.delete(id); },
    clear: () => ages.clear()
  };
};

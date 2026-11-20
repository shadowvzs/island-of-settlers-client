/**
 * Fixed map scenery (owner 2026-11-10): authored map decorations owned by nobody. Their decoration frames
 * carry negative uids so selection, hover, pick-up and owned-item counts can tell them apart cheaply.
 */
export const isMapSceneryUid = (uid: number) => uid < 0;

/** The scenery frame uid of an authored row's stable 1-based id. */
export const toMapSceneryUid = (id: number) => -id;

/** The player's own decoration frames (scenery excluded): owned-item counts and selection lists. */
export const ownedDecorationFrames = <Frame extends { uid: number }>(frames: readonly Frame[]) =>
  frames.filter(frame => !isMapSceneryUid(frame.uid));

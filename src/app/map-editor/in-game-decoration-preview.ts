import type { FrameState } from "../../render-common/renderer-contract";
import { ownedDecorationFrames, toMapSceneryUid } from "../../shared/settlement/map-scenery";

type DecorationFrames = NonNullable<FrameState["roadDecorations"]>;

interface DecorationSource {
  decorationFrames: () => DecorationFrames;
  decorationGhost: () => FrameState["roadDecorationGhost"];
}

/**
 * The in-game map editor over a live settlement: the map's authored decorations (as currently edited)
 * replace the settlement's spawned scenery in the drawn frame, as non-selectable scenery uids, and the
 * palette ghost shows while placing. Player decorations stay as they are. Lists are reused while unchanged.
 */
export const createInGameDecorationPreview = (editor: DecorationSource) => {
  let authored: DecorationFrames | undefined, player: DecorationFrames | undefined;
  let combined: DecorationFrames = [];
  const combine = (frames: DecorationFrames) => {
    const next = editor.decorationFrames();
    if (next === authored && frames === player) return combined;
    authored = next;
    player = frames;
    const scenery = next.map(frame => ({ ...frame, uid: toMapSceneryUid(frame.uid) }));
    combined = [...ownedDecorationFrames(frames), ...scenery];
    return combined;
  };
  type DecoratedFrame = Partial<Pick<FrameState, "roadDecorationGhost" | "roadDecorations">>;
  return <Frame extends DecoratedFrame>(frame: Frame): Frame => ({
    ...frame,
    roadDecorationGhost: editor.decorationGhost() ?? frame.roadDecorationGhost,
    roadDecorations: combine(frame.roadDecorations ?? [])
  });
};

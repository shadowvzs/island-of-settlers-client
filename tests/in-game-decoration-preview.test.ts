import { expect, it } from "vitest";

import { createInGameDecorationPreview } from "../src/app/map-editor/in-game-decoration-preview";
import type { RoadDecorationFrame } from "../src/shared/settlement/road-decoration-state";

const frame = (uid: number) => ({ item: "roadDecoration:indigenous-flower-pot:native", position: [uid, 0, 0],
  supports: [], uid, volumes: [], yaw: 0 }) as unknown as RoadDecorationFrame;

it("shows the edited map decorations instead of the spawned scenery, never as selectable uids", () => {
  const authored = [frame(1), frame(2)];
  const preview = createInGameDecorationPreview({ decorationFrames: () => authored, decorationGhost: () => null });
  const player = [frame(7), frame(-1)];
  const drawn = preview({ roadDecorations: player });
  expect(drawn.roadDecorations!.map(row => row.uid)).toEqual([7, -1, -2]);
  expect(preview({ roadDecorations: player }).roadDecorations).toBe(drawn.roadDecorations);
});

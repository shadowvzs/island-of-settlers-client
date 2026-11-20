import type { RenderedCursor } from "./cursors/render-cursor-set";

/**
 * In-page entry of the game cursor renderer (tools/bench/cursors), shared by the exporter
 * `tools/assets/game-cursors.ts`, the contact sheet `tools/bench/cursor-contact-sheet.ts` and the icon comparison
 * `tests-ui/visual/ui-icons.spec.ts`. Runs through `page.evaluate`, so it only imports the served module.
 */
export const renderGameCursors = async (only?: readonly string[]): Promise<Record<string, RenderedCursor>> => {
  const module: typeof import("./cursors/render-cursor-set") =
    await import(/* @vite-ignore */ String("/tools/bench/cursors/render-cursor-set.ts"));
  return module.renderCursorSet(only);
};

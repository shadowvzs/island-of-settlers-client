/**
 * In-page renderer of the registration race buttons (`assets/ui-icons/races/<nation>.png`), shared
 * by the exporter `tools/bench/race-helmet-icons.ts` and the icon comparison `tests-ui/visual/ui-
 * icons.spec.ts` (TEST-01). Runs inside the page through `page.evaluate`, so it must stay self-
 * contained (dynamic imports only).
 */
import type { RaceHelmetIconOptions } from "./race-helmet-types";

export const renderRaceHelmetIcons = async (options?: RaceHelmetIconOptions | void) => {
  const scene = "/tools/bench/race-helmet-scene.ts";
  const module = await import(/* @vite-ignore */ scene) as typeof import("./race-helmet-scene");
  return module.renderRaceHelmets(options || {});
};

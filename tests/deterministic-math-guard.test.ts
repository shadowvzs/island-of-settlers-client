import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CLIENT_ROOT, serverBundleGraph } from "./helpers/server-bundle-graph";

/**
 * D4.6 guard: every module the server's game bundle runs (the simulation, replay, catch-up) calls `DMath` instead of
 * the engine's `Math.hypot`, `sin`, `cos`, `atan2`, `exp`, ... which differ between browsers. World generation and
 * render-only meshes inside the graph keep `Math` (they never run in a replay).
 */
const NATIVE_ONLY = ["src/shared/world/generation/", "src/render-common/trees/", "src/render-common/rocks/",
  "src/render-common/props/", "src/render-common/wildlife/model/", "src/shared/math/",
  "src/render-common/baker/", "src/render-common/buildings/flax-weaver-shared.ts",
  "src/render-common/buildings/nation-commander-lodge-designs.ts",
  // National building/wear mesh recipes are presentation geometry; they never run in replay.
  "src/render-common/buildings/", "src/render-common/plants/", "src/render-common/wares/",
  "src/render-common/color.ts", "src/render-common/road-decoration-", "src/render-common/road-plant-",
  "src/render-common/wisteria-", "src/render-common/wheat-field.ts",
  "src/shared/settlement/road-decoration-"];
const NON_DETERMINISTIC = /\bMath\.(hypot|sin|cos|tan|atan2|atan|asin|acos|exp|log|pow)\(/;
/** The exponent operator is checked separately so doc-comment `**` markers are not offenders. */
const EXPONENT_OPERATOR = /[A-Za-z0-9_)\]][ \t]*\*\*[ \t]*[A-Za-z0-9_(]/;

describe("deterministic math on the simulation path", () => {
  it("leaves no engine-dependent Math call in the server bundle's modules", async () => {
    const offenders = Object.keys((await serverBundleGraph()).inputs)
      .filter(file => file.startsWith("src/") && !NATIVE_ONLY.some(prefix => file.startsWith(prefix)))
      .filter(file => {
        const source = readFileSync(resolve(CLIENT_ROOT, file), "utf8");
        return NON_DETERMINISTIC.test(source) || EXPONENT_OPERATOR.test(source);
      });
    expect(offenders).toEqual([]);
  }, 60_000);
});

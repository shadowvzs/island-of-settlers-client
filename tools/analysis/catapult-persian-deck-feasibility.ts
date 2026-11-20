import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

const output = resolve(process.argv[2] ??
  "../resources/project-reviews/building-art-completion-2026-11-03/persian-deck-feasibility-resume-a.json");
const server = await createServer({ appType: "custom", server: { hmr: false, middlewareMode: true } });
try {
  const [recipes, geometryModule, dimensions, hatch, cycle, mechanism, sizing, catalog, workers] = await Promise.all([
    server.ssrLoadModule("/src/render-common/buildings/catapult-tower-recipe.ts"),
    server.ssrLoadModule("/src/renderers/three/buildings/roman-building.ts"),
    server.ssrLoadModule("/src/render-common/buildings/catapult-dimensions.ts"),
    server.ssrLoadModule("/src/render-common/buildings/catapult-hatch.ts"),
    server.ssrLoadModule("/src/shared/settlement/catapult-cycle.ts"),
    server.ssrLoadModule("/src/render-common/buildings/catapult-mechanism.ts"),
    server.ssrLoadModule("/src/render-common/buildings/building-world-sizing.ts"),
    server.ssrLoadModule("/src/render-common/buildings/building-catalog.ts"),
    server.ssrLoadModule("/src/render-common/workers/worker-dimensions.ts")
  ]);
  const worldScale = sizing.getRomanBuildingWorldSizing(catalog.getBuildingDefinition(16)).scale;
  const witnesses: { part: string; point: number[]; radius: number }[] = [];
  const add = (part: string, point: number[]) => witnesses.push({ part, point, radius: Math.hypot(point[0]!, point[2]!) });
  for (const detailed of [true, false]) {
    const recipe = recipes.createCatapultTowerRecipe("persian", detailed);
    for (const [index, part] of recipe.parts.entries()) {
      if (!part.stock && part.catapultPart !== "hatch" && part.catapultPart !== "frame") continue;
      const geometry = geometryModule.createRomanPartGeometry(part, detailed), p = geometry.getAttribute("position");
      geometry.computeBoundingBox();
      const bottom = geometry.boundingBox.min.y;
      let maximum = -Infinity, witness: number[] = [];
      for (let vertex = 0; vertex < p.count; vertex++) {
        const point = [p.getX(vertex), p.getY(vertex), p.getZ(vertex)];
        if (part.stock && point[1]! > bottom + 1e-5) continue;
        if (part.catapultPart === "frame" && point[1]! > dimensions.CATAPULT_DECK_HEIGHT + .10) continue;
        const radius = Math.hypot(point[0]!, point[2]!);
        if (radius > maximum) { maximum = radius; witness = point; }
      }
      if (witness.length) add(`${detailed ? "high" : "minimal"}/${index}/${part.stock ? `stone-bearing-${part.stock.slot}` : part.catapultPart}`, witness);
      geometry.dispose();
    }
  }
  const well = hatch.CATAPULT_HATCH_WELL;
  add("hatch-clear-well-outer-NW", [well.center[0] - well.top / 2, well.center[1], well.center[2] - well.top / 2]);
  let furthestCrew = { radius: 0, phase: "", aim: 0, progress: 0, point: [] as number[] };
  const phases = ["pick", "load", "clear", "traverse", "fire", "return", "ready"];
  for (const phase of phases) for (let sample = 0; sample <= 48; sample++) for (let yaw = 0; yaw < 96; yaw++) {
    const progress = sample / 48, aim = yaw / 96 * Math.PI * 2;
    const pose = cycle.catapultCrewLocalPose({ operator: 1, target: 2, phase,
      elapsed: cycle.CATAPULT_PHASE_SECONDS[phase] * progress }, aim, worldScale, 2);
    const radius = Math.hypot(pose.operator[0], pose.operator[2]);
    if (radius > furthestCrew.radius) furthestCrew = { radius, phase, aim, progress, point: pose.operator };
  }
  const sources = ["src/render-common/buildings/catapult-platform.ts", "src/render-common/buildings/catapult-hatch.ts",
    "src/render-common/buildings/catapult-mechanism.ts", "src/shared/settlement/catapult-cycle.ts",
    "src/renderers/three/buildings/catapult-deck-geometry.ts"];
  const report = {
    status: "FEASIBILITY ONLY; no deck or anchor changes", modelSpace: true, worldScale,
    proposedWallRadius: .82, originalDeckHalfWidth: .825,
    witnesses: witnesses.sort((a, b) => b.radius - a.radius),
    furthestCrew,
    conservativeCrewBodyEnvelope: furthestCrew.radius + workers.WORKER_RADIUS / worldScale,
    crewEnvelopeLimit: "Uses canonical body-radius allowance, NOT measured skinned soles; not an actual full-rig footprint proof.",
    engineOrigin: mechanism.CATAPULT_ENGINE_ORIGIN,
    conclusion: "A radius .82 circle clips real stock bearing and the clear hatch. A full circle large enough for unchanged stock exceeds the current square envelope. Preserve the square deck pending an explicit supported outline design; a local NW pocket alone does not establish full walking/sole safety.",
    sourceHashes: Object.fromEntries(sources.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]))
  };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, largestWitness: report.witnesses[0], furthestCrew,
    conservativeCrewBodyEnvelope: report.conservativeCrewBodyEnvelope }));
} finally { await server.close(); }

import { measureShipScenario, stressLayoutScenario } from "../../tests/helpers/ship-motion-scenarios";

/**
 * Ship traffic stress: 16 layouts (harbour pairs and scattered starts from a fixed seed), six ships
 * each, every ship carrying one load between the two harbours. Prints per layout whether every load
 * arrived, the time, hull and shore contacts, blocked ship-seconds and the worst fleet tick.
 * Usage: npx tsx tools/bench/ship-stress.ts [layouts] [ships]
 */
const layouts = Number(process.argv[2] ?? 16);
const ships = Number(process.argv[3] ?? 6);

let failures = 0;
for (let index = 0; index < layouts; index++) {
  const metrics = measureShipScenario(stressLayoutScenario(index, ships));
  failures += Number(!metrics.completed || metrics.hullContactTicks > 0 || metrics.shoreTicks > 0);
  console.log(`layout ${String(index).padStart(2)}: ${metrics.completed ? "done" : "NOT DONE"} ${
    metrics.seconds.toFixed(0).padStart(5)} s  hull ${metrics.hullContactTicks}  shore ${metrics.shoreTicks}  blocked ${
    metrics.blockedSeconds.toFixed(0)} s  cpu mean ${metrics.cpuMeanMs.toFixed(3)} max ${metrics.cpuMaxMs.toFixed(1)} ms`);
}
console.log(failures ? `${failures} layout(s) failed` : "every layout completed cleanly");
process.exitCode = failures ? 1 : 0;

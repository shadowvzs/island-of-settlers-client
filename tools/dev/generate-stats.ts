import {
  DEFAULT_WORLD_OPTIONS,
  generateWorld} from "../../src/shared/world/generation/generate-world";

const seed = Number(process.argv[2] ?? DEFAULT_WORLD_OPTIONS.seed);
const size = Number(process.argv[3] ?? DEFAULT_WORLD_OPTIONS.cellsX);
const started = performance.now();
const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, seed });
const elapsed = performance.now() - started;
const land = world.waterDepth.filter((depth) => depth === 0).length / world.waterDepth.length;
const heights = Array.from(world.heights);
const counts = new Array(9).fill(0);
world.props.types.forEach((type) => (counts[type]! += 1));
console.log({
  elapsedMs: Math.round(elapsed),
  land: land.toFixed(2),
  maxHeight: Math.max(...heights).toFixed(1),
  minHeight: Math.min(...heights).toFixed(1),
  props: world.props.count,
  propsByType: counts.join(","),
  start: world.start,
  waterfalls: world.waterfalls.length,
  sectors: new Set(world.sector).size,
  buildClasses: [0, 1, 2, 3, 4, 5]
    .map((c) => world.buildClass.filter((v) => v === c).length)
    .join(",")
});

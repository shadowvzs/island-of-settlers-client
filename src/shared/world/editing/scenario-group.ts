import type { ScenarioPoint } from "../map-scenario";
export type ScenarioFormation = "block" | "line" | "column" | "wedge";
/** Front-centred formations, rotated toward the landing or the author's chosen facing. */
export const scenarioGroupPoints = (point: ScenarioPoint, count: number, spacing: number,
  formation: ScenarioFormation, heading: number): ScenarioPoint[] => {
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => {
    let x = (index % columns - (columns - 1) / 2) * spacing;
    let z = -Math.floor(index / columns) * spacing;
    if (formation === "line") { x = (index - (count - 1) / 2) * spacing; z = 0; }
    if (formation === "column") { x = 0; z = -index * spacing; }
    if (formation === "wedge") {
      const row = Math.floor((Math.sqrt(8 * index + 1) - 1) / 2);
      x = (index - row * (row + 1) / 2 - row / 2) * spacing;
      z = -row * spacing;
    }
    return { x: point.x + x * Math.cos(heading) + z * Math.sin(heading),
      z: point.z - x * Math.sin(heading) + z * Math.cos(heading) };
  });
};

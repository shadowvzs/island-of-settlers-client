import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Mesh, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

/** Clip to the physical depth swept by the actual rotating rotor, retaining triangle edges. */
const clipAtDepth = (polygon: Vector3[], depth: number, sign: number) => {
  const clipped: Vector3[] = [];
  polygon.forEach((point, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    const inside = sign * (point.z - depth) <= 0;
    const previousInside = sign * (previous.z - depth) <= 0;
    if (inside !== previousInside) {
      const ratio = (depth - previous.z) / (point.z - previous.z);
      clipped.push(previous.clone().lerp(point, ratio));
    }
    if (inside) clipped.push(point);
  });
  return clipped;
};

const minimumRadius = (polygon: Vector3[]) => {
  let minimum = Infinity, positive = false, negative = false;
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    const dx = next.x - point.x, dy = next.y - point.y;
    const side = point.x * next.y - next.x * point.y;
    positive ||= side > 1e-9; negative ||= side < -1e-9;
    const length = dx * dx + dy * dy;
    const along = length ? Math.max(0, Math.min(1, -(point.x * dx + point.y * dy) / length)) : 0;
    minimum = Math.min(minimum, Math.hypot(point.x + along * dx, point.y + along * dy));
  });
  if (polygon.length >= 3 && !(positive && negative)) return 0;
  return minimum;
};

it("keeps the full continuous mill rotor sweep clear of actual whole-building triangles in both LODs", () => {
  stubPaintCanvas();
  const reports: { nation: string; detailed: boolean; collisions: { outsideBearing: boolean }[]; [key: string]: unknown }[] = [];
  for (const nation of ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"] as const)
    for (const detailed of [true, false]) for (const level of [1, 2, 3, 4, 5] as const) {
      const definition = getBuildingDefinition(31), materials = createPlainBuildingMaterials();
      const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
      const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
      try {
        model.update(0, { construction: 1, door: 0, working: true, workTime: 0 });
        model.root.updateMatrixWorld(true);
        const rotor = model.root.getObjectByName("mechanism")!;
        const inverse = rotor.matrixWorld.clone().invert(), points: Vector3[] = [], rotorTriangles: Vector3[][] = [];
        rotor.traverse(object => {
          if (!(object instanceof Mesh)) return;
          const positions = object.geometry.getAttribute("position");
          const indices = object.geometry.index, count = indices?.count ?? positions.count;
          for (let vertex = 0; vertex < count; vertex += 3) {
            const triangle = [0, 1, 2].map(offset => new Vector3()
              .fromBufferAttribute(positions, indices?.getX(vertex + offset) ?? vertex + offset)
              .applyMatrix4(object.matrixWorld).applyMatrix4(inverse));
            points.push(...triangle); rotorTriangles.push(triangle);
          }
        });
        const radius = Math.max(...points.map(point => Math.hypot(point.x, point.y)));
        const low = Math.min(...points.map(point => point.z)), high = Math.max(...points.map(point => point.z));
        const depths = [...new Set(points.map(point => point.z))].sort((a, b) => a - b);
        const bands = depths.slice(1).map((top, index) => {
          const bottom = depths[index]!;
          let maximum = 0;
          for (const triangle of rotorTriangles) {
            const clipped = clipAtDepth(clipAtDepth(triangle, top - .00001, 1), bottom + .00001, -1);
            for (const point of clipped) maximum = Math.max(maximum, Math.hypot(point.x, point.y));
          }
          return { bottom, top, maximum };
        });
        let nearest = Infinity, testedTriangles = 0;
        const collisions: { mesh: string; radius: number; bottom: number; top: number; maximum: number; center: number[]; outsideBearing: boolean }[] = [];
        model.root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          for (let parent = object.parent; parent; parent = parent.parent)
            if (parent === rotor || !parent.visible) return;
          if (!object.visible) return;
          const positions = object.geometry.getAttribute("position"), indices = object.geometry.index;
          const count = indices?.count ?? positions.count;
          for (let vertex = 0; vertex < count; vertex += 3) {
            const polygon = [0, 1, 2].map(offset => new Vector3()
              .fromBufferAttribute(positions, indices?.getX(vertex + offset) ?? vertex + offset)
              .applyMatrix4(object.matrixWorld).applyMatrix4(inverse));
            for (const { bottom, maximum, top } of bands) {
              const clipped = clipAtDepth(clipAtDepth(polygon, top - .00001, 1), bottom + .00001, -1);
              if (!clipped.length) continue;
              testedTriangles++;
              const distance = minimumRadius(clipped);
              nearest = Math.min(nearest, distance);
              if (distance < maximum - .001) collisions.push({ mesh: object.name, radius: distance,
                bottom, top, maximum, center: clipped[0]!.toArray(),
                outsideBearing: maximum > .12 && clipped.some(point => Math.hypot(point.x, point.y) > .12) });
            }
          }
        });
        const before = rotor.rotation.z;
        model.update(1, { construction: 1, door: 0, working: true, workTime: 1 });
        expect(rotor.rotation.z).not.toBe(before);
        const examples = collisions.filter(collision => collision.outsideBearing).slice(0, 5).map(collision => {
          const point = collision.center.map((value, axis) => value + recipe.mechanism[axis]!);
          return { point, candidates: recipe.parts.filter(part => {
            const bounds = getRomanPartBounds(part);
            return point.every((value, axis) => value >= bounds.min[axis]! - .001 && value <= bounds.max[axis]! + .001);
          }) };
        });
        reports.push({ nation, detailed, level, radius, low, high, nearest, testedTriangles,
          bearingContacts: collisions.filter(collision => !collision.outsideBearing).length,
          collisions: collisions.filter(collision => collision.outsideBearing), examples });
      } finally {
        model.dispose();
        Object.values(materials).forEach(material => material.dispose());
      }
    }
  const output = resolve("../resources/project-reviews/verification-completion-2026-11-05/mills");
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "whole-building-sweep.json"), JSON.stringify(reports, null, 2));
  for (const report of reports)
    expect(report.collisions.filter(collision => collision.outsideBearing).length, `${report.nation}/${report.detailed}`).toBe(0);
});

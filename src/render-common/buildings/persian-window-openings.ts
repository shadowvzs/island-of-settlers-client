import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { createPersianWindowShadow } from "./building-window-shadows";
import { windowGarrisonAnchors } from "./military-window-slots";
import type { PersianWallWindow } from "./persian-window-profile";

interface OpeningSite { body: BuildingPart; pane: BuildingPart; window: PersianWallWindow }
const rounded = (part: BuildingPart) => ["persian-room", "cylinder"].includes(part.shape) && !part.stock &&
  ["paint", "plaster", "stone", "cut-stone"].includes(part.surface) &&
  Math.abs(part.rotation?.[0] ?? 0) < .001 && Math.abs(part.rotation?.[2] ?? 0) < .001;

const normalizedPane = (pane: BuildingPart, body: BuildingPart) => {
  const yaw = body.rotation?.[1] ?? 0, dx = pane.position[0] - body.position[0], dz = pane.position[2] - body.position[2];
  const y = (pane.position[1] - body.position[1]) / body.size[1];
  const sx = 1 + ((body.topScale?.[0] ?? 1) - 1) * (y + .5);
  const sz = 1 + ((body.topScale?.[2] ?? 1) - 1) * (y + .5);
  const x = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / (body.size[0] * sx / 2);
  const z = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / (body.size[2] * sz / 2);
  return { angle: Math.atan2(x, z), error: Math.abs(Math.hypot(x, z) - 1), sx, sz, y };
};

const openingSites = (parts: readonly BuildingPart[]): OpeningSite[] => {
  const bodies = parts.filter(part => rounded(part) && part.size[1] > .4);
  const panes = parts.filter(part => part.surface === "dark" && !part.stock && part.size[1] > .15 &&
    Math.min(...part.size) < .06);
  const sites: OpeningSite[] = [];
  for (const pane of panes) {
    const candidates = bodies.map(body => ({ body, point: normalizedPane(pane, body) }))
      .filter(({ point }) => Math.abs(point.y) < .45 && point.error < .24)
      .sort((a, b) => a.point.error - b.point.error);
    const site = candidates[0];
    if (!site) continue;
    const { body, point } = site, height = pane.size[1] / body.size[1];
    const radius = Math.hypot(Math.cos(point.angle) * body.size[0] * point.sx / 2,
      Math.sin(point.angle) * body.size[2] * point.sz / 2);
    const width = Math.max(pane.size[0], pane.size[2]);
    sites.push({ body, pane, window: { angle: point.angle, bottom: point.y - height / 2,
      halfAngle: Math.asin(Math.min(.6, width / (radius * 2))), rise: height / 4,
      spring: point.y + height / 4 } });
  }
  return sites;
};

const hollowSurround = (frame: BuildingPart, pane: BuildingPart): BuildingPart[] => {
  const axis = pane.size[0] > pane.size[2] ? 0 : 2;
  const width = Math.max(pane.size[0], pane.size[2]);
  const jamb = (frame.size[axis] - width) / 2, header = (frame.size[1] - pane.size[1]) / 2;
  const output: BuildingPart[] = [];
  for (const side of [-1, 1]) {
    const position: Point3 = [...frame.position], size: Point3 = [...frame.size];
    position[axis] += side * (width + jamb) / 2; size[axis] = jamb;
    output.push({ ...frame, position, size });
    const horizontalPosition: Point3 = [...frame.position], horizontalSize: Point3 = [...frame.size];
    horizontalPosition[1] += side * (pane.size[1] + header) / 2;
    horizontalSize[1] = header; horizontalSize[axis] = width;
    output.push({ ...frame, position: horizontalPosition, size: horizontalSize });
  }
  return output;
};

const coveringFrame = (part: BuildingPart, site: OpeningSite) => {
  if (part.shape !== "box" || part.stock || part.surface === "dark" || part.rotation?.some(angle => angle !== 0)) return false;
  const { pane } = site, axis = pane.size[0] > pane.size[2] ? 0 : 2;
  const across = axis === 0 ? 2 : 0;
  return Math.abs(part.position[1] - pane.position[1]) < .005 &&
    Math.abs(part.position[axis] - pane.position[axis]) < .005 &&
    Math.abs(part.position[across] - pane.position[across]) < .09 &&
    part.size[axis] > pane.size[axis] + .025 && part.size[axis] < pane.size[axis] + .14 &&
    part.size[1] > pane.size[1] + .025 && part.size[1] < pane.size[1] + .14;
};

/** Replace painted-on panes with thick revealed voids, preserving canonical window-soldier contracts. */
export const withPersianWindowOpenings = (recipe: BuildingRecipe): BuildingRecipe => {
  const sites = openingSites(recipe.parts);
  if (!sites.length) return recipe;
  const removed = new Set(sites.map(site => site.pane));
  const parts = recipe.parts.flatMap(part => {
    if (removed.has(part)) return [];
    const frame = sites.find(site => coveringFrame(part, site));
    if (frame) return hollowSurround(part, frame.pane);
    if (!rounded(part)) return [part];
    const windows: PersianWallWindow[] = [];
    for (const site of sites) {
      const body = site.body;
      if (Math.hypot(part.position[0] - body.position[0], part.position[2] - body.position[2]) > .015) continue;
      if (Math.abs((part.rotation?.[1] ?? 0) - (body.rotation?.[1] ?? 0)) > .001) continue;
      if (Math.abs(part.size[0] / body.size[0] - 1) > .10 || Math.abs(part.size[2] / body.size[2] - 1) > .10) continue;
      const worldBottom = body.position[1] + site.window.bottom * body.size[1];
      const worldTop = body.position[1] + (site.window.spring + site.window.rise) * body.size[1];
      if (worldBottom >= part.position[1] + part.size[1] / 2 || worldTop <= part.position[1] - part.size[1] / 2) continue;
      windows.push({ ...site.window, bottom: (worldBottom - part.position[1]) / part.size[1],
        rise: site.window.rise * body.size[1] / part.size[1],
        spring: (body.position[1] + site.window.spring * body.size[1] - part.position[1]) / part.size[1] });
    }
    if (!windows.length) return [part];
    return [{ ...part, persianOpening: part.persianOpening ?? [0, 0, -.49], persianWindows: windows,
      shape: "persian-room" as const }];
  });
  parts.push(...sites.map(site => createPersianWindowShadow(site.body, site.window, site.pane)));
  return { ...recipe, garrisonWindows: windowGarrisonAnchors(recipe.parts), parts };
};

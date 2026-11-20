import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { type PersianWallWindow,persianWindowCrown } from "./persian-window-profile";
import { eulerTurn, turnPoint } from "./recipe-rotation";

export const WINDOW_SHADOW_RECESS = .03;

/** Explicit authored openings, or old untagged window boxes with real wall context. */
export const isLegacyWindowPane = (pane: BuildingPart, parts: readonly BuildingPart[]) => {
  if (pane.windowOpening || pane.windowShadow || pane.shape === "window-shadow") return true;
  if (pane.surface !== "dark" || pane.stock || pane.catapultPart || pane.stage < 2 || pane.shape !== "box" ||
    pane.size[1] <= .15 || pane.size[1] > .70 || Math.min(...pane.size) >= .06) return false;
  const across = pane.size[0] < pane.size[2] ? 0 : 2, along = across === 0 ? 2 : 0;
  return parts.some(wall => {
    if (wall.stock || wall.stage !== 1 || wall.size[1] < .3 || wall.surface === "dark") return false;
    if (["persian-room", "cylinder"].includes(wall.shape)) {
      const y = pane.position[1] - wall.position[1];
      if (Math.abs(y) > wall.size[1] / 2 + .02) return false;
      const yaw = wall.rotation?.[1] ?? 0, dx = pane.position[0] - wall.position[0], dz = pane.position[2] - wall.position[2];
      const x = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / (wall.size[0] / 2);
      const z = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / (wall.size[2] / 2);
      return Math.abs(Math.hypot(x, z) - 1) < .25;
    }
    if (!["box", "bevel-box"].includes(wall.shape) || Math.min(wall.size[0], wall.size[2]) > .3) return false;
    const bounds = getRomanPartBounds(wall), at = pane.position;
    return at[along] >= bounds.min[along] - .025 && at[along] <= bounds.max[along] + .025 &&
      at[1] >= bounds.min[1] && at[1] <= bounds.max[1] &&
      at[across] >= bounds.min[across] - .12 && at[across] <= bounds.max[across] + .12;
  });
};
const shadowSite = (body: BuildingPart, window: PersianWallWindow) => [body.position[0], body.position[2],
  ((window.angle + (body.rotation?.[1] ?? 0)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2),
  body.position[1] + window.bottom * body.size[1],
  body.position[1] + (window.spring + window.rise) * body.size[1]].map(value => value.toFixed(6)).join(":");

/** Canonical future-window default: one recessed visual plane, black at 50% opacity in both LODs. */
export const createWindowShadowPane = (opening: BuildingPart, recess = WINDOW_SHADOW_RECESS, outward?: Point3): BuildingPart => {
  if (opening.windowShadow) return opening;
  const across = opening.size.indexOf(Math.min(...opening.size)) as 0 | 1 | 2;
  const normal: Point3 = outward ? [...outward] : [0, 0, 0];
  if (!outward) normal[across] = Math.sign(opening.position[across]) || 1;
  const direction = turnPoint(...normal, eulerTurn(opening.rotation ?? [0, 0, 0]));
  const position = opening.position.map((value, axis) => value - direction[axis]! * recess) as Point3;
  const size: Point3 = [...opening.size]; size[across] = .001;
  return { ...opening, position, size, shape: "window-shadow", windowShadow: true, windowOpening: true, tint: [1, 1, 1],
    windowOpeningPosition: [...opening.position], windowOpeningSize: [...opening.size] };
};

/** Future open-doorway backing uses the same plane/material, without inventing a garrison slot. */
export const createDoorwayShadowPane = (opening: BuildingPart, recess = WINDOW_SHADOW_RECESS,
  outward?: Point3): BuildingPart => ({ ...createWindowShadowPane(opening, recess, outward),
  doorwayShadow: true, windowOpening: undefined, windowShadowDecorative: true });

/** A well shaft has one circular visual depth surface, not the two caps of an opaque cylinder. */
export const createOpeningShadowDisk = (opening: BuildingPart, detailed: boolean): BuildingPart => {
  const count = detailed ? 24 : 12;
  return { ...createWindowShadowPane(opening, Math.min(.006, opening.size[1] * .05), [0, 1, 0]),
    windowShadowDecorative: true,
    windowShadowContour: Array.from({ length: count }, (_, index) => {
      const angle = index * Math.PI * 2 / count;
      return [DMath.cos(angle) / 2, DMath.sin(angle) / 2] as const;
    }) };
};

/** A fitted arched shadow sits behind the actual inner reveal, not across the exterior wall face. */
export const createPersianWindowShadow = (body: BuildingPart, window: PersianWallWindow,
  opening?: BuildingPart): BuildingPart => {
  const yaw = body.rotation?.[1] ?? 0, height = window.spring + window.rise - window.bottom;
  const centreY = (window.bottom + window.spring + window.rise) / 2;
  const sx = 1 + ((body.topScale?.[0] ?? 1) - 1) * (centreY + .5);
  const sz = 1 + ((body.topScale?.[2] ?? 1) - 1) * (centreY + .5);
  const x = Math.sin(window.angle), z = Math.cos(window.angle), radius = .425;
  const localX = x * body.size[0] * sx * radius, localZ = z * body.size[2] * sz * radius;
  const position: Point3 = [body.position[0] + Math.cos(yaw) * localX + Math.sin(yaw) * localZ,
    body.position[1] + centreY * body.size[1], body.position[2] - Math.sin(yaw) * localX + Math.cos(yaw) * localZ];
  const width = Math.sin(window.halfAngle) * Math.hypot(z * body.size[0] * sx, x * body.size[2] * sz);
  const contour: [number, number][] = [[-.5, -.5], [.5, -.5]];
  for (let index = 0; index <= 12; index++) {
    const u = Math.cos(index / 12 * Math.PI), angle = window.angle + Math.asin(u * Math.sin(window.halfAngle));
    const crown = persianWindowCrown(window, angle) ?? window.spring;
    contour.push([u / 2, (crown - window.bottom) / height - .5]);
  }
  const direction = Math.atan2(x / (body.size[0] * sx), z / (body.size[2] * sz)) + yaw;
  const original: BuildingPart = opening ?? { position: [
    body.position[0] + (position[0] - body.position[0]) * .5 / radius, position[1],
    body.position[2] + (position[2] - body.position[2]) * .5 / radius],
    size: [width, height * body.size[1], .018], shape: "box", surface: "dark", stage: 2 };
  return { ...original, shape: "window-shadow", windowShadow: true, windowOpening: true, windowShadowContour: contour,
    windowShadowSite: shadowSite(body, window), windowShadowDecorative: opening ? undefined : true,
    position, size: [width, height * body.size[1], .001], rotation: [0, direction, 0], tint: [1, 1, 1],
    windowOpeningPosition: [...original.position], windowOpeningSize: [...original.size] };
};

/** Canonical final pass also catches windows introduced by later upgrade recipes. Idempotent. */
export const withBuildingWindowShadows = (recipe: BuildingRecipe): BuildingRecipe => {
  const parts = recipe.parts.map(part => {
    if (part.doorwayShadow && !part.windowShadow) return createDoorwayShadowPane(part);
    if (part.shape === "window-shadow" && !part.windowShadow)
      return createWindowShadowPane(part,
        Math.min(WINDOW_SHADOW_RECESS, Math.min(...part.size) * .05));
    return !part.windowShadow && isLegacyWindowPane(part, recipe.parts)
    // Legacy boxes already sit at the back of projecting window frames. Keep their back surface
    // visible instead of burying a new plane in an as-yet uncut solid wall; real arches use deep panes.
    ? createWindowShadowPane(part, Math.min(WINDOW_SHADOW_RECESS, Math.min(...part.size) * .05)) : part;
  });
  const existing = new Set(parts.map(part => part.windowShadowSite).filter(Boolean));
  const sites = new Map<string, { body: BuildingPart; window: PersianWallWindow }>();
  for (const body of recipe.parts) for (const window of body.persianWindows ?? []) {
    const key = shadowSite(body, window), old = sites.get(key);
    if (!old || body.size[1] > old.body.size[1]) sites.set(key, { body, window });
  }
  for (const [key, { body, window }] of sites) if (!existing.has(key))
    parts.push(createPersianWindowShadow(body, window));
  return { ...recipe, parts };
};

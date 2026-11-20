import type { Page } from "playwright-core";

/**
 * In-page staging of the SHIP-WIND review (ship-wind-review.ts) on the frozen owner-save frame of
 * water-review-page.ts: four render-only ships around the deep-water site at fixed headings relative to
 * the world wind (running, broad reach, beam reach, head to wind), the wind strength pinned per shot,
 * and iso, eye and spyglass framings. Nothing touches the simulation.
 */

/** Livery and trader nation of each staged ship and its heading relative to the downwind direction. */
export const SHIP_WIND_FLEET = [
  { heading: 0, label: "player junk, running", livery: undefined, nation: undefined },
  { heading: Math.PI / 2, label: "Roman trader, beam reach", livery: "neutral", nation: "roman" },
  { heading: Math.PI, label: "raider, head to wind", livery: "enemy", nation: undefined },
  { heading: -Math.PI / 4, label: "Nubian trader, broad reach", livery: "neutral", nation: "nubian" }
] as const;

/** Wind strength scale of a shot: the save's clear-weather wind, or the storm wind (rain level). */
export type ShipWindLevel = "calm" | "strong";
const STRONG_WIND_SCALE = 2.4;
/** Ship centres around the deep point, in world units (hull length about 9). */
const FLEET_OFFSETS = [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const;

/** Places the fleet, pins the wind and draws one frame at `time`. */
export const stageShipWind = (page: Page, level: ShipWindLevel, time: number) =>
  page.evaluate(async ({ fleet, level, offsets, scale, time }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    const { deep, water } = debug.sites;
    const frame = debug.frozenFrame, environment = frame.environment;
    const base = debug.baseWind ?? (debug.baseWind = { x: environment.windX, z: environment.windZ });
    const factor = level === "strong" ? scale : 1;
    environment.windX = base.x * factor; environment.windZ = base.z * factor;
    const downwind = Math.atan2(base.x, base.z);
    frame.time = time;
    frame.ships = fleet.map((ship, index) => ({ cargoCount: 0, id: 900 + index, livery: ship.livery,
      nation: ship.nation, phase: "sailing", x: deep.x + offsets[index]![0], y: water,
      yaw: downwind + ship.heading, z: deep.z + offsets[index]![1] }));
    debug.draw();
  }, { fleet: SHIP_WIND_FLEET, level, offsets: FLEET_OFFSETS, scale: STRONG_WIND_SCALE, time });

/** World height the views aim at: the middle of the sails (ship scale 4, sail centre about 1.2 up). */
const SAIL_LIFT = 4.6;

/**
 * Iso framing at the fleet centre (`ship` = -1) or one ship, aimed at sail height: the ground centre
 * moves along the camera's view ray until the ray passes SAIL_LIFT above the ship.
 */
export const fleetIsoView = (page: Page, ship: number, zoom: number) =>
  page.evaluate(({ lift, offsets, ship, zoom }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    const { deep } = debug.sites;
    const frame = structuredClone({ ...debug.isoFrame, felling: undefined, growth: undefined });
    Object.assign(frame, { felling: debug.isoFrame.felling, growth: debug.isoFrame.growth });
    const offset = ship < 0 ? [0, 0] : offsets[ship]!;
    Object.assign(frame.camera, { centerX: deep.x + offset[0]!, centerZ: deep.z + offset[1]!, zoom });
    debug.frozenFrame = frame;
    debug.draw();
    const view = debug.camera.getWorldDirection(debug.camera.position.clone());
    const reach = lift / Math.max(.2, -view.y), flat = Math.hypot(view.x, view.z) || 1;
    debug.towardsCamera = { x: -view.x / flat, z: -view.z / flat };
    frame.camera.centerX += view.x * reach; frame.camera.centerZ += view.z * reach;
  }, { lift: SAIL_LIFT, offsets: FLEET_OFFSETS, ship, zoom });

/**
 * Eye framings from the beach nearest the fleet (the eye needs ground under it): "far" stands
 * BEACH_BACK units inland looking at the fleet centre (possessed normal), "spyglass" the same stand at a
 * quarter of the field of view on one ship, "near" at the waterline looking at the nearest ship
 * (possessed close).
 */
const BEACH_BACK = 14;
export const fleetEyeView = (page: Page, kind: "far" | "near" | "spyglass", ship: number) =>
  page.evaluate(async ({ back, kind, lift, offsets, ship }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
    const { coast, deep, seaLevel, water } = debug.sites;
    const frame = debug.possessedFrame, pose = frame.exploration.camera.pose;
    debug.baseFov ??= pose.fov;
    const ships = offsets.map(([x, z]) => ({ x: deep.x + x, z: deep.z + z }));
    const nearest = ships.reduce((best, at) =>
      Math.hypot(at.x - coast.x, at.z - coast.z) < Math.hypot(best.x - coast.x, best.z - coast.z) ? at : best);
    const awayX = coast.x - deep.x, awayZ = coast.z - deep.z, away = Math.hypot(awayX, awayZ) || 1;
    const inland = kind === "near" ? 0 : back;
    const x = coast.x + awayX / away * inland, z = coast.z + awayZ / away * inland;
    const ground = Math.max(sampleSmooth(debug.world, debug.world.heights, x, z), seaLevel);
    Object.assign(pose, { x, y: ground + 1.7, z });
    const targets = { far: deep, near: nearest, spyglass: ships[ship]! };
    const aim = targets[kind], distance = Math.hypot(aim.x - pose.x, aim.z - pose.z);
    pose.yaw = Math.atan2(aim.x - pose.x, aim.z - pose.z);
    pose.pitch = Math.atan2(water + lift - pose.y, distance);
    pose.fov = kind === "spyglass" ? debug.baseFov / 4 : debug.baseFov;
    pose.viewDistance = Math.max(pose.viewDistance ?? 0, distance * 3);
    debug.frozenFrame = frame;
  }, { back: BEACH_BACK, kind, lift: SAIL_LIFT * .8, offsets: FLEET_OFFSETS, ship });

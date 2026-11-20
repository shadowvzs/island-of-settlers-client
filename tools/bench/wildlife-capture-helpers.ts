import type { Page } from "playwright-core";

/** A subject's place; `y` (critters) aims the eye up at a flying bird. */
export interface Spot { x: number; y?: number; z: number }

/** Height above the eye's ground from which a subject counts as flying (cells). */
const FLYING_HEIGHT = 1;

/** Centres the iso view on a ground point at `zoom`. */
export const focusGround = (page: Page, spot: Spot, zoom: number) =>
  page.evaluate(({ x, z, zoom }) => (window as any).__settlement.focusGround(x, z, zoom), { ...spot, zoom });

/** Keeps the possessed eye aimed at `target` (the spot the eye override reads every frame). */
export const aimEye = (page: Page, target: Spot) =>
  page.evaluate(spot => { (window as any).__lookTarget = spot; }, target);

/**
 * Possesses the nearest settler, then stands the eye at `eye` and keeps it aimed at the current
 * `aimEye` target: ground subjects are looked at from above, flying birds up at.
 */
export const possessEyeAt = async (page: Page, eye: Spot, target: Spot) => {
  await focusGround(page, eye, 3);
  await page.waitForTimeout(300);
  // The ground under the eye: the iso view is centred on it.
  const ground = await page.evaluate(() => window.__worker!.pickGround(innerWidth / 2, innerHeight / 2));
  await aimEye(page, target);
  await page.locator("[data-exploration-entry]").click();
  await page.waitForFunction(() => (window as any).__exploration.controller.snapshot().phase === "possessed",
    null, { timeout: 60_000 });
  await page.evaluate(({ eye, flyingHeight, groundY }) => {
    const camera = (window as any).__exploration.camera;
    const original = camera.setPose;
    camera.setPose = (pose: any, blend: number) => {
      if (!pose) return original(pose, blend);
      const target = (window as any).__lookTarget;
      const dx = target.x - eye.x;
      const dz = target.z - eye.z;
      const eyeHeight = pose.eyeHeight ?? 1.5;
      const flying = target.y !== undefined && target.y - groundY > flyingHeight;
      const rise = flying ? target.y - groundY - eyeHeight : -eyeHeight * 0.8;
      const pitch = Math.atan2(rise, Math.hypot(dx, dz));
      return original({ ...pose, eyeBaseY: groundY, pitch, x: eye.x, y: groundY + eyeHeight,
        yaw: Math.atan2(dx, dz), z: eye.z }, blend);
    };
  }, { eye, flyingHeight: FLYING_HEIGHT, groundY: ground?.y ?? 0 });
};

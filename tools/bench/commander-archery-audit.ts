import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

/** Native keyboard path, real draw and ordinary projectile service; no synthetic hit or actor mutation. */
export const auditCommanderBow = async (page: Page, output: string, quality: string, mode: string) => {
  await page.locator(".commander-control-reticle").waitFor({ state: "visible" });
  // tsx preserves inferred names on nested callbacks; browser-evaluated fixtures need its tiny helper.
  await page.evaluate("globalThis.__name = (target) => target");
  await page.evaluate(() => {
    const sim = (window as any).__settlement.simulation;
    const audit = { samples: [] as unknown[], arrows: new Map<number, unknown>(), stop: () => {} };
    audit.stop = sim.observeTicks(() => {
      const control = sim.commanderControlSnapshot();
      if (!control) return;
      const state = sim.militarySoldiers().find((row: any) => row.actor === control.actor)?.combat;
      if (state?.attackTime) audit.samples.push({ tick: sim.gameTick(), attackTime: state.attackTime,
        cooldown: state.cooldown, pendingAim: state.pendingAim, aimPoint: control.aimPoint });
      for (const arrow of sim.militaryArrows())
        if (arrow.shooter === control.actor && !audit.arrows.has(arrow.id)) audit.arrows.set(arrow.id, { ...arrow });
    });
    (window as any).__commanderBowAudit = audit;
  });
  try {
    await page.keyboard.down("KeyE");
    await page.waitForFunction(() => {
      const sim = (window as any).__settlement.simulation, actor = sim.commanderControlSnapshot()?.actor;
      return sim.militarySoldiers().find((row: any) => row.actor === actor)?.combat?.pendingAim;
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(output, `${quality}-${mode}-bow-draw.png`) });
    await page.waitForFunction(() => (window as any).__commanderBowAudit.arrows.size > 0);
    await page.keyboard.up("KeyE");
    const proof = await page.evaluate(() => {
      const audit = (window as any).__commanderBowAudit, settlement = (window as any).__settlement;
      const control = settlement.simulation.commanderControlSnapshot();
      return { samples: audit.samples, arrows: [...audit.arrows.values()], control,
        worker: settlement.workerFrames.find((row: any) => row.actorId === control.actor),
        mounts: settlement.mountedFrames?.filter((row: any) => row.actorId === control.actor),
        resources: (window as any).__commanderControl.debug().resources };
    });
    assert.equal(proof.arrows.length, 1, "One held attack releases one real arrow before the normal cooldown");
    assert(proof.samples.some((sample: any) => sample.pendingAim), "Actual draw stores bounded input aim");
    assert(proof.arrows[0].maximumAge >= .15 && proof.arrows[0].maximumAge <= .800001,
      "Real projectile has bounded legal range");
    await page.screenshot({ path: resolve(output, `${quality}-${mode}-bow-released.png`) });
    await page.waitForFunction(() => {
      const sim = (window as any).__settlement.simulation, actor = sim.commanderControlSnapshot()?.actor;
      const combat = sim.militarySoldiers().find((row: any) => row.actor === actor)?.combat;
      return combat && !combat.attackTime && combat.cooldown === 0;
    });
    return proof;
  } finally {
    await page.keyboard.up("KeyE");
    await page.evaluate(() => { (window as any).__commanderBowAudit?.stop(); delete (window as any).__commanderBowAudit; });
  }
};

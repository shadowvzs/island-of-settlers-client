import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

/** Actual actor/loadout/input and ordinary damage, after the noncombat identity/HP journey. */
export const auditCommanderMelee = async (page: Page, output: string, quality: string) => {
  await page.getByRole("button", { name: "Control commander", exact: true }).click();
  await page.waitForFunction(() => (window as any).__commanderControl.controller.active());
  await page.keyboard.down("ArrowDown"); await page.waitForTimeout(850); await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(200);
  // A mounted player's target stands below the actual eye: use the real look input to see it.
  const look = await page.locator(".exploration-ui__look").boundingBox(); assert(look);
  const lookX = look.x + look.width * .5, lookY = look.y + look.height * .25;
  await page.mouse.move(lookX, lookY); await page.mouse.down(); await page.waitForTimeout(100);
  await page.mouse.move(lookX, lookY + 150, { steps: 10 }); await page.mouse.up();
  await page.waitForFunction(() => (window as any).__settlement.simulation.commanderControlSnapshot()?.pitch < -.2);
  await page.evaluate(() => { document.exitPointerLock?.(); });
  const before = await page.evaluate(() => {
    const sim = (window as any).__settlement.simulation, control = sim.commanderControlSnapshot();
    const enemy = sim.spawnMilitaryOpponent({ x: control.x + Math.sin(control.yaw) * .9,
      z: control.z + Math.cos(control.yaw) * .9 }, "shield");
    if (enemy === null) throw new Error("Finite nearby opponent placement failed");
    const opponent = sim.militarySoldiers().find((row: any) => row.actor === enemy);
    return { actor: control.actor, horse: sim.militarySoldiers().find((row: any) => row.actor === control.actor).combat.mount,
      loadout: control.definition.loadout, opponent: enemy, hp: opponent.combat.hp };
  });
  try {
    await page.keyboard.down("KeyE");
    await page.waitForFunction(actor => {
      const sim = (window as any).__settlement.simulation;
      return sim.militarySoldiers().find((row: any) => row.actor === actor)?.combat?.attackTime > 0;
    }, before.actor);
    await page.waitForFunction(actor => {
      const soldier = (window as any).__settlement.simulation.militarySoldiers().find((row: any) => row.actor === actor);
      return soldier?.combat.attackTime > 0 && soldier.combat.attackTime <= .18;
    }, before.actor);
    const strikePresentation = await page.evaluate(() => ({
      camera: (window as any).__commanderControl.frame()?.camera?.pose,
      rendered: (window as any).__commanderControl.debug().renderPose,
      control: (window as any).__settlement.simulation.commanderControlSnapshot()
    }));
    await page.screenshot({ path: resolve(output, `${quality}-mounted-actual-melee.png`) });
    await page.waitForFunction(({ hp, opponent }) => {
      const sim = (window as any).__settlement.simulation;
      const soldier = sim.militarySoldiers().find((row: any) => row.actor === opponent);
      return !soldier || soldier.combat.hp < hp;
    }, before, { timeout: 10000 });
    await page.keyboard.up("KeyE");
    const after = await page.evaluate(opponent => {
      const sim = (window as any).__settlement.simulation, control = sim.commanderControlSnapshot();
      const own = sim.militarySoldiers().find((row: any) => row.actor === control?.actor);
      return { control, horse: own?.combat.mount,
        opponentHp: sim.militarySoldiers().find((row: any) => row.actor === opponent)?.combat.hp ?? 0 };
    }, before.opponent);
    assert.equal(after.control.actor, before.actor); assert.equal(after.horse, before.horse);
    assert(after.opponentHp < before.hp, "Actual manual national melee deals ordinary enemy damage");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !(window as any).__commanderControl.owns());
    return { before, after, strikePresentation };
  } finally {
    await page.keyboard.up("KeyE");
  }
};

import assert from "node:assert/strict";
import type { Page } from "playwright-core";

/** Diagnostic capability identities on the existing temporary explorer; no military-unit control is created. */
export const checkPossessedActionConfig = async (page: Page) => {
  await page.evaluate(() => { void (window as any).__exploration.controller.enter(); });
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed", null, { timeout: 180000 });
  await page.waitForTimeout(2100); // Keep the existing ordinary Leave dwell, independent of capability flags.
  const rows = [];
  await page.evaluate(() => {
    const h = window as any, controller = h.__exploration.controller;
    h.__originalCapabilityType = controller.options.actorType;
    controller.toggleSpyglass();
  });
  try {
    for (const actorType of ["Soldier", "commander", "unknown"]) {
      const direct = await page.evaluate(actorType => {
        const c = (window as any).__exploration.controller;
        c.options.actorType = () => actorType;
        const zoom = c.snapshot().spyglassZoom;
        c.adjustSpyglassZoom(1);
        const deniedZoom = c.snapshot().spyglassZoom === zoom, deniedJump = !c.jump();
        c.toggleSpyglass(); c.update(0);
        return { deniedJump, deniedZoom, actorType: c.snapshot().actorType };
      }, actorType);
      assert(direct.deniedJump && direct.deniedZoom);
      await page.waitForTimeout(100);
      await page.keyboard.press("Space"); await page.keyboard.press("KeyZ");
      await page.waitForTimeout(100);
      const actual = await page.evaluate(() => {
        const c = (window as any).__exploration.controller, frame = c.frame();
        const keys = document.querySelector(".exploration-ui__keys")?.textContent ?? "";
        return { actorType: c.snapshot().actorType, jump: Boolean(frame.appearance?.jump),
          spyglass: c.snapshot().spyglass, keys,
          hiddenLook: document.querySelector("[data-exploration-control='look']")?.hasAttribute("hidden"),
          hiddenMove: document.querySelector("[data-exploration-control='joystick']")?.hasAttribute("hidden") };
      });
      assert(!actual.jump && !actual.spyglass);
      assert(!actual.keys.includes("Jump") && !actual.keys.includes("Spyglass"));
      rows.push({ direct, actual });
    }
    assert(rows.at(-1)!.actual.hiddenLook && rows.at(-1)!.actual.hiddenMove);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (window as any).__exploration.controller.phase() !== "possessed", null, { timeout: 3000 });
    return { rows, emergencyEscape: true, scope: "Capability identities only; no soldier/commander possession runtime" };
  } finally {
    await page.evaluate(() => {
      const h = window as any, c = h.__exploration.controller;
      c.forceExit("session-replacement"); c.options.actorType = h.__originalCapabilityType;
      delete h.__originalCapabilityType;
    });
  }
};

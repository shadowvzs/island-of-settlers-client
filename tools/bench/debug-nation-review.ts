import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews","debug-nation-2026-11-03");
mkdirSync(output,{ recursive:true });
const { server,url } = await startDevServer();
const browser = await launchBrowser();
const errors:string[] = [], rows:unknown[] = [];
let status="running";
try {
  for (const quality of ["high","minimal"] as const) {
    const context = await browser.newContext({ viewport:{ width:1280,height:900 } });
    await context.addInitScript(quality=>{
      localStorage.setItem("island-of-settlers.graphics.detail",quality);
      localStorage.setItem("island-of-settlers.graphics.resolution","fast");
    },quality);
    const page=await context.newPage();
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`${url}admin.html`);
    await page.waitForFunction(()=>Boolean((window as any).__islandReady && (window as any).__settlement?.playerSession),
      null,{ timeout:120_000 });
    await page.getByRole("button",{ name:"Development tools",exact:true }).click();
    const panel=page.locator(".development-menu:not([hidden])");
    await panel.getByRole("tab",{ name:"Appearance",exact:true }).click();
    await panel.locator('[data-nation="persian"]').click();
    await page.waitForFunction(()=> (window as any).__settlement.simulation.playerNation()==="persian",null,{ timeout:120_000 });
    assert.equal(await page.evaluate(()=> (window as any).__settlement.playerSession.progress().inventory?.chooseNation??0),0);
    await page.evaluate(()=>{
      const player=(window as any).__settlement.playerSession;
      player.progress().gems=200;
      if(player.buyGemOffer("choose-nation")!==true)throw new Error("Fixture item purchase failed");
    });
    await panel.locator('[data-nation="maya"]').click();
    await page.waitForFunction(()=> (window as any).__settlement.simulation.playerNation()==="maya",null,{ timeout:120_000 });
    assert.equal(await page.evaluate(()=> (window as any).__settlement.playerSession.progress().inventory?.chooseNation??0),1);
    assert.equal(await page.evaluate(()=> (window as any).__settlement.playerSession.progress().gems),100);
    await page.waitForFunction(()=>document.querySelector('.development-menu [data-nation="maya"]')?.getAttribute("aria-checked")==="true");
    await page.screenshot({ path:resolve(output,`${quality}-debug-with-item-preserved.png`) });
    rows.push({ quality,zeroItemDebugChange:true,ownedItemPreserved:true,gemsUnchangedByDebug:true });
    await context.close();
  }
  assert.deepEqual(errors,[]);status="passed";
} finally {
  await browser.close();await server.close();
  writeFileSync(resolve(output,"report.json"),JSON.stringify({ status,rows,errors,
    scope:"Authorized dev-guest real Development Appearance controls, actual worker assets High/Minimal; server403/200 role and replay gates covered separately." },null,2));
}

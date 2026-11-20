import assert from "node:assert/strict";
import { mkdirSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser,startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output=resourcesPath("project-reviews","commander-recovery-2026-11-03");
mkdirSync(output,{ recursive:true });
const { server,url }=await startDevServer();
const browser=await launchBrowser();
const errors:string[]=[],rows:unknown[]=[];
let status="failed";
try {
  for (const quality of ["high","minimal"] as const) {
    const context=await browser.newContext({ viewport:{ width:1280,height:900 } });
    await context.addInitScript(quality=>{
      localStorage.setItem("island-of-settlers.graphics.detail",quality);
      localStorage.setItem("island-of-settlers.graphics.resolution","fast");
    },quality);
    const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`${url}admin.html?seed=123&size=96&forest=0&cache=0&time=day`);
    await page.waitForFunction(()=>Boolean((window as any).__islandReady && (window as any).__settlement?.playerSession),null,{ timeout:180000 });
    const before=await page.evaluate(async()=>{
      const settlement=(window as any).__settlement,sim=settlement.simulation,player=settlement.playerSession;
      const { LEVEL_THRESHOLDS }=await import(/* @vite-ignore */ String("/@id/@shared/catalog/balance"));
      player.progress().experience=LEVEL_THRESHOLDS[22];player.progress().gems=100;
      const built=sim.debugRaiseBuilding(62);if (!built.ok)throw new Error(built.reason);
      sim.receiveHomeGoods({ beer:10,coins:20,wine:10,shield:1,sword:1 });
      const recruited=sim.recruitCommander(built.building.uid);if (!recruited.ok)throw new Error(recruited.reason);
      const snapshot=sim.saveState(),commander=snapshot.military.commander;
      const soldier=snapshot.military.soldiers.find((row:any)=>row.commanderId===commander.id);
      return { id:commander.id,lodge:built.building.uid,actor:soldier.actor,mount:soldier.combat.mount,actors:snapshot.actors.length };
    });
    const openMenu=async()=>{
      if (!await page.getByRole("button",{ name:"Customization",exact:true }).isVisible())
        await page.getByRole("button",{ name:"Menu",exact:true }).click();
    };
    await page.locator(".player-hud__gems").click();
    await page.getByRole("tab",{ name:"Items",exact:true }).click();
    const offer=page.locator('[data-offer-id="commander-recovery"]');
    await offer.getByRole("button").click();
    await page.waitForFunction(()=>(window as any).__settlement.playerSession.progress().inventory?.commanderRecovery===1);
    assert.equal(await offer.getByRole("button").isDisabled(),true);
    await page.screenshot({ path:resolve(output,`${quality}-owned-shop.png`) });
    await page.locator('.settlement-ui__gem-shop-window').getByRole("button",{ name:/^Close .* window$/ }).click();
    await openMenu();await page.getByRole("button",{ name:"Inventory",exact:true }).click();
    const slot=page.locator('[data-item-id="commanderRecovery"]');await slot.click();
    const dialog=page.locator('.commander-recovery-window:not([hidden])');
    assert.equal(await dialog.getByRole("button",{ name:"Confirm",exact:true }).isDisabled(),true);
    await dialog.getByRole("button",{ name:"Cancel",exact:true }).click();
    assert.equal(await page.evaluate(()=>(window as any).__settlement.playerSession.progress().inventory.commanderRecovery),1);
    await page.evaluate(()=>{
      const sim=(window as any).__settlement.simulation,saved=sim.saveState();
      const commander=saved.military.commander,soldier=saved.military.soldiers.find((row:any)=>row.commanderId===commander.id);
      commander.location="recovering";commander.recoverySeconds=1800;soldier.combat.hp=1;
      saved.actors.find((row:any)=>row.uid===soldier.actor).phase="commanderRecovering";
      const loaded=sim.loadState(saved);if(!loaded.ok)throw new Error(loaded.reason);
    });
    await slot.click();
    await dialog.getByRole("button",{ name:"Confirm",exact:true }).waitFor();
    assert.equal(await dialog.getByRole("button",{ name:"Confirm",exact:true }).isEnabled(),true);
    await page.waitForTimeout(180);
    await page.screenshot({ path:resolve(output,`${quality}-confirm-recovery.png`) });
    await dialog.getByRole("button",{ name:"Confirm",exact:true }).click();
    await page.waitForFunction(()=>(window as any).__settlement.playerSession.progress().inventory?.commanderRecovery==null);
    const after=await page.evaluate(lodge=>{
      const { playerSession:player,simulation:sim }=(window as any).__settlement;
      const save=sim.saveState(),commander=sim.commanderSnapshot(),soldier=save.military.soldiers.find((row:any)=>row.commanderId===commander.id);
      return { commander:sim.commanderStatus(lodge),gems:player.progress().gems,actor:soldier.actor,
        mount:soldier.combat.mount,actors:save.actors.length,
        commanderCount:save.military.soldiers.filter((row:any)=>row.commanderId===commander.id).length,
        actorCount:save.actors.filter((row:any)=>row.uid===soldier.actor).length,
        mountCount:save.actors.filter((row:any)=>row.uid===soldier.combat.mount).length,
        item:player.progress().inventory?.commanderRecovery??0 };
    },before.lodge);
    assert.equal(after.commander.id,before.id);assert.equal(after.commander.hp,after.commander.maximumHp);
    assert.equal(after.commander.ready,true);assert.equal(after.commander.recoveryComplete,true);
    assert.equal(after.actor,before.actor);assert.equal(after.mount,before.mount);
    assert.equal(after.commanderCount,1);assert.equal(after.actorCount,1);assert.equal(after.mountCount,1);assert.equal(after.item,0);assert.equal(after.gems,50);
    await page.screenshot({ path:resolve(output,`${quality}-recovered.png`) });
    rows.push({ quality,price:50,healthyCommanderBlocked:true,cancelKeepsItem:true,
      itemConsumedOnce:true,fullHpReady:true,sameCommanderAndHorse:true,after });
    await context.close();
  }
  assert.deepEqual(errors,[]);status="passed";
} finally {
  await browser.close();await server.close();
  writeFileSync(resolve(output,"report.json"),JSON.stringify({ status,rows,errors,
    scope:"Actual guest shop/inventory/confirmation flow with High/Minimal assets. Authenticated server mutation separately verified using real PostgreSQL+canonical worker; no full online UI claim." },null,2));
}

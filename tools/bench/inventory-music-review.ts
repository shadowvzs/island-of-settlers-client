import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "inventory-confirmation-2026-11-03");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], rows: unknown[] = [];
let status = "running";
const playerMusic = (page: Page) => page.evaluate(async () => {
  const { createBrowserMusicPlayer } = await import(/* @vite-ignore */ String("/src/app/audio/music-player-service.ts"));
  return createBrowserMusicPlayer((window as any).__settlement.simulation.playerNation()).store.getSnapshot();
});
const openMenu = async (page: Page) => {
  if (!await page.getByRole("button", { name: "Customization", exact: true }).isVisible())
    await page.getByRole("button", { name: "Menu", exact: true }).click();
};
try {
  for (const quality of ["high", "minimal"] as const) {
    const context = await browser.newContext({ viewport: { width:1280,height:900 } });
    await context.addInitScript(quality => {
      localStorage.setItem("island-of-settlers.graphics.detail",quality);
      localStorage.setItem("island-of-settlers.graphics.resolution","fast");
      localStorage.setItem("island-of-settlers.sound","1");
      localStorage.setItem("island-of-settlers.sound.master-volume","80");
      localStorage.setItem("island-of-settlers.sound.music-volume","35");
    },quality);
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement?.playerSession),
      null,{ timeout:120_000 });
    const nation = await page.evaluate(() => (window as any).__settlement.simulation.playerNation());
    const initialMusic = await playerMusic(page);
    assert.equal(initialMusic.collection,nation);
    assert(initialMusic.tracks.length > 0);
    assert(initialMusic.tracks.every((track: { collection:string }) => track.collection === nation));
    await openMenu(page); // A real click also resumes autoplay if browser policy required it.
    await page.waitForFunction(async () => {
      const { createBrowserMusicPlayer } = await import(/* @vite-ignore */ String("/src/app/audio/music-player-service.ts"));
      return !createBrowserMusicPlayer((window as any).__settlement.simulation.playerNation()).store.getSnapshot().paused;
    },null,{ timeout:20_000 });
    await page.getByRole("button",{ name:"Customization",exact:true }).click();
    const customization = page.locator(".customization-window");
    await customization.locator('[data-nation="persian"]').waitFor();
    assert.equal(await customization.locator('[data-nation="persian"]').isDisabled(),true);
    await customization.getByRole("button",{ name:/^Close .* window$/ }).click();
    // Seed only this isolated guest fixture's premium balance. Purchases use the real UI/session rules.
    await page.evaluate(() => { (window as any).__settlement.playerSession.progress().gems = 200; });
    await page.locator(".player-hud__gems").click();
    await page.getByRole("tab",{ name:"Items",exact:true }).click();
    const offer = page.locator('[data-offer-id="choose-nation"]');
    await offer.getByRole("button").click();
    await page.waitForFunction(() => (window as any).__settlement.playerSession.progress().inventory?.chooseNation === 1);
    assert.equal(await offer.getByRole("button").isDisabled(),true);
    assert.equal(await page.evaluate(() => (window as any).__settlement.playerSession.progress().gems),100);
    await page.screenshot({ path:resolve(output,`${quality}-owned-shop.png`) });
    await page.locator(".settlement-ui__gem-shop-window").getByRole("button",{ name:/^Close .* window$/ }).click();
    await openMenu(page);
    await page.getByRole("button",{ name:"Inventory",exact:true }).click();
    await page.getByRole("tab", { name: "Misc", exact: true }).click();
    await page.locator("[data-item-id=chooseNation]").waitFor();
    assert.equal(await page.locator("[data-item-id=chooseNation] .choose-nation-icon img").count(),4);
    assert.equal(await page.locator("[data-inventory-slot]").count(),64);
    const slots = await page.locator(".player-inventory__grid").evaluate(element => {
      const style=getComputedStyle(element); return { columns:style.gridTemplateColumns.split(" ").length,
        rows:style.gridTemplateRows.split(" ").length };
    });
    assert.equal(slots.columns,8); assert.equal(slots.rows,8);
    await page.screenshot({ path:resolve(output,`${quality}-inventory.png`) });
    const spacing = await page.locator(".player-inventory__grid").evaluate(element=>{
      const grid=element.getBoundingClientRect(), frame=element.closest(".player-inventory-window")!.getBoundingClientRect();
      const body=element.closest(".player-inventory__viewport")!.getBoundingClientRect();
      return { left:grid.left-frame.left,right:frame.right-grid.right,
        top:grid.top-body.top,bottom:body.bottom-grid.bottom };
    });
    assert.ok(Math.abs(spacing.left-spacing.right)<=1,JSON.stringify(spacing));
    assert.ok(Math.abs(spacing.top-spacing.bottom)<=1,JSON.stringify(spacing));
    await page.setViewportSize({ width:375,height:720 });
    await page.waitForTimeout(100);
    const mobile = await page.locator('.player-inventory-window').evaluate(element=>{
      const frame=element.getBoundingClientRect();
      return { left:frame.left,right:frame.right,viewport:innerWidth,
        pageWidth:document.documentElement.scrollWidth };
    });
    assert.ok(mobile.left>=0 && mobile.right<=mobile.viewport+1,JSON.stringify(mobile));
    assert.ok(mobile.pageWidth<=mobile.viewport,JSON.stringify(mobile));
    await page.screenshot({ path:resolve(output,`${quality}-inventory-mobile.png`) });
    await page.setViewportSize({ width:1280,height:900 });
    await page.waitForTimeout(100);
    const slot=page.locator('[data-item-id="chooseNation"]');
    await slot.click();
    const chooser=page.locator('.nation-chooser-window:not([hidden])');
    await chooser.getByRole("button",{ name:"Confirm",exact:true }).waitFor();
    assert.equal(await chooser.locator(`[data-nation="${nation}"]`).isDisabled(),true);
    assert.equal(await chooser.getByRole("button",{ name:"Confirm",exact:true }).isDisabled(),true);
    const target = nation === "persian" ? "roman" : "persian";
    await chooser.locator(`[data-nation="${target}"]`).click();
    await chooser.getByRole("button",{ name:"Cancel",exact:true }).click();
    assert.equal(await page.evaluate(()=>(window as any).__settlement.playerSession.progress().inventory?.chooseNation),1);
    assert.equal(await slot.evaluate(element=>document.activeElement===element),true);
    await slot.click();
    assert.equal(await chooser.getByRole("button",{ name:"Confirm",exact:true }).isDisabled(),true);
    await chooser.locator(`[data-nation="${target}"]`).click();
    await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('.nation-chooser__actions button:last-child')?.disabled);
    await page.waitForTimeout(180);
    await page.screenshot({ path:resolve(output,`${quality}-nation-confirmation.png`) });
    await chooser.getByRole("button",{ name:"Confirm",exact:true }).click();
    await page.waitForFunction(target => (window as any).__settlement.simulation.playerNation() === target,
      target,{ timeout:120_000 });
    assert.equal(await page.evaluate(() => (window as any).__settlement.playerSession.progress().inventory?.chooseNation ?? 0),0);
    await page.locator('.player-inventory-window:not([hidden])').waitFor();
    assert.equal(await page.locator('[data-item-id="chooseNation"]').count(),0);
    await page.locator('.player-inventory-window').getByRole("button",{ name:/^Close .* window$/ }).click();
    await openMenu(page);
    await page.getByRole("button",{ name:"Customization",exact:true }).click();
    assert.equal(await customization.locator(`[data-nation="${target}"]`).isDisabled(),true);
    await page.waitForFunction(target => {
      const radio=document.querySelector(`.customization-window [data-nation="${target}"]`);
      const image=document.querySelector<HTMLImageElement>(".customization__gender-option .customization__face");
      return radio?.getAttribute("aria-checked")==="true" && image?.src.includes(`${target}-`);
    },target);
    const manual = await page.evaluate(async () => {
      const { createBrowserMusicPlayer } = await import(/* @vite-ignore */ String("/src/app/audio/music-player-service.ts"));
      const service = createBrowserMusicPlayer((window as any).__settlement.simulation.playerNation());
      service.selectCollection("neutral"); service.stop();
      return service.store.getSnapshot();
    });
    assert.equal(manual.collection,"neutral"); assert.equal(manual.paused,true);
    await page.screenshot({ path:resolve(output,`${quality}-consumed-customization.png`) });
    await page.evaluate(async () => {
      const { createBrowserMusicPlayer } = await import(/* @vite-ignore */ String("/src/app/audio/music-player-service.ts"));
      createBrowserMusicPlayer("roman");
    });
    assert.equal((await playerMusic(page)).collection,"neutral");
    assert.equal((await playerMusic(page)).paused,true);
    rows.push({ quality,initialNation:nation,initialMusicStatus:initialMusic.status,
      startupMusicPlays:true,nationPlaylistOnly:true,lockedWithoutItem:true,purchaseOne:true,inventoryAccessible:true,symmetricGridMargins:spacing,confirmationOnly:true,cancelRetainsItem:true,
      consumedAfterPreparedNationSwitch:true,manualMusicIntentPreserved:true });
    await context.close();
  }
  assert.deepEqual(errors,[]);
  status = "passed";
} finally {
  await browser.close(); await server.close();
  writeFileSync(resolve(output,"report.json"),JSON.stringify({ status,rows,errors,
    scope:"Real guest UI flow and actual national worker replacement High/Minimal; online ledger separately verified in disposable PostgreSQL. No full-E2E or performance claim." },null,2));
}

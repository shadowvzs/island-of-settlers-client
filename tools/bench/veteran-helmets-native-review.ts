import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { SHIPPED_MILITARY_AI_MODE, SHIPPED_MILITARY_AI_MODE_LABEL } from "../../src/shared/settlement/military-ai-mode";
import { launchBrowser, startDevServer } from "./browser";
import { closeDevelopment, openDevelopmentCategory } from "./development-ui-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Native rank-helmet check: actual finite Soldier/Veteran troops in the
 * real game on High and Minimal. Starts the training encounter, promotes its friendly soldiers
 * to RANK/RANKS (1 or 2), opens the headquarters roster, deploys the three foot types and captures close and
 * normal field views. Then it returns them to reserve, reloads the save and checks the rank and
 * equipment survive. `npx tsx tools/bench/veteran-helmets-native-review.ts`
 * (NATIONS=roman,viking, QUALITIES=high, RANKS=1,2 and OUTPUT customize the run).
 */
const NATIONS = (process.env.NATIONS ?? "roman,viking,nubian,japanese").split(",");
const QUALITIES = (process.env.QUALITIES ?? "high,minimal").split(",");
const RANKS = (process.env.RANKS ?? process.env.RANK ?? "2").split(",").map(Number);
assert(RANKS.every(rank => rank === 1 || rank === 2), "RANKS must contain Soldier 1 or Veteran 2");
const output = process.env.OUTPUT ?? resourcesPath("project-reviews", "veteran-helmets-2026-10-27", "native");
mkdirSync(output, { recursive: true });

const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
const report: unknown[] = [];

interface FieldSubject {
  actor: number;
  heading: number;
  phase: string;
  type: "archer" | "cavalry" | "heavy" | "shield";
  visible: boolean;
  x: number;
  y: number;
  z: number;
}

const advance = (page: Awaited<ReturnType<typeof browser.newPage>>, seconds: number) =>
  page.evaluate(seconds => {
    const simulation = (window as any).__settlement.simulation;
    for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
  }, seconds);

const setRanks = (page: Awaited<ReturnType<typeof browser.newPage>>, rank: number, nation: string) =>
  page.evaluate(async ({ nation, rank }) => {
    const simulation = (window as any).__settlement.simulation;
    const saved = simulation.saveState();
    saved.playerNation = nation;
    const hostile = new Set(saved.military.soldiers.filter((soldier: any) => soldier.combat?.faction > 0)
      .flatMap((soldier: any) => [soldier.actor, soldier.combat?.mount]));
    saved.military.soldiers = saved.military.soldiers.filter((soldier: any) => !hostile.has(soldier.actor));
    saved.actors = saved.actors.filter((actor: any) => !hostile.has(actor.uid));
    const friendly = saved.military.soldiers.filter((soldier: any) => soldier.combat?.faction === 0);
    for (const soldier of friendly) soldier.rank = rank;
    const loaded = simulation.loadState(saved);
    if (!loaded.ok) throw new Error("veteran rank fixture did not load");
    const replaced = await (window as any).__veteranReview.renderer.setWorkerAppearances([{ nation, variant: "a" }]);
    if (!replaced) throw new Error("Native worker appearance replacement failed");
    await (window as any).__settlement.setPlayerAppearances([{ nation, variant: "a" }]);
    return {
      ranks: simulation.militarySoldiers()
        .filter((soldier: any) => soldier.combat?.faction === 0)
        .map((soldier: any) => soldier.rank),
      stored: simulation.militaryStoredTroops().map((entry: any) => entry.count)
    };
  }, { rank, nation });

const openRoster = async (page: Awaited<ReturnType<typeof browser.newPage>>) => {
  const point = await page.evaluate(() => {
    const home = (window as any).__settlement.simulation.headquarters;
    return { x: home.x, z: home.z };
  });
  await page.evaluate(({ x, z }) => Object.assign((window as any).__veteranReview.camera,
    { centerX: x, centerZ: z, tilt: 0, yaw: 0, zoom: 2.4 }), point);
  await page.waitForTimeout(700);
  const screen = await page.evaluate(({ x, z }) =>
    (window as any).__settlement.projectGround(x, z), point);
  await page.mouse.click(screen.x, screen.y);
  await page.locator(".settlement-ui__building-details-window").waitFor({ state: "visible" });
  for (let step = 0; step < 3; step++) {
    if (await page.locator(".settlement-ui__soldier-inventory").isVisible()) break;
    await page.locator("[data-storage-page-next]").click();
    await page.waitForTimeout(250);
  }
  await page.locator(".settlement-ui__soldier-inventory").waitFor({ state: "visible" });
  return page.locator(".settlement-ui__soldier-inventory");
};

const closeRoster = async (page: Awaited<ReturnType<typeof browser.newPage>>) =>
  page.getByRole("button", { exact: true, name: "Close building details window" }).click();

const fieldSubject = (page: Awaited<ReturnType<typeof browser.newPage>>, rank: number) =>
  page.evaluate((rank): FieldSubject[] => {
    const simulation = (window as any).__settlement.simulation;
    const frames = simulation.frames();
    const friendly = simulation.militarySoldiers().filter((soldier: any) =>
      soldier.combat?.faction === 0 && soldier.combat?.type !== "cavalry" && soldier.rank === rank);
    return friendly.map((soldier: any): FieldSubject => {
      const actor = frames.find((entry: any) => entry.uid === soldier.actor);
      return { actor: soldier.actor, heading: actor?.yaw, phase: actor?.phase,
        type: soldier.combat.type, visible: actor?.visible, x: actor?.x, y: actor?.y, z: actor?.z };
    }).filter((subject: FieldSubject) => subject.visible && subject.phase === "militaryField");
  }, rank);

const callOut = (page: Awaited<ReturnType<typeof browser.newPage>>) =>
  page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const home = simulation.headquarters;
    const accepted = simulation.callOutMilitary(["shield", "heavy", "archer"],
      { x: home.x + 10, z: home.z + 10 });
    return { accepted, home: { x: home.x, z: home.z } };
  });

const hasAllTroops = (subjects: readonly FieldSubject[]) =>
  ["archer", "heavy", "shield"].every(type => subjects.some(subject => subject.type === type));

const deployAndShoot = async (page: Awaited<ReturnType<typeof browser.newPage>>, suffix: string, rank: number) => {
  let subjects: FieldSubject[] = [];
  for (let step = 0; step < 600 && !hasAllTroops(subjects); step++) {
    await advance(page, .5);
    subjects = await fieldSubject(page, rank);
  }
  assert(hasAllTroops(subjects), `${suffix}: all three foot troop types reach the field`);
  // Hold the field formation while the camera views settle; restore the loop before going home.
  await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    (window as any).__veteranUpdate = simulation.update;
    simulation.update = () => {};
  });
  const physicalField = await page.evaluate(() => (window as any).__settlement.simulation.saveState());
  // Put the camera in front of the soldier: the view direction at yaw 0 is (+x,+z), a heading of pi/4.
  const frontalYaw = (heading: number) => heading - Math.PI / 4;
  for (const type of ["archer", "heavy", "shield"] as const) {
    const subject = subjects.find((candidate: FieldSubject) => candidate.type === type)!;
    await page.evaluate(({ actor, save, x, y, yaw, z }) => {
      const simulation = (window as any).__settlement.simulation;
      for (const entry of save.actors) if (entry.uid !== actor) entry.visible = false;
      const loaded = simulation.loadState(save);
      if (!loaded.ok) throw new Error(loaded.reason);
      const offset = (y + 1.2) / Math.tan(Math.PI / 6) / Math.SQRT2;
      Object.assign((window as any).__veteranReview.camera, {
        centerX: x - offset * (Math.cos(yaw) + Math.sin(yaw)),
        centerZ: z - offset * (Math.cos(yaw) - Math.sin(yaw)), tilt: 0, yaw, zoom: 6
      });
    }, { actor: subject.actor, save: physicalField, x: subject.x, y: subject.y,
      yaw: frontalYaw(subject.heading), z: subject.z });
    await page.waitForFunction(({ nation, tier }) =>
      (window as any).__nativeHelmetArmourLoads?.some((entry: any) => entry.nation === nation && entry.rank === tier),
    { nation: suffix.split("-")[1], tier: rank === 1 ? "soldier" : "centurion" }, { timeout: 30_000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: resolve(output, `${suffix}-${type}-close.png`) });
    if (suffix.includes("japanese") && rank === 2 && type === "shield") {
      await page.evaluate(({ x, y, yaw, z }) => {
        const tilt = -Math.PI / 12;
        const offset = (y + 1.2) / Math.tan(Math.PI / 6 + tilt) / Math.SQRT2;
        Object.assign((window as any).__veteranReview.camera, {
          centerX: x - offset * (Math.cos(yaw) + Math.sin(yaw)),
          centerZ: z - offset * (Math.cos(yaw) - Math.sin(yaw)), tilt, yaw, zoom: 6
        });
      }, { x: subject.x, y: subject.y, yaw: frontalYaw(subject.heading) + Math.PI / 6, z: subject.z });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(output, `${suffix}-${type}-front-side.png`) });
    }
  }
  await page.evaluate(save => {
    const loaded = (window as any).__settlement.simulation.loadState(save);
    if (!loaded.ok) throw new Error(loaded.reason);
  }, physicalField);
  const shield = subjects.find((subject: FieldSubject) => subject.type === "shield")!;
  await page.evaluate(({ x, yaw, z }) => Object.assign((window as any).__veteranReview.camera,
    { centerX: x, centerZ: z, tilt: 0, yaw, zoom: 2 }),
  { x: shield.x, yaw: frontalYaw(shield.heading), z: shield.z });
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(output, `${suffix}-field-normal.png`) });
  return subjects;
};

const fieldRanks = (page: Awaited<ReturnType<typeof browser.newPage>>) =>
  page.evaluate(() => {
    const settlement = (window as any).__settlement;
    const foot = settlement.workerFrames.filter((worker: any) => worker.armourRank !== undefined)
      .map((worker: any) => ({ armourRank: worker.armourRank, faction: worker.combat?.faction,
        nation: worker.nation, type: worker.combat?.type }));
    const mounted = settlement.update(0).cavalryMounts.map((mount: any) =>
      ({ nation: mount.nation, rider: mount.rider }));
    return { foot, mounted };
  });

try {
  for (const quality of QUALITIES) {
    const initialNation = NATIONS[0]!;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    const assetResponses: { sha256: string; url: string }[] = [];
    const assetReads: Promise<void>[] = [];
    page.on("response", response => {
      if (!response.url().includes("/workers/armour/") || !response.url().endsWith(".glb")) return;
      assetReads.push(response.body().then(bytes => {
        assetResponses.push({ sha256: createHash("sha256").update(bytes).digest("hex"), url: response.url() });
        return undefined;
      }).catch(error => { errors.push(String(error)); }));
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(`window.__name = value => value;
      if (!localStorage.getItem("island-of-settlers.worker-nation"))
        localStorage.setItem("island-of-settlers.worker-nation", "${initialNation}");`);
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.route("**/*game-three-armour.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      const marker = "setArmourLod(worker.root, 0);";
      assert(source.includes(marker), "actual armour loader witness hook matches");
      await route.fulfill({ response, body: source.replace(marker, `${marker}
        globalThis.__nativeHelmetArmourLoads ??= [];
        const meshes=[];
        for (const root of attached) root.traverse(object=>{
          if (object.geometry) meshes.push({name:object.name,vertices:object.geometry.attributes.position.count});
        });
        globalThis.__nativeHelmetArmourLoads.push({nation,variant,rank,meshes});`) });
    });
    await page.route("**/src/app/island-runtime.ts", async route => {
      const response = await route.fetch();
      let source = await response.text();
      source = source.replace("if (import.meta.env.DEV) window.__islandReady = true;",
        `if (import.meta.env.DEV) {
           window.__veteranReview = { camera, renderer };
           window.__islandReady = true;
         }`);
      await route.fulfill({ response, body: source });
    });
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&landform=peninsula` +
      "&mountains=0&forest=0&reveal=1&cache=0&time=day");
    await page.waitForFunction(() => !!(window as any).__islandReady, null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const militaryPanel = await openDevelopmentCategory(page, "Military");
    await militaryPanel.getByText(`Mode: ${SHIPPED_MILITARY_AI_MODE_LABEL}`, { exact: true }).waitFor();
    const militaryMode = await page.evaluate(() => {
      const simulation = (window as any).__settlement.simulation;
      return { live: simulation.militaryAiMode(), saved: simulation.saveState().military.combat.aiMode };
    });
    assert.equal(militaryMode.live, SHIPPED_MILITARY_AI_MODE);
    assert.equal(militaryMode.saved, SHIPPED_MILITARY_AI_MODE);
    report.push({ militaryMode, panelText: await militaryPanel.innerText(), quality });
    await page.screenshot({ path: resolve(output, `${quality}-current-military-mode.png`) });
    await closeDevelopment(page);
    const started = await page.evaluate(() =>
      (window as any).__settlement.simulation.startMilitaryTrainingEncounter());
    assert.equal(started.ok, true, `${quality}: training encounter starts`);
    for (const nation of NATIONS) for (const rank of RANKS) {
      console.log(`Native helmet review: ${quality}/${nation}/rank${rank}`);
      const tier = rank === 1 ? "soldier" : "centurion";
      const suffix = `${quality}-${nation}-rank${rank}`;
      const ranks = await setRanks(page, rank, nation);
      await page.waitForTimeout(3000);
      assert(ranks.ranks.every((value: number) => value === rank), "every friendly soldier is veteran");
      const roster = await openRoster(page);
      await page.screenshot({ path: resolve(output, `${suffix}-roster.png`) });
      const rosterRanks = await roster.locator("[data-rank]").evaluateAll(nodes =>
        nodes.map(node => node.getAttribute("data-rank")));
      await closeRoster(page);
      const deployed = await callOut(page);
      assert(deployed.accepted > 0, `${quality}/${nation}: troops deploy`);
      const subjects = await deployAndShoot(page, suffix, rank);
      const frames = await fieldRanks(page);
      const friendlyFoot = frames.foot.filter((entry: any) => entry.faction === 0);
      assert(friendlyFoot.length >= 3, "field frames expose friendly foot armour ranks");
      assert(friendlyFoot.every((entry: any) => entry.armourRank === tier),
        `${quality}/${nation}: every field foot soldier uses the veteran armour tier`);
      assert(friendlyFoot.every((entry: any) => entry.nation === nation),
        `${quality}/${nation}: every field soldier keeps the player nation`);
      // Return the veterans to reserve and confirm identity, rank and equipment survive.
      const returned = await page.evaluate((entries: FieldSubject[]) => {
        const simulation = (window as any).__settlement.simulation;
        if ((window as any).__veteranUpdate) simulation.update = (window as any).__veteranUpdate;
        const ids = [...new Map(entries.map(subject => [subject.type, subject.actor])).values()];
        return { ids, accepted: simulation.returnMilitaryHome(ids) };
      }, subjects);
      assert.equal(returned.accepted, true, "veterans return home");
      let reserves = 0;
      for (let step = 0; step < 400 && reserves < returned.ids.length; step++) {
        await advance(page, .5);
        reserves = await page.evaluate(({ ids, rank }) => (window as any).__settlement.simulation.militarySoldiers()
          .filter((soldier: any) => ids.includes(soldier.actor) && soldier.rank === rank && soldier.combat?.faction === 0 &&
            soldier.combat?.type !== "cavalry" &&
            (window as any).__settlement.simulation.frames()
              .find((actor: any) => actor.uid === soldier.actor)?.phase === "militaryReserve").length, { ids: returned.ids, rank });
      }
      assert(reserves >= returned.ids.length,
        `${quality}/${nation}: one veteran of each foot type reaches reserve storage`);
      const afterReturn = await page.evaluate(() => {
        const simulation = (window as any).__settlement.simulation;
        const saved = simulation.saveState();
        const loaded = simulation.loadState(saved);
        return { loaded: loaded.ok, ranks: simulation.militarySoldiers()
          .filter((soldier: any) => soldier.combat?.faction === 0)
          .map((soldier: any) => soldier.rank) };
      });
      assert.equal(afterReturn.loaded, true, `${quality}/${nation}: save reload succeeds`);
      assert(afterReturn.ranks.every((value: number) => value === rank),
        `${quality}/${nation}: veteran ranks survive reload`);
      // Deploy once more after the reload: the rendered tier must be veteran again.
      const redeployed = await callOut(page);
      assert(redeployed.accepted > 0, `${quality}/${nation}: veterans redeploy after reload`);
      let reloadSubjects: FieldSubject[] = [];
      for (let step = 0; step < 400 && !hasAllTroops(reloadSubjects); step++) {
        await advance(page, .5);
        reloadSubjects = (await fieldSubject(page, rank)).filter(subject => returned.ids.includes(subject.actor));
      }
      assert(hasAllTroops(reloadSubjects), `${quality}/${nation}: reloaded foot types reach the field`);
      const reloadFrames = await fieldRanks(page);
      const reloadFoot = reloadFrames.foot.filter((entry: any) => entry.faction === 0);
      assert(reloadFoot.length >= 3 && reloadFoot.every((entry: any) =>
        entry.armourRank === tier && entry.nation === nation),
      `${quality}/${nation}: reloaded foot soldiers keep the veteran tier`);
      const reloadShield = reloadSubjects.find((subject: FieldSubject) => subject.type === "shield")!;
      await page.evaluate(({ x, yaw, z }) => Object.assign((window as any).__veteranReview.camera,
        { centerX: x, centerZ: z, tilt: 0, yaw, zoom: 6 }),
      { x: reloadShield.x, yaw: reloadShield.heading - Math.PI / 4, z: reloadShield.z });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: resolve(output, `${suffix}-reload-shield-close.png`) });
      await Promise.all(assetReads);
      const armourLoads = await page.evaluate(() => (window as any).__nativeHelmetArmourLoads);
      report.push({ armourLoads, assetResponses: [...assetResponses], errors: [...errors], frames, nation, quality, rank, ranks: ranks.ranks, redeployed: redeployed.accepted,
        reloadFrames, reserves, rosterRanks: [...new Set(rosterRanks)], subjects });
      writeFileSync(resolve(output, "native-review.json"), JSON.stringify(report, null, 2));
      assert.deepEqual(errors, []);
    }
    // One full native application reload per quality proves the final physical deployment persists.
    const finalNation = NATIONS.at(-1)!, finalRank = RANKS.at(-1)!;
    await page.evaluate(async nation => {
      localStorage.setItem("island-of-settlers.worker-nation", nation);
      const flushed = await (window as any).__settlement.saving.flush("manual");
      const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      const store = await openLocalSaveStore();
      const saved = await store.readSavedGame();
      if (!flushed || !saved) throw new Error("Native helmet save flush failed");
      await store.writeStartupGame(JSON.stringify(saved));
    }, finalNation);
    await Promise.all([page.waitForEvent("load"), page.evaluate(() => location.reload())]);
    await page.waitForFunction(() => !!(window as any).__islandReady, null, { timeout: 180_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
    await page.waitForTimeout(900);
    const appReloadFrames = await fieldRanks(page);
    const expectedTier = finalRank === 1 ? "soldier" : "centurion";
    const foot = appReloadFrames.foot.filter((entry: any) => entry.faction === 0);
    report.push({ appReloadFrames, errors: [...errors], finalNation, finalRank, quality });
    writeFileSync(resolve(output, "native-review.json"), JSON.stringify(report, null, 2));
    await page.screenshot({ path: resolve(output, `${quality}-actual-app-reload.png`) });
    assert(foot.length >= 3 && foot.every((entry: any) =>
      entry.nation === finalNation && entry.armourRank === expectedTier), "native app reload keeps nation and rank");
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "native-review.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
} finally {
  await browser.close();
  await server.close();
}

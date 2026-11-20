import type { Page } from "playwright-core";

/** Recruits a commander at a debug-raised Lodge 62 (bench fixture shared by possession harnesses). */
export const recruitCommander = (page: Page) => page.evaluate(async () => {
  const host = window as any;
  const { playerSession: player, simulation: sim } = host.__settlement;
  const { LEVEL_THRESHOLDS } = await import(/* @vite-ignore */ String("/@id/@shared/catalog/balance"));
  player.progress().experience = LEVEL_THRESHOLDS[22];
  // A developed save may already own the single Lodge: recruit there instead of raising another.
  const existing = sim.buildings().find((building: any) => building.typeId === 62);
  const built = existing ? { building: existing, ok: true } : sim.debugRaiseBuilding(62);
  if (!built.ok) throw new Error(built.reason);
  const { commanderRecruitCost } = await import(
    /* @vite-ignore */ String("/src/shared/settlement/settlement-commander.ts"));
  sim.receiveHomeGoods(commanderRecruitCost(sim.playerNation()));
  const result = sim.recruitCommander(built.building.uid);
  if (!result.ok) throw new Error(result.reason);
  const commander = sim.commanderSnapshot();
  const soldier = sim.militarySoldiers().find((row: any) => row.commanderId === commander.id);
  return { commander: commander.id, actor: soldier.actor, lodge: built.building.uid };
});

/** Retries the deployment until the recruited commander has left the Lodge. */
export const deployCommander = (page: Page) => page.evaluate(async () => {
  const sim = (window as any).__settlement.simulation;
  const deadline = performance.now() + 20000;
  let reason = "Commander deployment did not finish";
  while (performance.now() < deadline) {
    const deployed = sim.deployCommander();
    if (deployed.ok) return;
    reason = deployed.reason;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(reason);
});

/** Waits until the deployed commander actor is in the field. */
export const waitCommanderInField = (page: Page) => page.waitForFunction(() => {
  const sim = (window as any).__settlement.simulation;
  const commander = sim.commanderSnapshot();
  const soldier = sim.militarySoldiers().find((row: any) => row.commanderId === commander?.id);
  return sim.frames().find((row: any) => row.uid === soldier?.actor)?.phase === "militaryField";
}, null, { timeout: 60000 });

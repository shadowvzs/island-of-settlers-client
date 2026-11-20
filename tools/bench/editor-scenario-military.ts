import assert from "node:assert/strict";

import type { EditorSession } from "./editor-native-session";

/** Author every exposed ordinary type/rank through the real garrison controls. */
export const placeEditorGarrisonMatrix = async (session: EditorSession) => {
  const { button, page } = session;
  const labels: Record<string, string> = { archer: "Archer", heavy: "Heavy infantry", shield: "Shield" };
  const groups: { rank: number; type: string }[] = [];
  for (const type of ["shield", "heavy", "archer"]) for (const rank of [0, 1, 2]) {
    const point = await page.evaluate(async ({ rank, type }) => {
      const { world } = (window as any).__editorReview;
      const { validateMapScenario } = await import(/* @vite-ignore */ String(
        "/src/shared/settlement/settlement-map-scenario.ts"));
      const existing = world.scenario.buildings;
      const id = Math.max(0, ...existing.map((entry: any) => entry.id),
        ...world.scenario.units.map((entry: any) => entry.id)) + 1;
      for (let z = 24; z < world.cellsZ - 24; z += 4) for (let x = 24; x < world.cellsX - 24; x += 4) {
        const entry = { id, x, z, type: 1, rotation: 0, faction: 2, defenders: 1,
          garrison: [{ type, rank, count: 1 }] };
        const candidate = { ...world, scenario: { ...world.scenario, buildings: [...existing, entry] } };
        if (!validateMapScenario(candidate).length) return { x, z };
      }
      throw new Error(`No legal ${type}/${rank} garrison plot`);
    }, { rank, type });
    await session.step(`garrison-${type}-rank-${rank}`, async () => {
      await page.getByRole("combobox", { name: "Enemy building", exact: true }).selectOption("1");
      const summary = page.locator("summary").filter({ hasText: "Garrison troop composition" });
      if (await summary.locator("..").getAttribute("open") === null) await summary.click();
      await page.getByRole("combobox", { name: "Garrison mode", exact: true }).selectOption("authored composition");
      for (const groupType of ["shield", "heavy", "archer"]) for (const groupRank of [1, 2, 3])
        await page.getByRole("spinbutton", { name: `${labels[groupType]} rank ${groupRank} count`, exact: true }).fill("0");
      await page.getByRole("spinbutton", { name: `${labels[type]} rank ${rank + 1} count`, exact: true }).fill("1");
      if (await button("Place enemy building").getAttribute("aria-pressed") !== "true")
        await button("Place enemy building").click();
      await session.click(point);
    });
    groups.push({ rank, type });
  }
  return groups;
};

/** A real competing NPC attacks the authored patrol; no stubbed combat/busy result. */
export const exerciseEditorPatrolCombat = async (session: EditorSession) => {
  const { page } = session;
  const engaged = await page.evaluate(() => {
    const sim = (window as any).__settlement.simulation;
    const patrol = sim.saveState().authoredScenario?.patrols?.[0];
    if (!patrol) throw new Error("The authored map has no live patrol");
    const actor = sim.frames().find((entry: any) => entry.uid === patrol.actor);
    let opponent: number | null = null;
    for (const radius of [1.5, 2, 3]) for (let angle = 0; angle < Math.PI * 2 && opponent === null; angle += Math.PI / 4)
      opponent = sim.spawnMilitaryOpponent({ x: actor.x + Math.cos(angle) * radius,
        z: actor.z + Math.sin(angle) * radius }, "shield", 0, 3);
    if (opponent === null) throw new Error("No clear competing-faction patrol opponent spot");
    for (let tick = 0; tick < 2400; tick++) {
      sim.update(.05);
      const soldier = sim.militarySoldiers().find((entry: any) => entry.actor === patrol.actor);
      const combat = soldier?.combat;
      if (combat?.target === opponent || combat?.pendingTarget === opponent || combat?.attackTime > 0) {
        const saved = sim.saveState(), loaded = sim.loadState(saved);
        if (!loaded.ok) throw new Error(loaded.reason);
        (window as any).__settlement.focusGround(actor.x, actor.z, 2.5);
        return { actor: patrol.actor, combat, next: saved.authoredScenario.patrols[0].next, opponent, tick };
      }
    }
    throw new Error("The actual patrol never entered combat");
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${session.output}/patrol-combat.png` });
  session.rows.push({ name: "native-patrol-combat-engaged", engaged }); session.flush();
  const finished = await page.evaluate(({ actor, next, opponent }) => {
    const sim = (window as any).__settlement.simulation;
    let busyObserved = false, damageObserved = false, resumed = false;
    const initial = sim.militarySoldiers().find((entry: any) => entry.actor === actor)?.combat?.hp;
    for (let tick = 0; tick < 12000; tick++) {
      sim.update(.05);
      const soldier = sim.militarySoldiers().find((entry: any) => entry.actor === actor);
      const patrol = sim.saveState().authoredScenario.patrols.find((entry: any) => entry.actor === actor);
      if (!soldier || !patrol) throw new Error("The patrol was lost before it could resume");
      damageObserved ||= soldier.combat.hp < initial;
      const enemy = sim.militarySoldiers().some((entry: any) => entry.actor === opponent);
      if (enemy && (soldier.combat.target !== undefined || soldier.combat.attackTime)) {
        busyObserved = true;
        if (patrol.next !== next) throw new Error("Patrol advanced its route while fighting");
      }
      if (!enemy && patrol.next !== next) { resumed = true; break; }
    }
    return { busyObserved, damageObserved, resumed };
  }, engaged);
  assert(finished.busyObserved, "actual fighting must interrupt the patrol route");
  assert(finished.resumed, "the live patrol must resume after its opponent is gone");
  session.rows.push({ name: "actual-patrol-combat-interruption-reload-and-resume", engaged, finished });
  session.flush();
};

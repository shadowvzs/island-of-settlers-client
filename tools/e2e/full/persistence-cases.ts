import { join } from "node:path";
import type { Page } from "playwright-core";

import { verifyCheckpoint, writeCheckpoint } from "./checkpoints";
import { MissingPrerequisite } from "./report";
import { verifyRestoreBoundary } from "./restore-observations";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
export const PHASES = ["construction", "carrying", "production", "upgrade", "recruitment", "rally", "combat", "voyage"] as const;

/** Each phase requires actual ongoing work; absence is blocked, never silently passed. */
export const runPersistenceCases = async (page: Page, runCase: RunCase, directory: string) => {
  for (const phase of PHASES) {
    await runCase(`E2E-13-${phase}-restore`, `Export/import actual active ${phase} state`, async () => {
      const active = await page.evaluate((kind) => {
        const sim = (window as any).__settlement.simulation;
        const state = sim.saveState();
        const buildings = state.buildings, actors = state.actors;
        const counts: Record<string, number> = {
          construction: buildings.filter((b: any) => b.construction < 1).length,
          carrying: actors.filter((actor: any) => actor.ware).length,
          production: actors.filter((actor: any) => ["work", "chop", "plant", "fish_wait", "fish_reel"].includes(actor.action)).length,
          upgrade: buildings.filter((b: any) => b.workshopUpgrade?.requested && (b.workshopUpgrade.progress ?? 0) < 1).length,
          recruitment: (state.tavern?.batches?.length ?? 0) +
            (state.tavern?.orders ?? []).reduce((sum: number, entry: any) => sum + entry[1].length, 0),
          rally: state.military?.rally ? 1 : 0,
          combat: actors.filter((actor: any) => ["attack", "shoot", "fight"].includes(actor.action)).length,
          voyage: sim.colonyExpeditions().filter((expedition: any) => expedition.status !== "arrived").length
        };
        return { phase: kind, count: counts[kind], buildings: buildings.length, actors: actors.length };
      }, phase);
      if (!active.count) throw new MissingPrerequisite(`No actual ${phase} in this checkpoint; supply the corresponding journey checkpoint`);
      const checkpoint = await writeCheckpoint(page, join(directory, "checkpoints"), `active-${phase}`);
      const restored = await verifyCheckpoint(page, checkpoint);
      const ownership = await verifyRestoreBoundary(page);
      return { active, checkpoint, restored, ownership,
        scope: "Stable terrain and exact pre-update ownership verified after real UI restore. Offline catch-up remains separate." };
    });
  }
};

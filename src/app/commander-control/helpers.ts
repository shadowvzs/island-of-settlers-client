import { NATION_RIDERS } from "../../render-common/mounts/nation-riders";
import type { ExplorationHeroBody, WorkerFrame, WorkerNation } from "../../render-common/workers/worker-unit";
import type { CommanderSnapshot } from "../../shared/settlement/settlement-commander";
import type { SettlementSoldier } from "../../shared/settlement/settlement-military";
import { militaryArmourRank } from "../../shared/settlement/settlement-military-ranks";

/** The left-side control entry belongs only to a commander who has physically left the lodge. */
export const commanderControlEntryVisible = (
  commander: Pick<CommanderSnapshot, "location"> | undefined
) => commander?.location === "field";

/** The commander's crowd body: the nation's rider variant in the soldier's actual armour rank. */
export const commanderHeroBody = (nation: WorkerNation, rank: number): ExplorationHeroBody => ({
  armourRank: militaryArmourRank(rank),
  nation,
  variant: NATION_RIDERS[nation]
});

/** One entry per nation/body/rank: repeated bodies share the same authored level chain. */
export const uniqueHeroBodies = (bodies: readonly ExplorationHeroBody[]): readonly ExplorationHeroBody[] => {
  const seen = new Set<string>();
  return bodies.filter(body => {
    const key = `${body.nation}/${body.variant}/${body.armourRank ?? "civilian"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * The bodies the possession entry preloads: the commander (whose lodge body has no live frame
 * yet) and the selected escort soldiers (resolved through their rendered frames). Pure; entries
 * without a frame are skipped rather than guessed.
 */
export const commanderExplorationHeroes = (
  commander: { nation: WorkerNation } | undefined,
  soldiers: readonly SettlementSoldier[],
  frames: readonly WorkerFrame[]
): readonly ExplorationHeroBody[] => {
  if (!commander) return [];
  const commanderRow = soldiers.find(row => row.commanderId !== undefined);
  if (!commanderRow) return [];
  const framesByActor = new Map(frames.flatMap(frame =>
    frame.actorId === undefined ? [] : [[frame.actorId, frame] as const]));
  const heroes: ExplorationHeroBody[] = [commanderHeroBody(commander.nation, commanderRow.rank)];
  for (const row of soldiers) {
    if (row.commanderId !== undefined || row.combat?.selected !== true) continue;
    const frame = framesByActor.get(row.actor);
    if (!frame) continue;
    heroes.push({ armourRank: frame.armourRank, nation: frame.nation, variant: frame.variant });
  }
  return uniqueHeroBodies(heroes);
};

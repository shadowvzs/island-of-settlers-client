import type { ScriptEventActor } from "../../../../../island-of-settlers-shared/src/script/types/emission";
import type { ResourceTarget, SettlementActor, SettlementContext } from "../../settlement/settlement-types";
import { describeUnit } from "../script-actors";
import { listening } from "../script-unit-events";
import { depositType, describeProp, describeShell } from "./nature-actors";

/**
 * Nature emission sites (trigger design §5.1.5, lane TRG3b). Like the unit sites, every helper bit-tests first, so
 * a map without a script pays one optional-chain read; describe props before the simulation removes them.
 */

const string = (value: string) => ({ type: "string" as const, value });
const number = (value: number) => ({ type: "number" as const, value });

const unit = (context: SettlementContext, actor: SettlementActor | undefined) =>
  actor && context.script && describeUnit(context, context.script.generations, actor);

/** The prop a tree or stone target names, as the script sees it now (before the work removes it). */
export const describeTargetProp = (context: SettlementContext, target: ResourceTarget) => {
  const script = context.script;
  if (!script || target.id < 0 || (target.kind !== "tree" && target.kind !== "stone")) return undefined;
  return describeProp(context.options.world, script.natureGenerations, target.id);
};

/** A worker's event about a prop: the worker is the subject (`by`), the prop its own slot. */
const workerPropEvent = (
  context: SettlementContext, kind: "stonePickedUp" | "treeCut" | "treePlanted", slot: string,
  prop: ScriptEventActor, worker: SettlementActor, ware?: string
) => {
  if (!listening(context, kind)) return;
  const by = unit(context, worker);
  context.script!.emit({
    actors: by ? { by, [slot]: prop } : { [slot]: prop }, kind, player: by?.owner ?? null,
    responses: {
      targetActor: prop.handle, ...(by ? { triggeringActor: by.handle } : {}), ...(ware ? { ware: string(ware) } : {})
    },
    ...(ware ? { values: { ware } } : {})
  });
};

/** A woodcutter started felling a tree (the felling is committed: the tree falls). */
export const emitTreeCut = (context: SettlementContext, tree: ScriptEventActor, feller: SettlementActor) =>
  workerPropEvent(context, "treeCut", "tree", tree, feller);

/** A forester planted a sapling: the new tree prop. */
export const emitTreePlanted = (context: SettlementContext, prop: number, forester: SettlementActor) => {
  if (!listening(context, "treePlanted")) return;
  const tree = describeProp(context.options.world, context.script!.natureGenerations, prop);
  if (tree) workerPropEvent(context, "treePlanted", "tree", tree, forester);
};

/** A stonecutter took stone from a boulder or rock. */
export const emitStonePickedUp = (
  context: SettlementContext, stone: ScriptEventActor, worker: SettlementActor, ware: string
) => workerPropEvent(context, "stonePickedUp", "prop", stone, worker, ware);

/** A used up boulder rests and later respawns in the same prop slot: the next one is another object. */
export const retireBoulder = (context: SettlementContext, prop: number) => {
  const script = context.script;
  if (!script) return;
  script.natureGone("prop", prop, "consumed", describeProp(context.options.world, script.natureGenerations, prop));
};

/** A growing tree reached its next growth stage (2 .. 5; 5 = mature). Trees are ownerless. */
export const emitTreeStage = (context: SettlementContext, prop: number, stage: number) => {
  if (!listening(context, "treeGrowthStage")) return;
  const tree = describeProp(context.options.world, context.script!.natureGenerations, prop);
  if (!tree) return;
  context.script!.emit({
    actors: { tree }, kind: "treeGrowthStage", player: null,
    responses: { stage: number(stage), targetActor: tree.handle }, values: { stage }
  });
};

/** A mine dug one ore from `cell` (the event's place: its `region` filter tests the cell). */
export const emitDepositMined = (
  context: SettlementContext, cell: number, ware: string | undefined, owner: number
) => {
  if (!listening(context, "depositMined")) return;
  const { world } = context.options;
  const ore = world.mineZones.find(zone => zone.id === world.mineZone[cell])?.ore;
  const deposit = ore === undefined ? undefined : depositType(ore);
  if (!deposit) return;
  context.script!.emit({
    at: { x: cell % world.cellsX + .5, z: Math.floor(cell / world.cellsX) + .5 }, kind: "depositMined",
    player: owner, responses: { amount: number(1), ...(ware ? { ware: string(ware) } : {}) },
    values: { deposit, ...(ware ? { ware } : {}) }
  });
};

/** The player collected a shore shell: it is consumed; the one that reappears far away is another incarnation. */
export const emitShellPickedUp = (context: SettlementContext, index: number, kind: string) => {
  const script = context.script;
  if (!script) return;
  const shell = describeShell(script.natureGenerations, index, kind);
  if (!shell) return;
  if (script.isSubscribed("shellPickedUp")) {
    script.emit({ actors: { shell }, kind: "shellPickedUp", player: 0,
      responses: { targetActor: shell.handle } });
  }
  script.natureGone("shell", index, "consumed", shell);
};

/** A hunter's arrow hits `slot`: a kill it causes is announced as killed by the hunter, then the animal is gone. */
export const shootAnimal = (context: SettlementContext, hunter: SettlementActor, slot: number) => {
  const hit = () => context.options.hitHuntTarget?.(slot, hunter) ?? false;
  const script = context.script;
  if (!script) return hit();
  return script.huntWith(slot, unit(context, hunter), hit);
};

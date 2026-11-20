import { MARBLE_DEPOSIT_QUANTITY, STONE_SOURCE_REST_SECONDS } from "../../shared/balance/resources";
import { validateMapScenario } from "../../shared/settlement/settlement-map-scenario";
import { COLONY_RESOURCE_TIERS, type ColonyStone } from "../../shared/world/colony-resource-tiers";
import { getAuthoredDeposits, type MarbleDeposit, MAX_MARBLE_DEPOSITS } from "../../shared/world/marble-deposit";
import { BUILD, type WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { bumpBuildRevision } from "./helpers";
import {
  getMaterialRefusal, setAuthoredDeposits, stoneLabel, toDepositOption, toValidationScenario
} from "./marble-deposit-helpers";
import { editorMessage, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore, type FieldOption, keepOption } from "./section-store";

/** The deposit materials: their palette buttons. */
export const MARBLE_MATERIALS = COLONY_RESOURCE_TIERS.map(pair => ({
  icon: new URL(`../../../assets/editor-icons/${pair.stone}-deposit.png`, import.meta.url).href,
  label: stoneLabel(pair.stone),
  title: editorMessage(M.actions.placeStoneDeposit, { stone: stoneLabel(pair.stone) }),
  value: pair.stone as string
}));

const RESPAWN_MINUTES = STONE_SOURCE_REST_SECONDS / 60;

/**
 * Stone material sources (marble, limestone, basalt, granite) on any map: an authored scenario keeps them
 * in its definition, a plain home or colony map in its own sources. Placing is select type, then click the
 * map. Moving reuses source identity and depletion; it never creates a replacement source.
 */
export const createMarbleEditor = (world: WorldData, store: EditorStore, history: EditorHistory,
  onEdit: () => boolean | void) => {
  const section = createSectionStore({
    material: MARBLE_MATERIALS[0]!.value,
    options: [] as readonly FieldOption[],
    quantity: String(MARBLE_DEPOSIT_QUANTITY),
    selected: "",
    x: "1.5",
    z: "1.5"
  });
  const selected = () => getAuthoredDeposits(world).find(deposit => String(deposit.id) === section.get().selected);
  const showSelected = () => {
    const deposit = selected(); if (!deposit) return;
    section.update({ material: deposit.material ?? "marble", quantity: String(deposit.remaining),
      x: String(deposit.x), z: String(deposit.z) });
  };
  const render = () => {
    const options = getAuthoredDeposits(world).map(toDepositOption);
    section.update({ options, selected: keepOption(options, section.get().selected) });
    showSelected();
  };
  const mutate = (deposits: MarbleDeposit[]) => {
    if (onEdit() === false) return;
    history.transaction(() => { setAuthoredDeposits(world, deposits); bumpBuildRevision(world); });
    render();
  };
  const isClearGround = (deposit: MarbleDeposit) => {
    const cell = Math.floor(deposit.z) * world.cellsX + Math.floor(deposit.x);
    return deposit.x >= 1 && deposit.z >= 1 && deposit.x < world.cellsX - 1 && deposit.z < world.cellsZ - 1 &&
      Boolean(world.walkCost[cell]) && world.blocking[cell] === 0 && !world.settlementGroundClearance?.[cell] &&
      world.buildClass[cell]! >= BUILD.flag && world.buildClass[cell]! <= BUILD.large;
  };
  const validSite = (deposit: MarbleDeposit, deposits: MarbleDeposit[]) => {
    const crowded = deposits.some(other => other.id !== deposit.id &&
      Math.hypot(other.x - deposit.x, other.z - deposit.z) < 3);
    if (!isClearGround(deposit) || crowded) { store.setHint(M.hints.depositSite, true); return false; }
    // Validate actual authored building/model footprints and quarry approach on scratch occupancy.
    // Unrelated incomplete draft fields remain editable and are checked by full Validate/Play later.
    const errors = validateMapScenario({ ...world, scenario: toValidationScenario(world, deposits) })
      .filter(error => error === "Invalid scenario definition" || error.startsWith(`Marble ${deposit.id + 1}:`));
    if (errors.length) { store.setHint(M.hints.depositInvalid, true); return false; }
    return true;
  };
  const validMaterial = (material: string) => {
    const refusal = getMaterialRefusal(world, material);
    if (refusal) store.setHint(refusal, true);
    return refusal === null;
  };
  /** Replaces the selected deposit when its site stays valid (an exhausted source respawns there too). */
  const changeSelected = (change: (deposit: MarbleDeposit) => MarbleDeposit) => {
    const deposit = selected();
    if (!deposit) { store.setHint(M.hints.chooseDeposit, true); return false; }
    const changed = change(deposit);
    const deposits = getAuthoredDeposits(world).map(other => other.id === deposit.id ? changed : other);
    if (!validSite(changed, deposits)) return false;
    mutate(deposits);
    return true;
  };
  /** Select type, then click the map: picking a material arms placement, picking it again puts it away. */
  const pick = (material: string) => {
    const index = MARBLE_MATERIALS.findIndex(row => row.value === material);
    if (index < 0 || !validMaterial(material)) return;
    section.update({ material });
    store.toggleTool("marble", index);
    if (store.getState().tool) store.setHint(M.hints.depositClick);
  };
  const applyQuantity = () => {
    if (!section.reportValidity("quantity")) return;
    if (changeSelected(deposit => ({ ...deposit, remaining: section.valueAsNumber("quantity") })))
      store.setHint(M.hints.depositAmountSet);
  };
  const applyMaterial = () => {
    if (!validMaterial(section.get().material)) return;
    if (changeSelected(deposit => ({ ...deposit, material: section.get().material as ColonyStone })))
      store.setHint(M.hints.depositMaterialSet);
  };
  const move = () => {
    if (!section.reportValidity("x", "z")) return;
    const moved = changeSelected(deposit => ({ ...deposit, x: Math.floor(section.valueAsNumber("x")) + .5,
      z: Math.floor(section.valueAsNumber("z")) + .5 }));
    if (moved) store.setHint(M.hints.depositMoved);
  };
  const remove = () => {
    const deposit = selected();
    if (!deposit) { store.setHint(M.hints.chooseDeposit, true); return; }
    mutate(getAuthoredDeposits(world).filter(other => other.id !== deposit.id));
    store.setHint(M.hints.depositRemoved);
  };
  history.subscribe(render); render();
  const stamp = (point: { x: number; z: number }) => {
    const deposits = getAuthoredDeposits(world);
    if (deposits.length >= MAX_MARBLE_DEPOSITS) {
      store.setHint(editorMessage(M.hints.depositLimit, { count: MAX_MARBLE_DEPOSITS }), true);
      return;
    }
    if (!section.reportValidity("quantity") || !validMaterial(section.get().material)) return;
    const id = Array.from({ length: MAX_MARBLE_DEPOSITS }, (_, index) => index)
      .find(candidate => !deposits.some(deposit => deposit.id === candidate))!;
    const deposit: MarbleDeposit = { id, material: section.get().material as ColonyStone, x: Math.floor(point.x) + .5,
      z: Math.floor(point.z) + .5, remaining: section.valueAsNumber("quantity") };
    const next = [...deposits, deposit];
    if (!validSite(deposit, next)) return;
    mutate(next); section.update({ selected: String(id) }); showSelected();
    store.setHint(editorMessage(M.hints.depositPlaced, {
      material: stoneLabel(deposit.material!),
      minutes: RESPAWN_MINUTES,
      remaining: deposit.remaining
    }));
  };
  return {
    applyMaterial, applyQuantity,
    limits: { x: world.cellsX - 1.01, z: world.cellsZ - 1.01 },
    move, pick, remove, section,
    select: (selected: string) => { section.update({ selected }); showSelected(); },
    stamp
  };
};

export type MarbleEditor = ReturnType<typeof createMarbleEditor>;

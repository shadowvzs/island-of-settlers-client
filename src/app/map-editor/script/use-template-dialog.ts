import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { scriptableFactionAi } from "../../../shared/world/scenario-faction-ai-script";
import { catalogTabs, familyTree } from "./catalog-options";
import { PLAYER_SLOTS_OFFERED } from "./constants";
import { playerNumber } from "./describe";
import { SCRIPT_MESSAGES as M } from "./messages";
import type { ScriptWorkspace } from "./script-workspace";
import { templateLabels } from "./template-labels";
import { CAPTURE_GOALS, type CaptureGoal } from "./template-parts";
import {
  applyTemplate, DEFAULT_TEMPLATE_PARAMS, TEMPLATE_PARAMS, type TemplateId, type TemplateParam, TEMPLATES,
  templatesFor
} from "./templates";
import { useWorkspaceState } from "./use-script-workspace";
import { scriptMapKind } from "./validation";

type Params = typeof DEFAULT_TEMPLATE_PARAMS;

/** Huntable families the kill counter offers (the animalKilled victim slot's catalog filter). */
const HUNTED_FILTER = { kinds: ["animal", "critter"] as const, mode: "action" as const, requires: "hunted",
  tag: "huntable" };
const WARE_FILTER = { kinds: ["ware"] as const, mode: "query" as const, requires: null };
/** Buildings a construction can finish (the constructionCompleted building slot's catalog filter). */
const BUILDING_FILTER = { kinds: ["building"] as const, mode: "event" as const, requires: "construct" };
const DEFAULT_NATION = "roman";
const COMPUTER_SLOTS = Array.from({ length: PLAYER_SLOTS_OFFERED - 1 }, (_, index) => index + 1);

/** The computer factions an enemy AI template may steer: the map's own, else every computer slot. */
const computerFactions = (workspace: ScriptWorkspace) => {
  const onMap = scriptableFactionAi(workspace.world.scenario).map(entry => entry.faction);
  return onMap.length > 0 ? onMap : COMPUTER_SLOTS;
};

/** The template dialog (design §13.7): the map kind's templates, their few parameters, and the insert. */
export const useTemplateDialog = (workspace: ScriptWorkspace, onClose: () => void) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const ids = templatesFor(scriptMapKind(workspace.world));
  const [selected, setSelected] = useState<TemplateId>(ids[0] ?? "killCounter");
  const factions = useMemo(() => computerFactions(workspace), [workspace]);
  const [params, setParams] = useState<Params>({ ...DEFAULT_TEMPLATE_PARAMS, faction: factions[0]! });
  const { locale } = i18n;
  const families = useMemo(() => familyTree({ ...HUNTED_FILTER, mode: "event" }, { i18n, locale }), [i18n, locale]);
  const wares = useMemo(() => catalogTabs(WARE_FILTER, { i18n, locale }, DEFAULT_NATION)
    .flatMap(tab => tab.options), [i18n, locale]);
  const buildings = useMemo(() => catalogTabs(BUILDING_FILTER, { i18n, locale }, DEFAULT_NATION)
    .flatMap(tab => tab.options), [i18n, locale]);
  const name = (id: TemplateId) => translateMessage(i18n, M.templates[id].name);
  const insert = () => {
    const result = applyTemplate(state.script, selected, { ...params, labels: templateLabels(i18n, name(selected)),
      mapCenter: workspace.mapCenter() });
    if (!workspace.commit(result.script, { selectedTriggerId: result.firstTrigger })) return;
    workspace.setNotice(translateMessage(i18n, M.templates.inserted, { name: name(selected) }));
    onClose();
  };
  const number = (field: "count" | "seconds") => (text: string) => {
    const value = Math.round(Number(text));
    if (Number.isFinite(value) && value > 0) setParams(current => ({ ...current, [field]: value }));
  };
  return {
    boardLabel: translateMessage(i18n, M.templates.board),
    buildingLabel: translateMessage(i18n, M.picker.catalogTab.buildings),
    buildings: buildings.map(option => ({ key: option.entry.key, label: option.label })),
    cancelLabel: translateMessage(i18n, M.templates.cancel),
    countLabel: translateMessage(i18n, M.templates.count),
    factionLabel: translateMessage(i18n, M.templates.faction),
    factions: factions.map(faction =>
      ({ key: faction, label: translateMessage(i18n, M.players.slot, { number: playerNumber(faction) }) })),
    families: families.map(node => ({ key: node.path, label: `${node.label} (${node.members})` })),
    familyLabel: translateMessage(i18n, M.picker.tabFamily),
    goalLabel: translateMessage(i18n, M.templates.goal),
    goals: CAPTURE_GOALS.map(goal => ({ key: goal, label: translateMessage(i18n, M.templates.goals[goal]) })),
    insertLabel: translateMessage(i18n, M.templates.insert),
    newRegionLabel: translateMessage(i18n, M.templates.newRegion),
    params,
    regionLabel: translateMessage(i18n, M.actors.place),
    regions: state.script.regions.map(region => ({ key: region.id, label: region.name })),
    secondsLabel: translateMessage(i18n, M.templates.seconds),
    selected,
    show: Object.fromEntries(TEMPLATE_PARAMS.map(param => [param, TEMPLATES[selected].params.includes(param)])) as
      Record<TemplateParam, boolean>,
    templates: ids.map(id => ({ description: translateMessage(i18n, M.templates[id].description), id, name: name(id),
      selected: id === selected })),
    title: translateMessage(i18n, M.templates.title),
    wareLabel: translateMessage(i18n, M.picker.catalogTab.wares),
    wares: wares.map(option => ({ key: option.entry.key, label: option.label })),
    onBoard: (board: boolean) => setParams(current => ({ ...current, board })),
    onBuilding: (building: string) => setParams(current => ({ ...current, building })),
    onClose,
    onCount: number("count"),
    onFaction: (faction: string) => setParams(current => ({ ...current, faction: Number(faction) })),
    onFamily: (family: string) => setParams(current => ({ ...current, family })),
    onGoal: (goal: string) => setParams(current => ({ ...current, goal: goal as CaptureGoal })),
    onInsert: insert,
    onRegion: (region: string) => setParams(current => ({ ...current, region: region || null })),
    onSeconds: number("seconds"),
    onSelect: setSelected,
    onWare: (ware: string) => setParams(current => ({ ...current, ware }))
  };
};

export type TemplateDialogView = ReturnType<typeof useTemplateDialog>;

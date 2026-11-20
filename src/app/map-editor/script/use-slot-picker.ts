import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import type { PlayerFilter } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import { translateMessage } from "../../../shared/i18n/translate";
import { addPlacedActor } from "./actors";
import { SCRIPT_MESSAGES as M } from "./messages";
import { tabChoices, tabLabel } from "./picker-choices";
import { playerChoices, refChoices } from "./picker-options";
import type { ScriptWorkspace } from "./script-workspace";
import {
  initialPickerTab, type PickerTabId, pickerTabs, type SelectorFilters, selectorFilters, withSelectorFilters
} from "./slot-picker-model";
import type { PickerRequest } from "./use-script-dialogs";
import { useDescribeContext, useWorkspaceState } from "./use-script-workspace";

const isEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * The slot picker's view model (design §13.3): tabs of the slot type, list choices of the active tab, the owner
 * and region filters of type/family selectors outside an event subject, pick on map and the final choice.
 */
export const useSlotPicker = (workspace: ScriptWorkspace, request: PickerRequest, onClose: () => void) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const context = useDescribeContext(state);
  const { spec } = request;
  const tabs = pickerTabs(spec);
  const [tab, setTab] = useState<PickerTabId>(() => initialPickerTab(spec, request.value));
  const [filters, setFilters] = useState<SelectorFilters>(() => selectorFilters(request.value));
  const choices = useMemo(() => tabChoices(tab, spec, context), [tab, spec, context]);
  const choose = (value: unknown) => {
    request.apply(value);
    onClose();
  };
  const filtered = spec.kind === "actor" && !spec.subject && (tab === "type" || tab === "family");
  const pickObject = () => {
    onClose();
    workspace.beginPick("object", result => {
      if (!("objectId" in result)) return;
      const script = workspace.getSnapshot().script;
      const bound = script.actors.find(actor => actor.binding === "placed" &&
        actor.objects.some(object => object.objectId === result.objectId));
      if (bound) { request.apply({ actor: { id: bound.id, k: "ref", kind: "actor" }, kind: "instance" }); return; }
      const name = translateMessage(i18n, M.actors.newName, { number: script.actors.length + 1 });
      const added = addPlacedActor(script, workspace.world, result.objectId, name);
      if (!added) return;
      if (workspace.commit(added.script)) request.apply({ actor: { id: added.actor.id, k: "ref", kind: "actor" },
        kind: "instance" });
    });
  };
  const pickRegion = () => {
    onClose();
    workspace.beginPick("region", result => {
      if ("regionId" in result) request.apply({ id: result.regionId, k: "ref", kind: "region" });
    });
  };
  const regionSlot = (spec.kind === "ref" && spec.ref === "region") || spec.kind === "regionOrEdge" ||
    (spec.kind === "value" && spec.type === "region");
  return {
    cancelLabel: translateMessage(i18n, M.picker.cancel),
    chooseLabel: translateMessage(i18n, M.picker.choose),
    choices: choices.map(choice => ({ ...choice, selected: isEqual(choice.value, request.value) })),
    clearLabel: translateMessage(i18n, M.picker.clear),
    filtered,
    filters,
    nothingLabel: translateMessage(i18n, M.picker.nothingHere),
    optional: request.optional,
    ownerChoices: playerChoices(false, context).map(choice => ({ ...choice,
      selected: isEqual(choice.value, filters.owner) })),
    ownerLabel: translateMessage(i18n, M.picker.owner),
    pickObject: spec.kind === "actor" && tab === "instance",
    pickObjectLabel: translateMessage(i18n, M.picker.pickOnMap),
    pickRegion: regionSlot && tab === "list",
    regionChoices: refChoices("region", context),
    regionFilterLabel: translateMessage(i18n, M.picker.region),
    noRegionLabel: translateMessage(i18n, M.picker.noRegion),
    spec,
    tab,
    tabs: tabs.map(id => ({ id, label: tabLabel(id, i18n), selected: id === tab })),
    tabsLabel: translateMessage(i18n, M.picker.kinds),
    title: request.label,
    value: request.value,
    withFilters: (selector: Parameters<typeof withSelectorFilters>[0]) => withSelectorFilters(selector, spec, filters),
    onChoose: choose,
    onClear: () => choose(undefined),
    onClose,
    onOwner: (key: string) => setFilters(current => ({ ...current, owner: JSON.parse(key) as PlayerFilter })),
    onPickObject: pickObject,
    onPickRegion: pickRegion,
    onRegion: (region: string) => setFilters(current => ({ ...current, region: region || null })),
    onTab: setTab
  };
};

export type SlotPickerView = ReturnType<typeof useSlotPicker>;

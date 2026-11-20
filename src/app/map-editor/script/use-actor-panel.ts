import { useLingui } from "@lingui/react";

import { SCRIPT_LIMITS } from "../../../../../island-of-settlers-shared/src/script/constants";
import type { ActorOwner, ScriptActor } from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import { translateMessage } from "../../../shared/i18n/translate";
import { placedObjectFacts } from "../../../shared/world/placed-object-fingerprint";
import {
  actorUsers, addObjectToActor, addPlacedActor, addRegionAt, addSpawnActor, editedDisplayName, removeActor,
  removeObjectFromActor, replaceActor, withDisplayName
} from "./actors";
import { catalogNations, contentName } from "./catalog-options";
import { PLAYER_SLOTS_OFFERED } from "./constants";
import { describeActorType, describeLook } from "./describe";
import { SCRIPT_MESSAGES as M } from "./messages";
import type { ScriptWorkspace } from "./script-workspace";
import { lookValues } from "./slot-picker-model";
import type { ScriptDialogs } from "./use-script-dialogs";
import { useDescribeContext, useIssueIndex, useWorkspaceState } from "./use-script-workspace";
import { describeUsers } from "./users";
import { actorIssues } from "./validation";

const ownerKey = (owner: ActorOwner) => (owner.kind === "neutral" ? "neutral" : String(owner.faction));
const ownerOf = (key: string): ActorOwner => (key === "neutral" ? { kind: "neutral" }
  : { faction: Number(key), kind: "slot" });

/** The actor panel (ACT9): actor cards with their binding, fields, users and issues, and the add/pick commands. */
export const useActorPanel = (workspace: ScriptWorkspace, dialogs: ScriptDialogs) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(workspace);
  const context = useDescribeContext(state);
  const issues = useIssueIndex(state);
  const { script } = state;
  const text = (descriptor: Parameters<typeof translateMessage>[1], values?: Record<string, string | number>) =>
    translateMessage(i18n, descriptor, values);
  const update = (actor: ScriptActor) => workspace.commit(replaceActor(workspace.getSnapshot().script, actor));
  const newName = () => text(M.actors.newName, { number: script.actors.length + 1 });
  const regionName = (number: number) => text(M.picker.regionName, { number });
  const addSpawn = () => {
    let next = script;
    let region = next.regions[0]?.id;
    if (!region) {
      const made = addRegionAt(next, workspace.mapCenter(), regionName);
      next = made.script;
      region = made.region.id;
    }
    const { actor, script: withActor } = addSpawnActor(next, newName(), region);
    workspace.commit(withActor, { selectedActorId: actor.id });
  };
  const bindPlaced = () => workspace.beginPick("object", result => {
    if (!("objectId" in result)) return;
    const added = addPlacedActor(workspace.getSnapshot().script, workspace.world, result.objectId, newName());
    if (added) workspace.commit(added.script, { selectedActorId: added.actor.id });
  });
  const addObject = (actor: ScriptActor) => workspace.beginPick("object", result => {
    if (!("objectId" in result)) return;
    const outcome = addObjectToActor(actor, workspace.world, result.objectId);
    if (outcome.kind === "added") update(outcome.actor);
    else workspace.setNotice(text(M.actors.otherContent, { id: result.objectId }), true);
  });
  const objectName = (objectId: number) => {
    const facts = placedObjectFacts(workspace.world, objectId);
    return facts ? contentName(i18n, facts.content) : "?";
  };
  const cards = script.actors.map((actor, index) => {
    const users = actorUsers(script, actor.id);
    const summary = actor.binding === "placed" ? text(M.actors.placed, { count: actor.objects.length })
      : text(M.actors.spawned, { count: actor.count, type: describeActorType(actor.type, context) });
    return {
      actor, clearOnGone: actor.lifetime === "clearOnGone", deleteLabel: text(M.actors.delete, { name: actor.name }),
      displayName: editedDisplayName(actor), id: actor.id, issues: actorIssues(issues, index),
      objects: actor.binding === "placed" ? actor.objects.map(object => ({ id: object.objectId,
        label: text(M.actors.object, { id: object.objectId, name: objectName(object.objectId) }),
        removeLabel: text(M.actors.removeObject, { id: object.objectId }) })) : [],
      owner: ownerKey(actor.owner), selected: actor.id === state.selectedActorId, summary,
      typeText: actor.binding === "spawn" ? describeActorType(actor.type, context) : "",
      usedBy: users.length ? text(M.actors.usedBy, { users: describeUsers(users, context) })
        : text(M.actors.unused)
    };
  });
  const owners = [...Array.from({ length: PLAYER_SLOTS_OFFERED }, (_, faction) => ({ key: String(faction),
    label: text(M.players.slot, { number: faction + 1 }) })), { key: "neutral", label: text(M.actors.neutral) }];
  const looks = lookValues(catalogNations(i18n).map(nation => nation.key))
    .map(look => ({ key: JSON.stringify(look), label: describeLook(look, context), look }));
  return {
    cards,
    looks,
    owners,
    displayNameLength: SCRIPT_LIMITS.actorDisplayNameLength,
    regions: script.regions.map(region => ({ key: region.id, label: region.name })),
    labels: {
      addObject: text(M.actors.addObject), addSpawn: text(M.actors.addSpawn), bindPlaced: text(M.actors.bindPlaced),
      clearOnGone: text(M.actors.clearOnGone), count: text(M.actors.count),
      displayName: text(M.actors.displayName), empty: text(M.actors.empty),
      hiddenAtStart: text(M.actors.hiddenAtStart), info: text(M.actors.info), look: text(M.actors.look),
      name: text(M.actors.name), owner: text(M.actors.owner), place: text(M.actors.place),
      pickRegion: text(M.picker.pickOnMap), spawnAtStart: text(M.actors.spawnAtStart), title: text(M.actors.title),
      type: text(M.actors.type)
    },
    onAddObject: addObject,
    onAddSpawn: addSpawn,
    onBindPlaced: bindPlaced,
    onDelete: (actor: ScriptActor) => {
      const result = removeActor(workspace.getSnapshot().script, actor.id);
      if (result.removed) workspace.commit(result.script);
      else workspace.setNotice(text(M.form.deleteRefused, { users: describeUsers(result.users, context) }),
        true);
    },
    onClearOnGone: (actor: ScriptActor, on: boolean) =>
      update({ ...actor, lifetime: on ? "clearOnGone" : "keepIncarnation" }),
    onCount: (actor: ScriptActor, value: string) => {
      const count = Math.round(Number(value));
      if (actor.binding === "spawn" && Number.isFinite(count) && count >= 1) update({ ...actor, count });
    },
    onDisplayName: (actor: ScriptActor, name: QuestText) => update(withDisplayName(actor, name)),
    onField: (actor: ScriptActor, change: Partial<ScriptActor>) => update({ ...actor, ...change } as ScriptActor),
    onOwner: (actor: ScriptActor, key: string) => update({ ...actor, owner: ownerOf(key) }),
    onLook: (actor: ScriptActor, key: string) => update({ ...actor, look: JSON.parse(key) } as ScriptActor),
    onPickRegion: (actor: ScriptActor) => workspace.beginPick("region", result => {
      const current = workspace.getSnapshot().script.actors.find(item => item.id === actor.id);
      if ("regionId" in result && current?.binding === "spawn")
        update({ ...current, place: { ...current.place, region: { id: result.regionId, k: "ref", kind: "region" } } });
    }),
    onRegion: (actor: ScriptActor, region: string) => {
      if (actor.binding === "spawn" && region) update({ ...actor, place: { ...actor.place,
        region: { id: region, k: "ref", kind: "region" } } });
    },
    onRemoveObject: (actor: ScriptActor, objectId: number) => update(removeObjectFromActor(actor, objectId)),
    onType: (actor: ScriptActor) => {
      if (actor.binding !== "spawn") return;
      dialogs.openPicker({ label: text(M.picker.title, { slot: text(M.actors.type) }), optional: false,
        spec: { kind: "actorType", mode: "action", requires: "spawn" }, value: actor.type,
        apply: value => {
          const current = workspace.getSnapshot().script.actors.find(item => item.id === actor.id);
          if (current?.binding === "spawn" && value) update({ ...current, type: value as typeof current.type });
        } });
    }
  };
};

export type ActorPanelView = ReturnType<typeof useActorPanel>;

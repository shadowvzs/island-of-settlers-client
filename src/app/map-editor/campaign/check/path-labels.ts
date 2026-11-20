import type { I18n } from "@lingui/core";

import type { Campaign, CampaignMap } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { MapScript } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import { translateMessage } from "../../../../shared/i18n/translate";
import { ISSUE_OWNER_TABS } from "../../script/constants";
import type { ScriptDeepLink } from "../../script/deep-link";
import { issueSubject, ownerOf } from "../../script/issue-paths";
import { type NodePath, parseIssuePath } from "../../script/paths";
import { slotLabel } from "../../script/sentences";
import { CHECK_PATH_SEPARATOR } from "../constants";
import { displayText } from "../helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { exitName } from "../paths/helpers";
import { CAMPAIGN_PATH_MESSAGES } from "../paths/messages";

/**
 * Readable names for validation issue paths (CUX-PATHS): `triggers[1].conditions.of[0].a.variable` reads
 * `Trigger "Intro" › first value` and `speakers[0].name` reads `Speaker "Advisor" › name`. Slot words come from the
 * script editor's table (TRG11); the raw path stays available for the tooltip.
 */

type PathOwnerKind = keyof typeof M.check.path;
type ScriptOwnerKind = "actor" | "homeReward" | "quest" | "trigger" | "variable";

/** The editor names (and ids, for deep links) of a map script's top-level items, by list index. */
export interface ScriptPathNames {
  actor: readonly string[];
  /** Item ids by owner kind and list index; absent in reports made without the map file. */
  ids?: Readonly<Record<ScriptOwnerKind, readonly string[]>>;
  homeReward: readonly string[];
  quest: readonly string[];
  trigger: readonly string[];
  variable: readonly string[];
}

const idsOf = (items: readonly { id: string }[]) => items.map(item => item.id);

export const scriptPathNames = (script: MapScript): ScriptPathNames => ({
  actor: script.actors.map(actor => actor.name),
  ids: {
    actor: idsOf(script.actors), homeReward: idsOf(script.homeRewards), quest: idsOf(script.quests.quests),
    trigger: idsOf(script.triggers), variable: idsOf(script.variables)
  },
  homeReward: script.homeRewards.map(reward => reward.name),
  quest: script.quests.quests.map(quest => quest.id),
  trigger: script.triggers.map(trigger => trigger.name),
  variable: script.variables.map(variable => variable.name)
});

export interface PathLabelContext {
  campaign: Campaign;
  i18n: I18n | undefined;
  language: string;
  mapNames: ReadonlyMap<string, string>;
  /** The working maps, for exit names in edge labels (ids are shown without them). */
  maps?: readonly CampaignMap[];
}

const joinParts = (parts: readonly string[]) => parts.filter(Boolean).join(CHECK_PATH_SEPARATOR);

/** Field words of a path without a named owner: list positions are 1-based ("goods 1 › ware"). */
export const fieldPathLabel = (path: NodePath, locale: string) => {
  const parts: string[] = [];
  for (const key of path) {
    const position = typeof key === "number" ? String(key + 1) : "";
    if (position && parts.length > 0) parts[parts.length - 1] += ` ${position}`;
    else parts.push(position || slotLabel(String(key), locale));
  }
  return joinParts(parts);
};

const ownerLabel = (kind: PathOwnerKind, name: string | undefined, index: number, i18n: I18n | undefined) =>
  translateMessage(i18n, M.check.path[kind], { name: name?.trim() || String(index + 1) });

/** A map script issue path: the owning trigger, quest, variable, actor or home reward by name, then the slot word. */
export const scriptPathLabel = (
  path: string, names: ScriptPathNames | undefined, context: Pick<PathLabelContext, "i18n" | "language">
) => {
  const fullPath = parseIssuePath(path);
  const { depth, owner } = ownerOf(fullPath);
  if (depth === 0) return fieldPathLabel(fullPath, context.language);
  const [kind, position] = owner.split(":") as [ScriptOwnerKind, string];
  const index = Number(position);
  return joinParts([
    ownerLabel(kind, names?.[kind][index], index, context.i18n),
    issueSubject(fullPath.slice(depth), context.language)
  ]);
};

/** The Script window deep link of a script issue path: the owner's tab and id, and the field path inside it. */
export const scriptIssueLink = (path: string, names: ScriptPathNames | undefined): ScriptDeepLink | null => {
  const fullPath = parseIssuePath(path);
  const { depth, owner } = ownerOf(fullPath);
  const [kind, position] = owner.split(":") as [ScriptOwnerKind, string];
  const tab = ISSUE_OWNER_TABS[kind];
  if (!tab) return null;
  const itemId = names?.ids?.[kind][Number(position)];
  const inner = path.split(/(?=[.[])/).slice(depth).join("").replace(/^\./, "");
  return { tab, ...(itemId ? { itemId } : {}), ...(inner ? { path: inner } : {}) };
};

/** A map record's named list item: a quest or a named exit (BR3). */
const mapOwnerLabel = (list: unknown, index: number, map: CampaignMap, context: PathLabelContext) => {
  if (list === "quests") return ownerLabel("quest", map.quests[index]?.id, index, context.i18n);
  const exit = list === "exits" ? map.exits?.[index] : undefined;
  return exit ? ownerLabel("exit", displayText(exit.name, context.language, exit.id), index, context.i18n) : "";
};

const mapName = (mapId: string | undefined, context: PathLabelContext) =>
  mapId && (context.mapNames.get(mapId) ?? mapId);

/** A campaign edge as "<from map>: <exit> → <target>" (BR3). */
const edgeName = (index: number, context: PathLabelContext) => {
  const edge = context.campaign.edges?.[index];
  if (!edge) return undefined;
  const end = translateMessage(context.i18n, CAMPAIGN_PATH_MESSAGES.campaignEnds);
  const from = context.maps?.find(map => map.id === edge.from);
  const exit = from ? exitName(from, edge.exit, context.language) : edge.exit;
  return `${mapName(edge.from, context)}: ${exit} → ${mapName(edge.to ?? undefined, context) || end}`;
};

/** The named owner of a record path's first list item: a speaker, a listed or start map, an edge, a map's item. */
const recordOwnerLabel = (list: unknown, index: number, map: CampaignMap | null, context: PathLabelContext) => {
  const { campaign, i18n, language } = context;
  if (map) return mapOwnerLabel(list, index, map, context);
  const speaker = campaign.speakers?.[index];
  if (list === "speakers") return ownerLabel("speaker", speaker && displayText(speaker.name, language, speaker.id),
    index, i18n);
  if (list === "edges") return ownerLabel("edge", edgeName(index, context), index, i18n);
  if (list === "startMapIds") return ownerLabel("map", mapName(campaign.startMapIds?.[index], context), index, i18n);
  return list === "mapIds" ? ownerLabel("map", mapName(campaign.mapIds[index], context), index, i18n) : "";
};

/** A campaign document (`map` null) or map record issue path. */
export const recordPathLabel = (path: string, map: CampaignMap | null, context: PathLabelContext) => {
  const fullPath = parseIssuePath(path);
  const [list, index] = fullPath;
  const owner = typeof index === "number" ? recordOwnerLabel(list, index, map, context) : "";
  if (!owner) return fieldPathLabel(fullPath, context.language);
  return joinParts([owner, fieldPathLabel(fullPath.slice(2), context.language)]);
};

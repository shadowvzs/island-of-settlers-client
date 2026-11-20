import type { Campaign, CampaignMap } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  missingTranslations, type TranslatableText
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { getAtPath, type NodePath, setAtPath } from "../script/paths";
import type { CampaignTextEdit } from "./campaign-editor-state";
import { TEXT_UNDO_LIMIT } from "./constants";
import { withTranslation } from "./helpers";

/** What a campaign text is; the translation table names its row from it. */
export type CampaignTextKind =
  | "campaignDescription" | "campaignName" | "exitName" | "mapName" | "questText" | "questTitle" | "speakerName"
  | "speakLine";

/**
 * One player-visible text of the campaign records (the campaign document or one of its maps). `id` is stable
 * across reorders (entity ids, not indexes); `path` and `issuePath` locate it in its document, the latter as the
 * Ready validators print it.
 */
export interface CampaignTextEntry {
  id: string;
  issuePath: string;
  kind: CampaignTextKind;
  /** Null: a text of the campaign document. */
  mapId: string | null;
  multiline: boolean;
  /** An empty optional text (the campaign description) needs no translation. */
  optional: boolean;
  path: NodePath;
  /** 1-based position among its siblings (speaker number, line number). */
  position: number;
  /** The quest id or sequence name a row label names; "" where the kind says it all. */
  subject: string;
  text: TranslatableText;
}

type EntryFields = Pick<CampaignTextEntry, "id" | "kind" | "path" | "text"> & Partial<CampaignTextEntry>;

/** `["quests", 2, "title"]` → `quests[2].title`, the validators' path spelling. */
export const formatIssuePath = (path: NodePath) => path.reduce<string>((text, key) => {
  if (typeof key === "number") return `${text}[${key}]`;
  return text ? `${text}.${key}` : key;
}, "");

const entry = (fields: EntryFields): CampaignTextEntry => ({
  issuePath: formatIssuePath(fields.path), mapId: null, multiline: false, optional: false, position: 1, subject: "",
  ...fields
});

const campaignDocumentTexts = (campaign: Campaign): CampaignTextEntry[] => [
  entry({ id: "campaign/name", kind: "campaignName", path: ["name"], text: campaign.name }),
  entry({ id: "campaign/description", kind: "campaignDescription", multiline: true, optional: true,
    path: ["description"], text: campaign.description }),
  ...(campaign.speakers ?? []).map((speaker, index) => entry({
    id: `campaign/speaker/${speaker.id}`, kind: "speakerName", path: ["speakers", index, "name"],
    position: index + 1, text: speaker.name
  }))
];

/** Visible quests only: a hidden quest has no log entry and no story panel. */
const questTexts = (map: CampaignMap): CampaignTextEntry[] => map.quests.flatMap((quest, index) => {
  if (quest.hidden) return [];
  const shared = { mapId: map.id, subject: quest.id };
  return [
    entry({ ...shared, id: `map/${map.id}/quest/${quest.id}/title`, kind: "questTitle",
      path: ["quests", index, "title"], text: quest.title }),
    entry({ ...shared, id: `map/${map.id}/quest/${quest.id}/text`, kind: "questText", multiline: true,
      path: ["quests", index, "text"], text: quest.text })
  ];
});

const speakTexts = (map: CampaignMap): CampaignTextEntry[] => (map.sequences ?? []).flatMap((sequence, index) =>
  sequence.steps.flatMap((step, stepIndex) => (step.kind === "speak" ? [{ step, stepIndex }] : []))
    .map(({ step, stepIndex }, lineIndex) => entry({
      id: `map/${map.id}/sequence/${sequence.id}/${step.id}`, kind: "speakLine", mapId: map.id, multiline: true,
      path: ["sequences", index, "steps", stepIndex, "text"], position: lineIndex + 1,
      subject: sequence.name || sequence.id, text: step.text
    })));

/** Named exits (BR3): shown on the completed node in the player window. */
const exitTexts = (map: CampaignMap): CampaignTextEntry[] => (map.exits ?? []).map((exit, index) => entry({
  id: `map/${map.id}/exit/${exit.id}/name`, kind: "exitName", mapId: map.id, path: ["exits", index, "name"],
  position: index + 1, subject: exit.id, text: exit.name
}));

const mapTexts = (map: CampaignMap): CampaignTextEntry[] => [
  entry({ id: `map/${map.id}/name`, kind: "mapName", mapId: map.id, path: ["name"], text: map.name }),
  ...exitTexts(map),
  ...questTexts(map),
  ...speakTexts(map)
];

/** Every translatable text of the campaign records: the campaign's first, then each map's in the given order. */
export const collectCampaignTexts = (campaign: Campaign, maps: readonly CampaignMap[]): CampaignTextEntry[] =>
  [...campaignDocumentTexts(campaign), ...maps.flatMap(mapTexts)];

/** Languages of `languages` the text still lacks (shared rule; an empty optional text lacks none). */
export const missingTextLanguages = (text: CampaignTextEntry, languages: readonly string[]) => {
  if (text.optional && !text.text.en.trim()) return [];
  return missingTranslations(text.text, languages);
};

/** The document (campaign or map) with one language of the text at `path` replaced. */
export const withTextValue = <T extends Campaign | CampaignMap>(
  document: T, path: NodePath, language: string, value: string
): T => {
  const text = getAtPath(document, path) as TranslatableText | undefined;
  return text ? setAtPath(document, path, withTranslation(text, language, value)) : document;
};

/**
 * The undo stack with an edit recorded. Consecutive edits of one cell are one step (typing a word is undone at
 * once, back to the value before it); the stack keeps the newest TEXT_UNDO_LIMIT steps.
 */
export const recordTextEdit = (edits: readonly CampaignTextEdit[], edit: CampaignTextEdit) => {
  const last = edits.at(-1);
  if (last && last.textId === edit.textId && last.language === edit.language) return edits;
  return [...edits, edit].slice(-TEXT_UNDO_LIMIT);
};

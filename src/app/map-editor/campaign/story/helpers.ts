import type { CampaignMap } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignQuest } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-quest";
import {
  createTranslatableText, type TranslatableText
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import type { StoryPanelContent } from "../../../campaign/story-panel/types";
import { STORY_QUEST_ID, STORY_TRIGGER, type StoryKind } from "../constants";

export type { StoryKind } from "../constants";

/** The editable story fields; the rest of the quest keeps the C1 defaults of a pure story message. */
export interface StoryFields {
  imageId: string | null;
  text: TranslatableText;
  title: TranslatableText;
}

/** The map's first visible story quest of the kind (`mapStart` intro, `victory` epilogue), or null. */
export const storyQuestOf = (map: CampaignMap, kind: StoryKind) =>
  map.quests.find(quest => quest.trigger.kind === STORY_TRIGGER[kind] && !quest.hidden) ?? null;

/** The story fields of a kind; empty texts while the map has no such quest yet. */
export const storyFieldsOf = (map: CampaignMap, kind: StoryKind): StoryFields => {
  const quest = storyQuestOf(map, kind);
  if (!quest) return { imageId: null, text: createTranslatableText(), title: createTranslatableText() };
  return { imageId: quest.imageId, text: quest.text, title: quest.title };
};

/** A pure story message quest (no rewards, no effects, runs once). */
const createStoryQuest = (map: CampaignMap, kind: StoryKind): CampaignQuest => {
  const taken = new Set(map.quests.map(quest => quest.id));
  let id = STORY_QUEST_ID[kind];
  for (let suffix = 2; taken.has(id); suffix++) id = `${STORY_QUEST_ID[kind]}-${suffix}`;
  return {
    claimEffects: [], highlightRegion: false, homeReward: null, id, imageId: null, mapReward: null,
    prerequisites: [], repeat: "once", text: createTranslatableText(), timeLimitSeconds: null,
    title: createTranslatableText(), trigger: { kind: STORY_TRIGGER[kind] }
  };
};

/** The map with the story fields of a kind changed; the quest is created on the first edit. */
export const withStoryFields = (map: CampaignMap, kind: StoryKind, change: Partial<StoryFields>): CampaignMap => {
  const existing = storyQuestOf(map, kind);
  const quest = { ...(existing ?? createStoryQuest(map, kind)), ...change };
  if (!existing) return { ...map, quests: [...map.quests, quest] };
  return { ...map, quests: map.quests.map(entry => entry === existing ? quest : entry) };
};

/**
 * What the Preview shows: the real C11a story panel on one page, as a replay (skippable) intro, or a victory
 * epilogue whose claim strip shows the map's reward table as granted.
 */
export const storyPreviewContent = (map: CampaignMap, kind: StoryKind): StoryPanelContent => {
  const { imageId, text, title } = storyFieldsOf(map, kind);
  const pages = [{ imageId, text, title }];
  if (kind === "intro") return { kind: "intro", pages, replay: true };
  return { claim: { rewards: map.rewards, status: "granted" }, kind: "epilogue", outcome: "victory", pages,
    replay: true };
};

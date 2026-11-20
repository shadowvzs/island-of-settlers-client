import type { Campaign } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { createTranslatableText } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import type {
  CINEMATIC_SPEAKER_SIDES
} from "../../../../../../island-of-settlers-shared/src/campaign/cinematics/constants";
import type {
  CampaignSpeaker, CinematicSpeakerExpression
} from "../../../../../../island-of-settlers-shared/src/campaign/cinematics/types";

export type SpeakerSide = (typeof CINEMATIC_SPEAKER_SIDES)[number];

const speakersOf = (campaign: Campaign) => campaign.speakers ?? [];

/** A new speaker; `portraitId` fills the required neutral portrait (a speaker cannot exist without one). */
export const withSpeakerAdded = (campaign: Campaign, id: string, portraitId: string): Campaign => ({
  ...campaign,
  speakers: [...speakersOf(campaign), { id, name: createTranslatableText(), portraits: { neutral: portraitId } }]
});

export const withSpeaker = (
  campaign: Campaign, id: string, change: (speaker: CampaignSpeaker) => CampaignSpeaker
): Campaign => ({
  ...campaign, speakers: speakersOf(campaign).map(speaker => speaker.id === id ? change(speaker) : speaker)
});

export const withSpeakerRemoved = (campaign: Campaign, id: string): Campaign =>
  ({ ...campaign, speakers: speakersOf(campaign).filter(speaker => speaker.id !== id) });

/** The speaker with one portrait set; clearing `neutral` is refused (it is the required fallback). */
export const withPortrait = (
  speaker: CampaignSpeaker, expression: CinematicSpeakerExpression, imageId: string | null
): CampaignSpeaker => {
  if (expression === "neutral") return imageId ? { ...speaker, portraits: { ...speaker.portraits, neutral: imageId } }
    : speaker;
  const portraits: CampaignSpeaker["portraits"] = { ...speaker.portraits };
  if (imageId) portraits[expression] = imageId;
  else delete portraits[expression];
  return { ...speaker, portraits };
};

/** The panel side, left by default (CIN1). */
export const speakerSide = (speaker: CampaignSpeaker): SpeakerSide => speaker.side ?? "left";

/** A side from a select value (anything but "right" is the default left). */
export const toSpeakerSide = (value: string): SpeakerSide => value === "right" ? "right" : "left";

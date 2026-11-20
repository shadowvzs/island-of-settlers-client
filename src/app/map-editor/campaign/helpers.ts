import type { Campaign, CampaignMap } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  resolveTranslatableText, type TranslatableText
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { DAY_MS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { type ScriptDeepLink, withScriptDeepLink } from "../script/deep-link";
import {
  CAMPAIGN_EDITOR_MODE, CAMPAIGN_ID_PARAM, CAMPAIGN_MAP_ID_PARAM, CAMPAIGN_SLOT_PARAM, CAMPAIGN_SLOT_PREFIX,
  EDITOR_MODE_PARAM, ID_RANDOM_LENGTH, ID_TIME_RADIX, ISO_DATE_LENGTH
} from "./constants";

/** A new record id `<prefix>-<time>-<random>`: identifier-safe, unique per browser without a server round trip. */
export const createRecordId = (prefix: string, now: number, random: number) => {
  const time = now.toString(ID_TIME_RADIX);
  const suffix = Math.floor(random * ID_TIME_RADIX ** ID_RANDOM_LENGTH).toString(ID_TIME_RADIX)
    .padStart(ID_RANDOM_LENGTH, "0");
  return `${prefix}-${time}-${suffix}`;
};

/** The `island-maps` slot holding a campaign map's file (never World01, plan item 41). */
export const campaignMapSlotId = (campaignId: string, mapId: string) =>
  `${CAMPAIGN_SLOT_PREFIX}${campaignId}/${mapId}`;

export const isCampaignMapSlot = (slotId: string) => slotId.startsWith(CAMPAIGN_SLOT_PREFIX);

/** The campaign and map of a campaign slot id, or null for any other slot. */
export const parseCampaignMapSlot = (slotId: string | null) => {
  if (!slotId || !isCampaignMapSlot(slotId)) return null;
  const [campaignId, mapId, ...rest] = slotId.slice(CAMPAIGN_SLOT_PREFIX.length).split("/");
  if (!campaignId || !mapId || rest.length) return null;
  return { campaignId, mapId, slotId };
};

export type CampaignMapSlot = NonNullable<ReturnType<typeof parseCampaignMapSlot>>;

/** True when `editor.html` should open the campaign editor. */
export const isCampaignEditorMode = (search: string) =>
  new URLSearchParams(search).get(EDITOR_MODE_PARAM) === CAMPAIGN_EDITOR_MODE;

/** The campaign map slot the map editor was opened with (`?campaignSlot=`), or null. */
export const readCampaignSlotParam = (search: string) =>
  parseCampaignMapSlot(new URLSearchParams(search).get(CAMPAIGN_SLOT_PARAM));

/** The campaign and map the campaign editor selects on open. */
export const readCampaignSelection = (search: string) => {
  const query = new URLSearchParams(search);
  return { campaignId: query.get(CAMPAIGN_ID_PARAM), mapId: query.get(CAMPAIGN_MAP_ID_PARAM) };
};

/** `editor.html` in campaign mode, selecting the campaign (and map) again. */
export const campaignEditorUrl = (pageUrl: string, campaignId: string | null, mapId: string | null = null) => {
  const url = new URL(pageUrl);
  url.search = "";
  url.searchParams.set(EDITOR_MODE_PARAM, CAMPAIGN_EDITOR_MODE);
  if (campaignId) url.searchParams.set(CAMPAIGN_ID_PARAM, campaignId);
  if (campaignId && mapId) url.searchParams.set(CAMPAIGN_MAP_ID_PARAM, mapId);
  return url.href;
};

/** `editor.html` as the 3D map editor on a campaign map's slot ("Open map"), optionally at a Script window item. */
export const campaignMapEditorUrl = (
  pageUrl: string, campaignId: string, mapId: string, scriptLink?: ScriptDeepLink
) => {
  const url = new URL(pageUrl);
  url.search = "";
  url.searchParams.set(CAMPAIGN_SLOT_PARAM, campaignMapSlotId(campaignId, mapId));
  return scriptLink ? withScriptDeepLink(url.href, scriptLink) : url.href;
};

/** The plain map editor (no campaign). */
export const mapEditorUrl = (pageUrl: string) => {
  const url = new URL(pageUrl);
  url.search = "";
  return url.href;
};

/** A translatable text with one language replaced (blank non-English values are dropped: English falls back). */
export const withTranslation = (text: TranslatableText, language: string, value: string): TranslatableText => {
  const next: Record<string, string | undefined> = { ...text, [language]: value };
  if (language !== "en" && !value) delete next[language];
  return next as TranslatableText;
};

/** A display name: the text in `language`, else the English fallback, else `fallback`. */
export const displayText = (text: TranslatableText, language: string, fallback: string) =>
  resolveTranslatableText(text, language).trim() || fallback;

/** `YYYY-MM-DD` of a UTC millisecond time, or "" for an open end. */
export const toUtcDateInput = (time: number | null) => {
  if (time === null) return "";
  return new Date(time).toISOString().slice(0, ISO_DATE_LENGTH);
};

/** UTC midnight of a `YYYY-MM-DD` input, or null for an empty or invalid value. */
export const parseUtcDateInput = (value: string) => {
  if (!value) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
};

/** The availability window from date inputs: `until` is exclusive, so the chosen last day is playable. */
export const availabilityFromInputs = (from: string, until: string): Campaign["availability"] => {
  const untilDay = parseUtcDateInput(until);
  return { from: parseUtcDateInput(from), until: untilDay === null ? null : untilDay + DAY_MS };
};

/** The date inputs of an availability window (the inclusive last day for `until`). */
export const availabilityInputs = ({ from, until }: Campaign["availability"]) => ({
  from: toUtcDateInput(from),
  until: toUtcDateInput(until === null ? null : until - DAY_MS)
});

/** Every image record id the campaign and its maps still use (map view, speaker portraits, quest images). */
export const referencedImageIds = (campaign: Campaign, maps: readonly CampaignMap[]) => {
  const ids = new Set<string>();
  if (campaign.imageId) ids.add(campaign.imageId);
  for (const speaker of campaign.speakers ?? [])
    for (const imageId of Object.values(speaker.portraits)) if (imageId) ids.add(imageId);
  for (const map of maps) for (const quest of map.quests) if (quest.imageId) ids.add(quest.imageId);
  return ids;
};

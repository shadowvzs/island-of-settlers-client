import type { I18n } from "@lingui/core";

import { CAMPAIGN_DEFAULT_EXIT } from "../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import type { Campaign, CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { campaignRunMapStatus, type CampaignRunState } from "../../shared/campaign/campaign-run";
import { translateMessage } from "../../shared/i18n/translate";
import type { CampaignEndReport } from "../cloud/economy-client";
import { parsedCodec } from "../preferences/codecs";
import { PREFERENCES } from "../preferences/keys";
import { definePreference, type PreferenceArea } from "../preferences/registry";
import { SESSION_MESSAGES } from "../session-messages";
import type { CampaignRecordSource } from "./campaign-player-source";
import { campaignExitName, campaignRecordName } from "./campaign-record-names";

/**
 * What a stored campaign attempt end means for the account's path (BR4, plan §5.2): the run's end is reported on the
 * campaign map and the page then reloads into home, so the facts wait in the tab's session storage and are shown
 * once at home. Losing them (blocked storage) loses only the toast; the campaign window shows the path anyway.
 */
export interface CampaignEndNotice {
  campaignId: string;
  /** This victory reached an ending of the campaign for the first time. */
  completed: boolean;
  mapId: string;
  /** A first victory chose a named exit. */
  pathChosen: boolean;
  /** The exit of the map's first victory (the account's path). */
  pathExit: string;
  /** A replay ended through another exit: the path did not change. */
  pathKept: boolean;
}

const isNotice = (value: unknown): value is CampaignEndNotice => {
  const notice = value as Partial<CampaignEndNotice> | null;
  return typeof notice?.campaignId === "string" && typeof notice.mapId === "string" &&
    typeof notice.pathExit === "string" && typeof notice.completed === "boolean" &&
    typeof notice.pathKept === "boolean" && typeof notice.pathChosen === "boolean";
};

const parseNotice = (raw: string | null) => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isNotice(value) ? value : null;
  } catch {
    return null;
  }
};

const noticePreference = definePreference(PREFERENCES.campaignEndNotice,
  parsedCodec<CampaignEndNotice | null, CampaignEndNotice>(parseNotice, notice => JSON.stringify(notice)));

/** The notice of a stored end, or null when it changes nothing worth a line (a defeat, a plain replay). */
export const campaignEndNoticeOf = (run: CampaignRunState, report: CampaignEndReport): CampaignEndNotice | null => {
  if (report.exit === undefined) return null;
  const firstVictory = campaignRunMapStatus(run) !== "completed", pathExit = report.pathExit ?? report.exit;
  const notice = {
    campaignId: run.campaignId, completed: firstVictory && report.campaignCompleted, mapId: run.mapId,
    pathChosen: firstVictory && pathExit !== CAMPAIGN_DEFAULT_EXIT, pathExit, pathKept: report.exit !== pathExit
  };
  return notice.completed || notice.pathChosen || notice.pathKept ? notice : null;
};

/** Keeps the notice of a stored end for the home island after the reload. */
export const keepCampaignEndNotice = (run: CampaignRunState, report: CampaignEndReport, area?: PreferenceArea) => {
  const notice = campaignEndNoticeOf(run, report);
  if (notice) noticePreference.write(notice, area);
};

/** The kept notice, removed on reading (it is shown once). */
export const takeCampaignEndNotice = (area?: PreferenceArea) => {
  const notice = noticePreference.read(area);
  noticePreference.clear(area);
  return notice;
};

interface NoticeRecords {
  campaign?: Pick<Campaign, "id" | "name">;
  map?: Pick<CampaignMap, "exits">;
}

/** The toast lines of a notice: the kept or chosen path by exit name, and a reached ending by campaign name. */
export const campaignEndNoticeLines = (notice: CampaignEndNotice, records: NoticeRecords, i18n?: I18n) => {
  const exit = (records.map && campaignExitName(records.map, notice.pathExit, i18n)) ||
    translateMessage(i18n, SESSION_MESSAGES.campaign.defaultExit);
  const lines: string[] = [];
  if (notice.pathKept) lines.push(translateMessage(i18n, SESSION_MESSAGES.campaign.pathStays, { exit }));
  else if (notice.pathChosen) lines.push(translateMessage(i18n, SESSION_MESSAGES.campaign.pathChosen, { exit }));
  if (notice.completed) {
    const campaign = records.campaign ? campaignRecordName(records.campaign, i18n) : notice.campaignId;
    lines.push(translateMessage(i18n, SESSION_MESSAGES.campaign.campaignCompleted, { campaign }));
  }
  return lines;
};

interface CampaignEndAnnouncement {
  area?: PreferenceArea;
  i18n?: I18n;
  notify(text: string): void;
  openRepositories(): Promise<CampaignRecordSource | null>;
}

/** At home: shows the kept notice once, with the exit and campaign names from the campaign records. */
export const announceCampaignEndNotice = async (
  { area, i18n, notify, openRepositories }: CampaignEndAnnouncement
) => {
  const notice = takeCampaignEndNotice(area);
  if (!notice) return;
  const records: NoticeRecords = {};
  try {
    const repositories = await openRepositories();
    const [campaigns, maps] = await Promise.all([repositories?.campaigns.list() ?? [],
      repositories?.maps.list({ campaignId: notice.campaignId }) ?? []]);
    records.campaign = campaigns.find(campaign => campaign.id === notice.campaignId);
    records.map = maps.find(map => map.id === notice.mapId);
  } catch {
    // The ids and the default exit name still make a readable line.
  }
  for (const line of campaignEndNoticeLines(notice, records, i18n)) notify(line);
};

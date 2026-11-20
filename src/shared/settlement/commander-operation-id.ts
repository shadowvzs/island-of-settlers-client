/**
 * The commander's one outward slot is keyed by its operation: a colony or adventure expedition id, or a
 * campaign run `campaign:<mapId>:<attempt>` (campaign plan item 12). Either form blocks every other claim.
 */
export type CampaignOperationId = `campaign:${string}:${number}`;
export type CommanderOperationId = number | CampaignOperationId;

const CAMPAIGN_PREFIX = "campaign:";
const MAX_OPERATION_ID_LENGTH = 160;
const CAMPAIGN_OPERATION_PATTERN = /^campaign:[^:]+:[1-9]\d*$/;

export const campaignOperationId = (mapId: string, attempt: number): CampaignOperationId =>
  `${CAMPAIGN_PREFIX}${mapId}:${attempt}`;

export const isCampaignOperationId = (value: unknown): value is CampaignOperationId =>
  typeof value === "string" && value.length <= MAX_OPERATION_ID_LENGTH && CAMPAIGN_OPERATION_PATTERN.test(value);

/** A positive expedition id or a well-formed campaign run id. */
export const isCommanderOperationId = (value: unknown): value is CommanderOperationId =>
  (Number.isSafeInteger(value) && (value as number) > 0) || isCampaignOperationId(value);

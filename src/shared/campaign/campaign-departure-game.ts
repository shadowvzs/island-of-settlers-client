import type {
  CampaignCargo, CampaignMap
} from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { Archipelago } from "../settlement/archipelago";
import type { GameSaveV1 } from "../settlement/game-save";
import { type CampaignLaunchRequirements, campaignRequiredLevel } from "./campaign-requirements";
import { campaignRunMarker, type CampaignRunStart } from "./campaign-run";
import { CAMPAIGN_ATTEMPT_CLOCK_MS } from "./constants";

/**
 * The hand-over of a campaign departure (C8): what the launch gate and the `departCampaign` command read from the
 * map record, the new attempt's number and the first game save of the run with the home island filed.
 */

type ShipmentSource = Pick<CampaignMap, "requiredCargo" | "soldierCap">;

/**
 * What actually sails: the required cargo with its soldiers trimmed to the map's `soldierCap` in cargo line order
 * (the overflow stays in the home reserve, C9b open point). A cap of 0 is the record default "no cap set", so it
 * trims nothing.
 */
export const campaignShipment = ({ requiredCargo, soldierCap }: ShipmentSource): CampaignCargo => {
  if (soldierCap <= 0) return requiredCargo;
  let room = soldierCap;
  const soldiers = requiredCargo.soldiers.flatMap(line => {
    const amount = Math.min(line.amount, room);
    room -= amount;
    return amount > 0 ? [{ ...line, amount }] : [];
  });
  return { ...requiredCargo, soldiers };
};

/** The launch requirements of a map: its shipment and its strictest player-level unlock. */
export const campaignLaunchOf = (map: ShipmentSource & Pick<CampaignMap, "unlock">) => {
  const requiredLevel = campaignRequiredLevel(map.unlock);
  return { cargo: campaignShipment(map), ...(requiredLevel === undefined ? {} : { requiredLevel }) } satisfies
    CampaignLaunchRequirements;
};

/** What the run remembers of its shipment: only these soldiers and settlers may sail home again (C9a, C9b). */
export const campaignShippedOf = ({ settlers, soldiers }: CampaignCargo) => ({
  ...(settlers > 0 ? { shippedSettlers: settlers } : {}),
  ...(soldiers.length ? { shippedSoldiers: soldiers } : {})
}) satisfies Pick<CampaignRunStart, "shippedSettlers" | "shippedSoldiers">;

/**
 * The attempt number of a run created at `gameNow` (home game time, UTC ms). The home clock only moves forward and
 * a run must end before the next starts, so the number (and the run key) is never reused; no counter is stored.
 */
export const campaignAttemptNumber = (gameNow: number) =>
  Math.max(1, Math.floor(gameNow / CAMPAIGN_ATTEMPT_CLOCK_MS));

/** The run's first save on screen: home (as captured after the departure) filed, the marker in the group. */
export const campaignRunGame = (
  home: GameSaveV1, group: Archipelago, run: GameSaveV1, createdAt: number
): GameSaveV1 => {
  if (!run.campaignRun) throw new Error("The campaign run has no campaign state");
  const { archipelago: _group, campaignRun: _run, player: _player, ...filed } = home;
  const campaign = { ...campaignRunMarker(run.campaignRun), runCreatedAt: createdAt };
  return { ...run, archipelago: { ...group, active: null, campaign, home: filed as GameSaveV1 } };
};

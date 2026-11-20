import { shipEntry } from "@shared/catalog";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { resolveAssetUrl } from "../../content/asset-url";
import { imageArt } from "../art-helpers";
import { nationShipIcon } from "../icons";
import type { SettlementShipSummary } from "../types";

/** Neutral trader portraits per nation (content catalog `ship:sailingShip`). */
const NEUTRAL_ICONS: Readonly<Record<WorkerNation, string>> = Object.freeze(Object.fromEntries(
  Object.entries(shipEntry("ship", "sailingShip")!.ship.neutralIcons!).map(([nation, icon]) =>
    [nation, resolveAssetUrl(icon, {})!])
) as Record<WorkerNation, string>);

/** A pre-rendered canonical hull, with visitor identity supplied by the simulation frame. */
export const shipPortrait = (ship: SettlementShipSummary, playerNation: string) => {
  const nation = ship.nation ?? playerNation;
  const resolved = nation in NEUTRAL_ICONS ? nation as WorkerNation : "roman";
  return imageArt(ship.livery === "neutral" ? NEUTRAL_ICONS[resolved] : nationShipIcon(resolved),
    "settlement-art-icon settlement-ui__ship-portrait");
};

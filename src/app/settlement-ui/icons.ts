import { shipEntry } from "@shared/catalog";

import roadUpgradeIconUrl from "../../../assets/road-previews/stone.png?url";
import expandIconUrl from "../../../assets/ui-icons/camera/down.png?url";
import backIconUrl from "../../../assets/ui-icons/camera/left.png?url";
import pageNextIconUrl from "../../../assets/ui-icons/camera/right.png?url";
import rotateIconUrl from "../../../assets/ui-icons/camera/rotate-right.png?url";
import collapseIconUrl from "../../../assets/ui-icons/camera/up.png?url";
import floppyIconUrl from "../../../assets/ui-icons/floppy-disk.webp?url";
import campaignIconUrl from "../../../assets/ui-icons/rally-flag.png?url";
import buildingIconUrl from "../../../assets/ui-icons/roman-buildings.png?url";
import statisticsIconUrl from "../../../assets/ui-icons/statistics.webp?url";
import boatIconUrl from "../../../assets/ware-icons/boat.png?url";
import grainIconUrl from "../../../assets/ware-icons/grain.png?url";
import handcartIconUrl from "../../../assets/ware-icons/handcart.png?url";
import planksIconUrl from "../../../assets/ware-icons/planks.png?url";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { resolveAssetUrl } from "../content/asset-url";

import "./icon-styles.css";

/** Offline 3D renders of the HUD actions (tools/bench/ui-action-icons.ts). */
const actionIcons = import.meta.glob<string>("../../../assets/ui-icons/actions/*.webp", {
  eager: true,
  import: "default",
  query: "?url"
});

/** Renders of each nation's actual ship model (tools/bench/ship-icon-render.ts; catalog `ship:sailingShip`). */
const NATION_SHIP_ICONS: Readonly<Record<WorkerNation, string>> = Object.freeze(Object.fromEntries(
  Object.entries(shipEntry("ship", "sailingShip")!.ship.nationIcons!).map(([nation, icon]) =>
    [nation, resolveAssetUrl(icon, {})!])
) as Record<WorkerNation, string>);

/** Large menu artwork shown as plain images (sized by the `img.settlement-art-icon` rules). */
const pictureIcons: Record<string, string> = {
  buildings: buildingIconUrl,
  save: floppyIconUrl,
  ship: NATION_SHIP_ICONS.roman,
  statistics: statisticsIconUrl
};

/** Names that reuse an existing 3D render instead of a dedicated action icon. */
const sharedIcons: Record<string, string> = {
  back: backIconUrl,
  boat: boatIconUrl,
  /** The campaign launcher and Set sail reuse the rendered war standard. */
  campaign: campaignIconUrl,
  collapse: collapseIconUrl,
  expand: expandIconUrl,
  grain: grainIconUrl,
  handcart: handcartIconUrl,
  pageNext: pageNextIconUrl,
  planks: planksIconUrl,
  roadUpgrade: roadUpgradeIconUrl,
  rotate: rotateIconUrl
};

const actionIconAliases: Record<string, string> = { settings: "menu" };

/** The "ship" icon shows the player's nation's ship; icons created afterwards use it. */
export const setShipIconNation = (nation: WorkerNation) => { pictureIcons.ship = NATION_SHIP_ICONS[nation]; };

const actionIconUrl = (name: string) =>
  actionIcons[`../../../assets/ui-icons/actions/${actionIconAliases[name] ?? name}.webp`];

/** How a named HUD icon is drawn: a flat picture, a pre-rendered 3D image, or the sail-back pair. */
export type SettlementIconSource =
  | { kind: "picture"; source: string }
  | { kind: "rendered"; source: string }
  | { kind: "sailBack"; back: string; ship: string };

/** How the React `SettlementIcon` draws a named icon. */
export const resolveSettlementIcon = (name: string): SettlementIconSource => {
  if (name === "sailBack") return { kind: "sailBack", back: backIconUrl, ship: pictureIcons.ship! };
  const picture = pictureIcons[name];
  if (picture) return { kind: "picture", source: picture };
  return { kind: "rendered", source: sharedIcons[name] ?? actionIconUrl(name) ?? actionIconUrl("warehouse")! };
};

/** The image URL of a named HUD icon (the ship for the sail-back pair), e.g. for a development tool. */
export const getSettlementIconSource = (name: string) => {
  const icon = resolveSettlementIcon(name);
  if (icon.kind === "sailBack") return icon.ship;
  return icon.source;
};

/** Canonical owned ship portrait without changing the shared HUD icon selection. */
export const nationShipIcon = (nation: WorkerNation) => NATION_SHIP_ICONS[nation];

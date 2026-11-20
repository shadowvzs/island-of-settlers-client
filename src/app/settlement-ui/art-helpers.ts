import { isAdventureIsland } from "../../shared/settlement/adventure-rules";
import type { ExpeditionIsland } from "../../shared/settlement/settlement-colony-expeditions";
import { joinClassNames } from "../components/helpers";
import { troopIcon } from "../settlement/army-icons";
import { resolveSettlementIcon } from "./icons";

/**
 * Picture data of the expedition, tracker and popup views (React-free, so the startup code that
 * builds popup content does not load React): a ware icon, or an image with an optional class.
 */
export type ArtImage =
  | { kind: "icon"; name: string }
  | { kind: "ware"; ware: string }
  | { className?: string; kind: "image"; source: string };

export const wareArt = (ware: string): ArtImage => ({ kind: "ware", ware });

export const imageArt = (source: string, className?: string): ArtImage => ({ className, kind: "image", source });

/** A settlement icon; picture icons become images so they can carry an extra class. */
export const settlementIconArt = (name: string, className?: string): ArtImage => {
  const icon = resolveSettlementIcon(name);
  if (icon.kind !== "picture") return { kind: "icon", name };
  return imageArt(icon.source, joinClassNames("settlement-art-icon", className));
};

/** A detailed soldier portrait marks adventures (no ore), using the player's nation art. */
export const adventureArt = (nation: string) => imageArt(troopIcon(nation, "heavy"), "colony-planner__adventure-art");

/** Ore icon for a colony, a soldier portrait for an adventure. */
export const expeditionArt = (island: ExpeditionIsland, nation: string) =>
  isAdventureIsland(island) ? adventureArt(nation) : wareArt(island.ore);

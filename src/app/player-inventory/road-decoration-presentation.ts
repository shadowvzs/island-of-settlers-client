import { msg } from "@lingui/core/macro";
import { decorationEntry } from "@shared/catalog";

import { getRoadDecorationItem } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { contentDescriptor } from "../../shared/i18n/content-text";
import { resolveAssetUrl } from "../content/asset-url";
import { PLANT_ITEM_MESSAGES } from "./plant-presentation";

export const ROAD_DECORATION_MESSAGES = {
  title: msg({ id: "roadDecoration.title", message: "Decoration" }),
  pickUp: msg({ id: "roadDecoration.pickUp", message: "Pick up" }),
  rotate: msg({ id: "roadDecoration.rotate", message: "Rotate 90° clockwise" }),
  move: msg({ id: "roadDecoration.move", message: "Move decoration" }),
  working: msg({ id: "roadDecoration.working", message: "Moving the decoration…" }),
  ready: msg({ id: "roadDecoration.ready", message: "Click to place · R to rotate" }),
  clearSpot: msg({ id: "roadDecoration.clearSpot", message: "Choose clear, level ground in your territory" }),
  missing: msg({ id: "roadDecoration.missing", message: "This decoration is no longer placed." }),
  description: msg({ id: "roadDecoration.description", message: "Click to place on owned terrain. Press R to rotate. Right-click to cancel without using the item." })
};
const finishes = {
  limestone: msg({ id: "domain.ware.limestone", message: "Limestone" }),
  granite: msg({ id: "roadDecoration.finish.granite", message: "Granite" }),
  marble: msg({ id: "domain.ware.marble", message: "Marble" })
};
export const roadDecorationFinishMessage = (id: unknown) => {
  const item = getRoadDecorationItem(id);
  if (!item || item.finish === "native") return undefined;
  return finishes[item.finish];
};
/** Name (the catalog's Lingui text) and description of a decoration item. */
export const roadDecorationMessages = (id: unknown) => {
  const item = getRoadDecorationItem(id);
  const entry = item && decorationEntry(item.decoration);
  if (!entry) return undefined;
  const description = item.plant ? PLANT_ITEM_MESSAGES.description : ROAD_DECORATION_MESSAGES.description;
  return { description, name: contentDescriptor(entry.text.name) };
};
export const roadDecorationIconUrl = (id: unknown) => {
  const item = getRoadDecorationItem(id);
  const icon = item && decorationEntry(item.decoration)?.icon;
  if (!icon) return "";
  return resolveAssetUrl(icon, { finish: item.finish, key: item.decoration }) ?? "";
};

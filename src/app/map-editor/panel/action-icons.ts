import { getIconSources } from "../editor-icons";

const ACTION_ICONS = import.meta.glob<string>("../../../../assets/ui-icons/actions/*.webp", {
  eager: true, import: "default", query: "?url"
});
const CAMERA_ICONS = import.meta.glob<string>("../../../../assets/ui-icons/camera/*.png", {
  eager: true, import: "default", query: "?url"
});
/** Computer faction AI icons (`ai:none` … `ai:aggressive`): 3D renders from `ui-action-icons.ts --set=ai`. */
const AI_ICONS = import.meta.glob<string>("../../../../assets/ui-icons/ai/*.webp", {
  eager: true, import: "default", query: "?url"
});
const ICON_CLASS = "map-editor__icon";

/** One icon per meaning; the button's short caption tells same-meaning actions of a row apart. */
const ICON_PATTERNS: readonly [RegExp, string][] = [
  [/^(apply|set)\b/i, "action:apply"],
  [/^validate\b/i, "action:register"],
  [/^(place|add|draw)\b/i, "action:build"],
  [/^(remove|delete|erase|clear)\b/i, "action:demolish"],
  [/^move\b/i, "action:drag"],
  [/^(select|inspect|show|preview)\b/i, "action:scout"],
  [/^rotate\b/i, "camera:rotate-right"],
  [/^(save|capture)\b/i, "map-save"],
  [/^(load|restore|recover)\b/i, "map-load"],
  [/^(cancel|hide)\b/i, "action:cancel"],
  [/^undo\b/i, "history-undo"],
  [/^redo\b/i, "history-redo"],
  [/^(refresh|retry|use normal)\b/i, "camera:reset"],
  [/^(regenerate|regrow)\b/i, "action:musicRepeat"],
  [/^next\b/i, "camera:right"],
  [/^play\b/i, "action:musicPlay"]
];

/** The icon key a label's leading verb means, or undefined (the button then shows its caption alone). */
export const getActionIconKey = (label: string) =>
  ICON_PATTERNS.find(([pattern]) => pattern.test(label))?.[1];

/** An icon image's sources: an editor icon (1x/2x), or `action:` / `camera:` / `ai:` UI icons (1x only). */
export interface ActionIcon {
  className?: string;
  loading?: "lazy";
  src: string;
  srcSet?: string;
}

const getUiIconUrl = (kind: string, name: string) => {
  if (kind === "action") return ACTION_ICONS[`../../../../assets/ui-icons/actions/${name}.webp`];
  if (kind === "camera") return CAMERA_ICONS[`../../../../assets/ui-icons/camera/${name}.png`];
  if (kind === "ai") return AI_ICONS[`../../../../assets/ui-icons/ai/${name}.webp`];
  return undefined;
};

/** The image of an icon key, or null without its file. */
export const getActionIcon = (key: string): ActionIcon | null => {
  if (!key.includes(":")) {
    const sources = getIconSources(key);
    return sources && { className: ICON_CLASS, loading: "lazy", src: sources.src, srcSet: sources.srcset };
  }
  const [kind, name] = key.split(":");
  const url = getUiIconUrl(kind!, name!);
  return url ? { className: ICON_CLASS, src: url } : null;
};

/** How an editor action button looks: its icon (from its meaning) and its visible short caption. */
export interface ActionButtonLook {
  caption: string;
  icon: ActionIcon | null;
}

/** The icon `icon` names, else the one the label's meaning infers; the caption defaults to the label. */
export const getActionButtonLook = (label: string, icon?: string, caption?: string): ActionButtonLook => {
  const key = icon ?? getActionIconKey(label);
  return { caption: caption ?? label, icon: key ? getActionIcon(key) : null };
};

/** A tool button's class, marked while its tool is active. */
export const getToolClassName = (className: string, active = false) =>
  (active ? `${className} is-active` : className);

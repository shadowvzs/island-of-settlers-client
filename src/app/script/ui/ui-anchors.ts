import { UI_ANCHOR_ATTRIBUTE, UI_ANCHOR_PARENTS } from "./constants";

/** The declared parent opener of an anchor (e.g. a build tab's bottom-bar icon), or null. */
export const uiAnchorParent = (anchor: string) =>
  UI_ANCHOR_PARENTS.find(([prefix]) => anchor.startsWith(prefix))?.[1] ?? null;

/** The anchor and its fallbacks, nearest first. */
export const uiAnchorChain = (anchor: string) => {
  const chain = [anchor];
  for (let parent = uiAnchorParent(anchor); parent && !chain.includes(parent); parent = uiAnchorParent(parent))
    chain.push(parent);
  return chain;
};

const anchorSelector = (anchor: string) => `[${UI_ANCHOR_ATTRIBUTE}="${CSS.escape(anchor)}"]`;

/** Rendered and visible: laid out with a size, not inside a hidden subtree or an invisible window. */
const isShown = (element: HTMLElement) => {
  if (element.closest("[hidden]")) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return getComputedStyle(element).visibility !== "hidden";
};

/** The first shown element of the anchor chain, or null when none is on screen. */
export const findShownUiAnchor = (root: ParentNode, anchor: string) => {
  for (const id of uiAnchorChain(anchor)) {
    for (const element of root.querySelectorAll<HTMLElement>(anchorSelector(id)))
      if (isShown(element)) return { anchor: id, element };
  }
  return null;
};

/** The anchor id a clicked element belongs to, or null. */
export const clickedUiAnchor = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${UI_ANCHOR_ATTRIBUTE}]`)?.getAttribute(UI_ANCHOR_ATTRIBUTE) ?? null;
};

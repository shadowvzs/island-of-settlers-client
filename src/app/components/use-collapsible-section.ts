import { type ReactNode, useState } from "react";

import { flagCodec } from "../preferences/codecs";
import { PREFERENCE_FAMILIES } from "../preferences/keys";
import { definePreferenceFamily } from "../preferences/registry";
import type { InfoContent } from "./info-hint";

/** Storage surface of the collapse state; absent (the browser's local storage) outside tests. */
export type CollapseStorage = Pick<Storage, "getItem" | "setItem">;

/** One section's remembered open state (section ids are stable UI identifiers); collapsed by default. */
const sectionOpen = definePreferenceFamily(PREFERENCE_FAMILIES.settingsSection, flagCodec(false));

/** Key of one section's remembered open state. */
export const getCollapseStorageKey = (id: string) => sectionOpen(id).key;

/** Remembered open state: collapsed by default, open only after the player opened it before. */
export const readSectionOpen = (storage: CollapseStorage | undefined, id: string) => sectionOpen(id).read(storage);

/** Stores the open state; unavailable storage leaves the section working for this visit. */
export const writeSectionOpen = (storage: CollapseStorage | undefined, id: string, open: boolean) => {
  sectionOpen(id).write(open, storage);
};

/** The next open state of a header click, remembered for the next visit. */
export const toggleSectionOpen = (
  storage: CollapseStorage | undefined,
  id: string,
  open: boolean
) => {
  const next = !open;
  writeSectionOpen(storage, id, next);
  return next;
};

export interface CollapsibleSectionOptions {
  children: ReactNode;
  /** Stable section id: it remembers this section's open state. */
  id: string;
  info?: InfoContent;
  /** Short state line shown beside the title while collapsed (e.g. "10 of 10 on"). */
  summary: string;
  title: string;
}

/** View props of a collapsible settings block. */
export interface CollapsibleSectionViewProps {
  children: ReactNode;
  contentId: string;
  info?: InfoContent;
  open: boolean;
  summary: string;
  title: string;
  onToggle: () => void;
}

/** One settings block behind a header button; the open state is remembered per `id`. */
export const useCollapsibleSection = ({ children, id, info, summary, title }: CollapsibleSectionOptions) => {
  const [open, setOpen] = useState(() => readSectionOpen(undefined, id));
  return {
    children,
    contentId: `${id}-content`,
    info,
    onToggle: () => setOpen(toggleSectionOpen(undefined, id, open)),
    open,
    summary,
    title
  };
};

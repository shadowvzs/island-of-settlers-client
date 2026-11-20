import type { I18n } from "@lingui/core";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";

import { MAX_CAMERA_BOOKMARKS } from "../../camera-bookmarks";
import { useExternalStore } from "../../components/external-store";
import type { CameraBookmarkControls } from "./bookmark-controls";
import { getBookmarkRows, getBookmarkStatus } from "./helpers";

/**
 * Bookmark form and list: the name draft, Enter or Save adds the current view (a refused name keeps the
 * draft, says why and refocuses the input), rows go to or delete a view.
 */
export const useCameraBookmarks = (controls: CameraBookmarkControls, i18n?: I18n) => {
  const entries = useExternalStore(controls.entries);
  const [name, setName] = useState("");
  const [invalidName, setInvalidName] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => getBookmarkRows(entries, i18n), [entries, i18n]);
  const save = () => {
    if (!controls.add(name)) {
      setInvalidName(true);
      input.current?.focus();
      return;
    }
    setName("");
    setInvalidName(false);
  };
  return {
    addDisabled: entries.length >= MAX_CAMERA_BOOKMARKS,
    input,
    name,
    rows,
    status: getBookmarkStatus(entries.length, invalidName, i18n),
    onDelete: (index: number) => {
      controls.remove(index);
      setInvalidName(false);
    },
    onGo: controls.go,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      save();
    },
    onNameChange: setName,
    onSave: save
  };
};

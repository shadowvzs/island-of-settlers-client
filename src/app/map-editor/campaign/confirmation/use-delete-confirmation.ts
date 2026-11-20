import { useLingui } from "@lingui/react";
import { useEffect, useRef } from "react";

import type { CampaignEditor } from "../campaign-editor";
import { useCampaignEditorState } from "../use-campaign-editor";
import { deleteConfirmationView } from "./helpers";

/** The pending deletion's panel: Cancel takes the focus on open; Escape cancels while it is open. */
export const useDeleteConfirmation = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const { busy, confirmation } = useCampaignEditorState(editor);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const view = confirmation && deleteConfirmationView(confirmation, i18n);
  const key = view?.key;
  useEffect(() => {
    if (!key) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      editor.cancelDeletion();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editor, key]);
  return { busy, cancelRef, view };
};

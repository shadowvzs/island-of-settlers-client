import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { useExternalStore } from "../../components/external-store";
import { editorGameSettings, editorSettingsStatus } from "./editor-game-settings";
import { editorModeView } from "./editor-mode";

/** The mode line of an editor outside the Map rules section (the campaign editor), with the settings it follows. */
export const useEditorMode = () => {
  const { i18n } = useLingui();
  const settings = useExternalStore(editorGameSettings);
  const status = useExternalStore(editorSettingsStatus);
  return useMemo(() => ({ ...editorModeView(i18n, settings, status), settings }), [i18n, settings, status]);
};

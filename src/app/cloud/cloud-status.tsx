import { useLingui } from "@lingui/react";

import { translateMessage } from "../../shared/i18n/translate";
import { useExternalStore } from "../components/external-store";
import type { ReadableStore } from "../components/ui-store";
import type { CloudSaveStatus } from "../save-store/remote-save-store";
import { getVerificationView } from "./helpers";
import { CLOUD_MESSAGES } from "./messages";
import { useCloudStatus } from "./use-cloud-status";
import type { VerificationState } from "./verification-status";

import "./cloud-status.css";

interface CloudStatusProps {
  status: ReadableStore<CloudSaveStatus | null>;
  /** The slot's verified revision/flag: shown as a short hint beside the save state. */
  verification: ReadableStore<VerificationState | null>;
  /** A warning opens its question again (conflict, session taken over). */
  onOpen: () => void;
}

/** The small cloud save line in the corner; a warning is a button that reopens its question. */
export const CloudStatus = ({ status, verification, onOpen }: CloudStatusProps) => {
  const { i18n } = useLingui();
  const verificationState = useExternalStore(verification), view = useCloudStatus(status);
  const verificationView = getVerificationView(verificationState, i18n);
  if (!view) return null;
  let text = view.text;
  if (verificationView) {
    text = translateMessage(i18n, CLOUD_MESSAGES.status.withVerification, {
      save: view.text, verification: verificationView.text
    });
  }
  if (!view.warning) return <p className="cloud-status" role="status">{text}</p>;
  return (
    <button className="cloud-status cloud-status--warning" type="button" onClick={onOpen}>{text}</button>
  );
};

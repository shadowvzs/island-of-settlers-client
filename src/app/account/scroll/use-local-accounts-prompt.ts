import { useLingui } from "@lingui/react";

import { useSubmitOnce } from "../form/use-submit-once";
import { EXPORT_FAILED } from "./helpers";

/** Export their saves: one submission at a time; a failure shows in the page status. */
export const useLocalAccountsPrompt = (onExport: () => Promise<void>) => {
  const { i18n } = useLingui();
  const form = useSubmitOnce(i18n._(EXPORT_FAILED), async () => {
    await onExport();
    return true;
  });
  return { busy: form.busy, status: form.status, onExportClick: () => void form.submit() };
};

import { useLingui } from "@lingui/react";
import { useRef } from "react";

import { useFocusOnMount } from "../form/use-focus-on-mount";
import { useSubmitOnce } from "../form/use-submit-once";
import { CHOICE_FAILED } from "./helpers";
import type { ScrollChoice } from "./scroll-pages";

/** One answer at a time: the buttons stay busy while it runs; a failed answer shows in the page status. */
export const useChoicesPage = (choices: readonly ScrollChoice[]) => {
  const { i18n } = useLingui();
  const firstRef = useFocusOnMount<HTMLButtonElement>();
  const chosen = useRef(0);
  const form = useSubmitOnce(i18n._(CHOICE_FAILED), async () => {
    await choices[chosen.current]?.onSelect();
  });
  return {
    busy: form.busy,
    firstRef,
    status: form.status,
    onChoose: (index: number) => {
      chosen.current = index;
      void form.submit();
    }
  };
};

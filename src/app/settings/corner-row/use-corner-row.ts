import { useMemo } from "react";

import { useExternalStore } from "../../components/external-store";
import type { CornerRowStore } from "./corner-row";
import { getCornerButtonView } from "./helpers";

/** The corner buttons ready to render; recomputed only when an owner changes a button. */
export const useCornerRow = (store: CornerRowStore) => {
  const buttons = useExternalStore(store);
  return useMemo(() => buttons.map(getCornerButtonView), [buttons]);
};

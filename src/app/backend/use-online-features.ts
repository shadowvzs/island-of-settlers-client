import { useSyncExternalStore } from "react";

import { onlineFeatures } from "./online-features";

/** The game's online feature switches for a view (startup publishes them once; standalone = all on). */
export const useOnlineFeatures = () =>
  useSyncExternalStore(onlineFeatures.subscribe, onlineFeatures.getSnapshot, onlineFeatures.getSnapshot);

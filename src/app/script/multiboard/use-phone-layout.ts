import { useSyncExternalStore } from "react";

import { PHONE_LAYOUT_QUERY } from "./constants";

const subscribe = (listener: () => void) => {
  const query = matchMedia(PHONE_LAYOUT_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

/** True on a phone-width viewport; server rendering (markup tests) reads the desktop layout. */
export const usePhoneLayout = () =>
  useSyncExternalStore(subscribe, () => matchMedia(PHONE_LAYOUT_QUERY).matches, () => false);

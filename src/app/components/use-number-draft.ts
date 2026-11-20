import { useState } from "react";

import { parseNumberDraft } from "./number-stepper-helpers";

/**
 * A controlled number field that keeps what the player types while it has focus: each parsable draft
 * is reported at once, the field shows the owner's (clamped) value again once it loses focus.
 */
export const useNumberDraft = (value: number, onChange: (value: number) => void) => {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    text: draft ?? String(value),
    onBlur: () => setDraft(null),
    onInput: (text: string) => {
      setDraft(text);
      const parsed = parseNumberDraft(text);
      if (parsed !== null) onChange(parsed);
    }
  };
};

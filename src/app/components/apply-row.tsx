import type { ReactNode } from "react";

import { getApplyRowClassName } from "./helpers";

interface ApplyRowProps {
  canApply: boolean;
  centered?: boolean;
  children: ReactNode;
  label: string;
  onApply: () => void;
}
/** A pending choice and its ✓ tick, enabled only while the choice differs from the applied one. */
export const ApplyRow = ({ canApply, centered = false, children, label, onApply }: ApplyRowProps) => (
  <div className={getApplyRowClassName(centered)}>
    {children}
    <button
      aria-label={label}
      className="settings-panel__apply"
      disabled={!canApply}
      title={label}
      type="button"
      onClick={onApply}
    >
      ✓
    </button>
  </div>
);

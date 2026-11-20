import { createExternalStore } from "../../components/ui-store";
import { getSettlementIconSource } from "../../settlement-ui/icons";
import type { DevelopmentTool, DevelopmentToolState } from "./helpers";
import type { DevelopmentText } from "./messages";

interface DevelopmentToolOptions {
  disabled?: boolean;
  /** The button opens a dialog (`aria-haspopup`). */
  hasPopup?: "dialog";
  /** The button's ref, e.g. a window's opener that gets focus back on close. */
  registerButton?: (element: HTMLButtonElement | null) => void;
  icon: string;
  /** Named shared IconButton artwork for new compact actions. */
  sharedIcon?: string;
  /** Extra class of the icon image (e.g. a tint). */
  iconClassName?: string;
  label: DevelopmentText;
  title: DevelopmentText;
  onClick: () => void;
}

/**
 * A development tab tool (rendered by React when the development panel first opens): its live state
 * (disabled, title, toggle) is a small store, so startup code can change it before or after the mount.
 */
export const createDevelopmentTool = ({
  disabled = false, hasPopup, icon, iconClassName, label, onClick, registerButton, sharedIcon, title
}: DevelopmentToolOptions): DevelopmentTool => {
  const state = createExternalStore<DevelopmentToolState>({ disabled, title });
  return {
    hasPopup,
    icon,
    iconClassName,
    label,
    registerButton,
    sharedIcon,
    state,
    onClick,
    update: changes => state.set({ ...state.getSnapshot(), ...changes })
  };
};

/** A development tool with a named HUD icon (`getSettlementIconSource`) whose label is also its tooltip. */
export const createIconTool = (iconName: string, label: DevelopmentText, onClick: () => void) =>
  createDevelopmentTool({ icon: getSettlementIconSource(iconName), label, title: label, onClick });

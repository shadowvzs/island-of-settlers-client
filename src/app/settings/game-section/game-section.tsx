import { LeavePanel } from "../../account/settings/leave-panel";
import { IconButton } from "../../components/icon-button";
import { Section } from "../../components/section";
import type { SlotListMode } from "../../save-slots/helpers";
import { ExitChoicePanel } from "./exit-choice-panel";
import { useGameSection } from "./use-game-section";

import "../../account/settings/account-settings.css";
import "./game-section.css";

/** The session's Save/Load slots (SAVE-SLOTS); absent while slots are off. */
export interface GameSectionSlots {
  /** Automatic saving is off: Exit game offers Save to slot… / Leave without saving (plan §7.3). */
  manualSaving: boolean;
  /** Discards the working slot's rows and returns to the title page; false when it failed. */
  leaveWithoutSaving: () => Promise<boolean>;
  open: (mode: SlotListMode) => void;
}

export interface GameSectionOptions {
  slots?: GameSectionSlots;
  /** Saves, ends a signed-in slot's lease and reloads to the title page; false when the save failed. */
  exitGame: () => Promise<boolean>;
}
/** Settings > Misc > Game: Save and Load icon buttons (when slots are on) and Exit game, confirmed in place. */
export const GameSection = ({ slots, exitGame }: GameSectionOptions) => {
  const model = useGameSection(slots);
  return (
    <Section icon="settings" title={model.text.title}>
      <div className="game-section__actions">
        {model.slotsShown && (
          <>
            <IconButton
              data={{ "data-game-save": "" }}
              hasPopup="dialog"
              icon="save"
              label={model.text.save}
              onClick={model.onSave}
            />
            <IconButton
              data={{ "data-game-load": "" }}
              hasPopup="dialog"
              icon="import"
              label={model.text.load}
              onClick={model.onLoad}
            />
          </>
        )}
        <IconButton caption={model.text.exit} data={{ "data-exit-game": "" }} icon="cancel" onClick={model.onOpen} />
      </div>
      {model.exitConfirmOpen && (
        <LeavePanel
          confirmLabel={model.text.exitConfirm}
          id="settings-exit-game-question"
          key={model.confirmKey}
          question={model.text.exitQuestion}
          onClose={model.onClose}
          onConfirm={exitGame}
        />
      )}
      {model.exitChoiceOpen && <ExitChoicePanel key={model.confirmKey} model={model} />}
    </Section>
  );
};

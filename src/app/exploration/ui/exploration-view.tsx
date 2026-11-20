import { useEffect, useRef } from "react";

import { joinClassNames } from "../../components/helpers";
import { SettlementIcon } from "../../components/settlement-icon";
import { useRepeatAction } from "../../components/use-repeat-action";
import type { ExplorationInput } from "../input/controller";
import { ExplorationHotkeyHints } from "./hotkey-hints";
import type { ExplorationOverlayView } from "./view-model";

import "./exploration-ui.css";

interface ExplorationViewProps {
  input: ExplorationInput | null;
  reducedMotion?: boolean;
  view: ExplorationOverlayView;
  onLeave: () => void;
  onSpyglass: () => void;
  onSpyglassZoom?: (direction: 1 | -1) => void;
}

/** The active HUD: right-side spyglass/Leave, the notice line, joystick and look surface. */
export const ExplorationView = ({
  input, onLeave, onSpyglass, onSpyglassZoom, reducedMotion = false, view
}: ExplorationViewProps) => {
  const lookRef = useRef<HTMLDivElement>(null);
  const lookStickRef = useRef<HTMLDivElement>(null);
  const lookStickKnobRef = useRef<HTMLDivElement>(null);
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  // Keep the keyboard lease (including emergency Back) even when every configured action is denied.
  const controlsVisible = view.showLeave;
  const zoomEnabled = view.spyglassPressed && !view.spyglassDisabled;
  const zoomIn = useRepeatAction(() => onSpyglassZoom?.(1), zoomEnabled);
  const zoomOut = useRepeatAction(() => onSpyglassZoom?.(-1), zoomEnabled);
  let escapeLabel = view.leaveText;
  if (view.spyglassPressed) escapeLabel = view.spyglassLabel;

  useEffect(() => {
    if (!input || !controlsVisible) return;
    const look = lookRef.current;
    const joystick = joystickRef.current;
    if (!look || !joystick) return;
    return input.attach({
      joystick,
      joystickKnob: knobRef.current,
      look,
      lookStick: lookStickRef.current,
      lookStickKnob: lookStickKnobRef.current
    });
  }, [controlsVisible, input]);

  if (!view.visible && !view.notice) return null;

  return (
    <div
      className={joinClassNames("exploration-ui", reducedMotion && "is-reduced-motion")}
      data-phase={view.phase}
      data-spyglass={String(view.spyglassPressed)}
      data-testid="exploration-ui"
    >
      {view.spyglassPressed && <div aria-hidden="true" className="exploration-ui__spyglass-mask" />}
      {view.notice && (
        <p aria-label={view.statusLabel} aria-live="polite" className="exploration-ui__notice" role="status">
          {view.notice}
        </p>
      )}
      {view.showSpyglass && (
        <button
          aria-label={view.spyglassLabel}
          aria-pressed={view.spyglassPressed}
          className="exploration-ui__action exploration-ui__spyglass"
          data-exploration-control="spyglass"
          disabled={view.spyglassDisabled}
          title={view.spyglassTitle}
          type="button"
          onClick={onSpyglass}
        >
          <SettlementIcon name="scout" />
          <span>{view.spyglassLabel}</span>
        </button>
      )}
      {view.spyglassPressed && (view.showZoomIn || view.showZoomOut) && (
        <div aria-label={view.spyglassZoomLabel} className="exploration-ui__spyglass-zoom" role="group">
          {view.showZoomOut && <button aria-label={view.spyglassZoomOutLabel} type="button" {...zoomOut}>−</button>}
          <output aria-live="polite">{view.spyglassZoomText}</output>
          {view.showZoomIn && <button aria-label={view.spyglassZoomInLabel} type="button" {...zoomIn}>+</button>}
        </div>
      )}
      {view.showLeave && (
        <section aria-label={view.controlsLabel} className="exploration-ui__actions">
          <button
            aria-label={view.leaveTitle}
            className="exploration-ui__action exploration-ui__leave"
            data-exploration-control="leave"
            disabled={view.leaveDisabled}
            title={view.leaveTitle}
            type="button"
            onClick={onLeave}
          >
            <SettlementIcon name="cancel" />
            <span>{view.leaveText}</span>
          </button>
        </section>
      )}
      {controlsVisible && (
        <div
          aria-label={view.lookLabel}
          className="exploration-ui__look"
          data-exploration-control="look"
          hidden={!view.showLook}
          ref={lookRef}
          role="region"
          title={view.lookTitle}
        />
      )}
      {controlsVisible && (
        <div
          aria-label={view.lookJoystickLabel}
          className="exploration-ui__look-stick"
          data-exploration-control="look-stick"
          hidden={!view.showLook}
          ref={lookStickRef}
          role="group"
          title={view.lookJoystickTitle}
        >
          <div aria-hidden="true" className="exploration-ui__joystick-base" />
          <div aria-hidden="true" className="exploration-ui__joystick-knob" ref={lookStickKnobRef} />
        </div>
      )}
      {view.showLeave && <ExplorationHotkeyHints escapeLabel={escapeLabel} view={view} />}
      {controlsVisible && (
        <div
          aria-label={view.joystickLabel}
          className="exploration-ui__joystick"
          data-exploration-control="joystick"
          hidden={!view.showJoystick}
          ref={joystickRef}
          role="group"
          title={view.joystickTitle}
        >
          <div aria-hidden="true" className="exploration-ui__joystick-base" />
          <div aria-hidden="true" className="exploration-ui__joystick-knob" ref={knobRef} />
        </div>
      )}
    </div>
  );
};

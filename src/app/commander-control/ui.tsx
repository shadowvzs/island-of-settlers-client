import { type I18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";

import { IconButton } from "../components/icon-button";
import { createExternalStore } from "../components/ui-store";
import type { ExplorationInput } from "../exploration/input/controller";
import { ExplorationView } from "../exploration/ui/exploration-view";
import type { CommanderHotkeyAction } from "../settings/hotkeys/bindings";
import { useCommanderUi } from "./use-commander-ui";

import "./ui.css";

export interface CommanderUiState {
  phase: "idle" | "preparing" | "active";
  canEnter: boolean;
  /** Show the entry button only while the commander is physically outside the lodge. */
  showEntry: boolean;
  name: string;
  portrait: string;
  hp: number;
  maximum: number;
  notice?: string;
  aiming?: boolean;
}
export interface CommanderUiActions {
  enter: () => void;
  leave: () => void;
  action: (action: CommanderHotkeyAction, held: boolean) => void;
}

const CommanderControls = ({ actions, input, store }: {
  actions: CommanderUiActions; input: ExplorationInput; store: ReturnType<typeof createExternalStore<CommanderUiState>>;
}) => {
  const { backLabel, enterLabel, health, healthWidth, preparingLabel, rows, state, view } = useCommanderUi(store);
  if (state.phase === "idle") {
    if (!state.showEntry) return null;
    return <div className="commander-control-entry" key="commander-entry">
      <IconButton disabled={!state.canEnter} icon={state.portrait} label={enterLabel}
        onClick={actions.enter} />
      {state.notice && <p role="status">{state.notice}</p>}
    </div>;
  }
  if (state.phase === "preparing") return <section className="exploration-ui commander-control-preparing">
    <p role="status">{preparingLabel}</p>
    <button type="button" onClick={actions.leave}>{backLabel}</button>
  </section>;
  return <>
    {state.aiming && <div aria-hidden="true" className="commander-control-reticle" key="commander-aim-reticle" />}
    {view && <ExplorationView input={input} view={view} onLeave={actions.leave} onSpyglass={() => undefined} />}
    <section aria-label={state.name} className="exploration-ui commander-control-status">
      <img alt="" draggable={false} src={state.portrait} />
      <b>{state.name}</b>
      <div aria-label={health} aria-valuemax={state.maximum} aria-valuemin={0} aria-valuenow={state.hp}
        className="commander-control-health" role="progressbar"><span style={{ width: healthWidth }} /></div>
      <small>{health}</small>
    </section>
    <section className="exploration-ui commander-control-actions">
      {rows.map(row => <button aria-label={row.label} key={row.action} title={row.label} type="button"
        onBlur={() => actions.action(row.action, false)}
        onPointerCancel={() => actions.action(row.action, false)}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); actions.action(row.action, true); }}
        onPointerUp={() => actions.action(row.action, false)}>
        <kbd>{row.key}</kbd><span>{row.label}</span>
      </button>)}
    </section>
  </>;
};

export const mountCommanderControls = (host: HTMLElement, input: ExplorationInput, state: CommanderUiState,
  actions: CommanderUiActions, i18n: I18n) => {
  const store = createExternalStore(state), root = createRoot(host);
  root.render(<I18nProvider i18n={i18n}><CommanderControls actions={actions} input={input} store={store} /></I18nProvider>);
  let previous = JSON.stringify(state);
  let reticle: HTMLElement | null = null;
  return {
    positionAim: (point: { x: number; y: number; depth: number }) => {
      if (!reticle?.isConnected) reticle = host.querySelector(".commander-control-reticle");
      if (!reticle) return;
      reticle.style.setProperty("--commander-aim-x", `${point.x}px`);
      reticle.style.setProperty("--commander-aim-y", `${point.y}px`);
      let visibility = "hidden";
      if (point.depth > -1 && point.depth < 1 && Number.isFinite(point.x) && Number.isFinite(point.y))
        visibility = "visible";
      reticle.style.setProperty("--commander-aim-visibility", visibility);
    },
    publish: (state: CommanderUiState) => {
      const next = JSON.stringify(state);
      if (previous === next) return;
      previous = next; store.set(state);
    },
    dispose: () => root.unmount()
  };
};

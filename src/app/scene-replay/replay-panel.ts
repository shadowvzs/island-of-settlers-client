import type { SceneReplay } from "./journal";
import { type createScenePlayer, SCENE_REPLAY_SPEEDS } from "./player";

type ScenePlayer = ReturnType<typeof createScenePlayer>;

const PANEL_STYLE = [
  "position:fixed", "left:10px", "bottom:10px", "z-index:1200", "max-width:calc(100vw - 20px)",
  "padding:10px", "background:#251d15", "color:#fff", "display:flex", "flex-wrap:wrap", "gap:8px",
  "align-items:center"
].join(";");

/** Developer-only DOM panel: status line plus optional playback controls (replaced per island). */
export const createReplayPanel = () => {
  const status = document.createElement("output");
  status.setAttribute("aria-live", "polite");
  const panel = document.createElement("aside");
  panel.className = "scene-replay-controls";
  panel.style.cssText = PANEL_STYLE;
  const controls = document.createElement("span");
  controls.style.cssText = "display:contents";
  panel.append(status, controls);
  document.body.append(panel);
  const show = (visible: boolean) => {
    panel.hidden = !visible;
    panel.style.display = visible ? "flex" : "none";
  };
  const message = (text: string) => { status.textContent = text; };
  show(false);
  return { controls, message, panel, show };
};

const addButton = (panel: HTMLElement, label: string, action: () => void) => {
  const control = document.createElement("button");
  control.textContent = label;
  control.addEventListener("click", action);
  panel.append(control);
  return control;
};

const addSelect = (
  panel: HTMLElement,
  label: string,
  options: HTMLOptionElement[],
  onChange: (value: string) => void
) => {
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  for (const option of options) select.add(option);
  select.addEventListener("change", () => onChange(select.value));
  panel.append(select);
};

const createSeekSlider = (panel: HTMLElement, player: ScenePlayer) => {
  const seek = document.createElement("input");
  seek.type = "range";
  seek.min = "0";
  seek.max = String(player.state().duration);
  seek.step = ".01";
  seek.setAttribute("aria-label", "Replay position");
  seek.addEventListener("input", () => player.seek(Number(seek.value)));
  panel.append(seek);
  return seek;
};

const toggleLabel = (player: ScenePlayer) => {
  if (player.state().playing) return "Pause replay";
  return "Play replay";
};

interface PlaybackControlsOptions {
  panel: HTMLElement;
  player: ScenePlayer;
  report: SceneReplay;
  segment: number;
  onIsland: (segment: number) => void;
}

/** Play/pause, seek, speed, island segment and exit controls; returns the position updater. */
export const addPlaybackControls = ({ onIsland, panel, player, report, segment }: PlaybackControlsOptions) => {
  const toggle = addButton(panel, "Pause replay", () => {
    player.toggle();
    toggle.textContent = toggleLabel(player);
  });
  const seek = createSeekSlider(panel, player);
  const speeds = SCENE_REPLAY_SPEEDS.map(value => new Option(`${value}×`, String(value), false, value === 1));
  addSelect(panel, "Replay speed", speeds, value => player.setSpeed(Number(value)));
  const islands = report.segments.map((entry, index) =>
    new Option(`${index + 1}: ${entry.island}`, String(index), false, index === segment));
  addSelect(panel, "Replay island segment", islands, value => onIsland(Number(value)));
  addButton(panel, "Exit replay", () => window.close());
  return () => {
    if (document.activeElement !== seek) seek.value = String(player.state().position);
    toggle.textContent = toggleLabel(player);
  };
};

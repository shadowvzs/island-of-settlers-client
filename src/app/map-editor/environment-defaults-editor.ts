import { type EnvironmentDefaults,validEnvironmentDefaults } from "../../shared/world/environment-defaults";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore } from "./section-store";

/** The weather choice of authored defaults. */
export const toWeatherChoice = (value: EnvironmentDefaults | undefined) => {
  if (value?.rain) return "rain";
  if (value?.snow) return "snow";
  return "clear";
};

/** Authors defaults only. The running scene and restored game weather remain untouched. */
export const createEnvironmentDefaultsEditor = (world: WorldData, history: EditorHistory,
  store: EditorStore, onEdit: () => boolean | void) => {
  const section = createSectionStore({ cycling: false, hour: "12", status: "" as EditorText, weather: "clear" });
  const render = () => {
    const value = world.environmentDefaults;
    section.update({
      cycling: value?.cycling ?? false,
      hour: String(value?.hour ?? 12),
      status: value ? M.hints.timeAuthored : M.hints.timeNormal,
      weather: toWeatherChoice(value)
    });
  };
  const change = (apply: boolean) => {
    const { cycling, weather } = section.get();
    const value = { hour: section.valueAsNumber("hour"), cycling, rain: weather === "rain", snow: weather === "snow" };
    if (apply && (!section.reportValidity("hour") || !validEnvironmentDefaults(value))) {
      store.setHint(M.hints.weatherInvalid, true); return;
    }
    if (!apply && !world.environmentDefaults) return;
    if (onEdit() === false) return;
    history.begin();
    if (apply) world.environmentDefaults = value;
    else delete world.environmentDefaults;
    history.endStroke(); render();
    store.setHint(apply ? M.hints.timeApplied : M.hints.timeRemoved);
  };
  history.subscribe(render); render();
  return {
    apply: () => change(true),
    reset: () => change(false),
    section,
    setCycling: (cycling: boolean) => section.update({ cycling })
  };
};

export type EnvironmentDefaultsEditor = ReturnType<typeof createEnvironmentDefaultsEditor>;

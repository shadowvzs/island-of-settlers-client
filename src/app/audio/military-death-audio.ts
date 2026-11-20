import type { MilitaryDeathEffect } from "../../shared/settlement/military-combat-rules";
import { settingsStorage } from "../settings/graphics-settings";
import { audioLevels } from "./audio-levels";

/** Original voiced/formant synthesis; no sampled copyrighted game sounds. */
export const createMilitaryDeathAudio = () => {
  let context: AudioContext | undefined, voices = 0;
  const heard = new Set<number>();
  const events = new AbortController();
  document.addEventListener("pointerdown", () => {
    if (!settingsStorage.readSound()) return;
    context ??= new AudioContext();
    void context.resume().catch(() => {});
  }, { signal: events.signal });
  const scream = () => {
    if (!context || context.state !== "running" || voices >= 4) return;
    voices++;
    const start = context.currentTime, duration = .65;
    const oscillator = context.createOscillator(), envelope = context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(240, start);
    oscillator.frequency.exponentialRampToValueAtTime(145, start + duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(
      .045 * settingsStorage.readEnvironmentVolume() * audioLevels.getSnapshot().master, start + .045);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    envelope.connect(context.destination);
    const filters = [750, 1200, 2500].map(frequency => {
      const filter = context!.createBiquadFilter(); filter.type = "bandpass";
      filter.frequency.value = frequency; filter.Q.value = 5;
      oscillator.connect(filter); filter.connect(envelope); return filter;
    });
    oscillator.onended = () => {
      voices--; oscillator.disconnect(); envelope.disconnect();
      for (const filter of filters) filter.disconnect();
    };
    oscillator.start(start); oscillator.stop(start + duration);
  };
  return {
    update: (deaths: readonly MilitaryDeathEffect[]) => {
      const active = new Set(deaths.map(death => death.id));
      for (const id of heard) if (!active.has(id)) heard.delete(id);
      for (const death of deaths) {
        if (heard.has(death.id)) continue;
        heard.add(death.id);
        if (death.age < .25 && settingsStorage.readSound()) scream();
      }
    },
    dispose: () => { events.abort(); void context?.close(); heard.clear(); }
  };
};

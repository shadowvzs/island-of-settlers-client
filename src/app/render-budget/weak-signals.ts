import { BATTERY_EVENTS, LOW_BATTERY_LEVEL } from "./constants";

interface BatteryLike extends EventTarget {
  charging: boolean;
  level: number;
}

interface PressureRecordLike {
  state: "critical" | "fair" | "nominal" | "serious";
}

interface PressureObserverLike {
  disconnect(): void;
  observe(source: "cpu"): Promise<void>;
}

type PressureObserverConstructor = new (callback: (records: PressureRecordLike[]) => void) => PressureObserverLike;

/** Only a discharging, nearly empty battery counts; a missing API is no signal. */
const watchBattery = (onChange: (low: boolean) => void) => {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery;
  if (typeof getBattery !== "function") return () => undefined;
  let battery: BatteryLike | undefined;
  let stopped = false;
  const update = () => { if (battery) onChange(!battery.charging && battery.level <= LOW_BATTERY_LEVEL); };
  const attach = (found: BatteryLike) => {
    if (stopped) return;
    battery = found;
    for (const event of BATTERY_EVENTS) found.addEventListener(event, update);
    update();
  };
  getBattery.call(navigator).then(attach, () => undefined);
  return () => {
    stopped = true;
    for (const event of BATTERY_EVENTS) battery?.removeEventListener(event, update);
  };
};

/** Compute Pressure (Chromium, `cpu` only): "serious" or "critical" is a thermal / load hint. */
const watchPressure = (onChange: (high: boolean) => void) => {
  const Observer = (globalThis as { PressureObserver?: PressureObserverConstructor }).PressureObserver;
  if (typeof Observer !== "function") return () => undefined;
  const observer = new Observer(records => {
    const state = records[records.length - 1]?.state;
    onChange(state === "serious" || state === "critical");
  });
  observer.observe("cpu").catch(() => undefined);
  return () => observer.disconnect();
};

/**
 * C13 weak signals: a low battery or high CPU pressure only stops the controller from raising its
 * levers again; they never force a decrease on their own.
 */
export const watchWeakSignals = (setIncreasesBlocked: (blocked: boolean) => void) => {
  let lowBattery = false;
  let highPressure = false;
  const update = () => setIncreasesBlocked(lowBattery || highPressure);
  const stopBattery = watchBattery(low => { lowBattery = low; update(); });
  const stopPressure = watchPressure(high => { highPressure = high; update(); });
  return () => {
    stopBattery();
    stopPressure();
  };
};

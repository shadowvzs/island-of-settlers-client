import { createExternalStore } from "../components/ui-store";
import { notificationPreferences } from "./preferences";

export type ToastKind = "error" | "warning" | "success" | "info";
export interface ToastOptions {
  /** Routine notifications are intentionally silent. Callers must classify important events explicitly. */
  important?: boolean;
  durationMs?: number;
  dedupeKey?: string;
}
export interface ToastMessage {
  id: number;
  kind: ToastKind;
  message: string;
  key: string;
  count: number;
  exiting: boolean;
}
const MAX_VISIBLE = 3, DEFAULT_DURATION = 4000, FADE_DURATION = 180;

/** Ephemeral presentation service; no game/save state, polling, retained history or React timers. */
export const createToastService = (enabled: () => boolean = () => true) => {
  const store = createExternalStore<readonly ToastMessage[]>([]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextId = 1, disposed = false;
  const cancelTimer = (id: number) => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  };
  const remove = (id: number) => {
    cancelTimer(id); store.set(store.getSnapshot().filter(toast => toast.id !== id));
  };
  const dismiss = (id: number) => {
    if (disposed || !store.getSnapshot().some(toast => toast.id === id && !toast.exiting)) return;
    cancelTimer(id);
    store.set(store.getSnapshot().map(toast => toast.id === id ? { ...toast, exiting: true } : toast));
    timers.set(id, setTimeout(() => remove(id), FADE_DURATION));
  };
  const show = (kind: ToastKind, text: string, options: ToastOptions = {}) => {
    if (disposed || !enabled() || options.important !== true) return null;
    const message = text.trim().slice(0, 300);
    if (!message) return null;
    const key = (options.dedupeKey ?? `${kind}:${message}`).slice(0, 350);
    const previous = store.getSnapshot().find(toast => toast.key === key && toast.kind === kind);
    if (previous) {
      if (!previous.exiting) store.set(store.getSnapshot().map(toast => toast.id === previous.id
        ? { ...toast, count: Math.min(99, toast.count + 1) } : toast));
      return previous.id;
    }
    const id = nextId++;
    const toast: ToastMessage = { id, kind, key, message, count: 1, exiting: false };
    cancelTimer(id);
    const rows = store.getSnapshot().filter(row => row.id !== id);
    while (rows.length >= MAX_VISIBLE) cancelTimer(rows.shift()!.id);
    store.set([...rows, toast]);
    let duration = DEFAULT_DURATION;
    if (Number.isFinite(options.durationMs)) duration = Math.max(3000, Math.min(6000, options.durationMs!));
    timers.set(id, setTimeout(() => dismiss(id), duration));
    return id;
  };
  const clear = () => {
    for (const id of timers.keys()) cancelTimer(id);
    store.set([]);
  };
  return { ...store, show, dismiss, clear,
    error: (message: string, options?: ToastOptions) => show("error", message, options),
    warning: (message: string, options?: ToastOptions) => show("warning", message, options),
    success: (message: string, options?: ToastOptions) => show("success", message, options),
    info: (message: string, options?: ToastOptions) => show("info", message, options),
    dispose: () => { if (disposed) return; clear(); disposed = true; }
  };
};
export const notifications = createToastService(notificationPreferences.getSnapshot);
notificationPreferences.subscribe(() => { if (!notificationPreferences.getSnapshot()) notifications.clear(); });

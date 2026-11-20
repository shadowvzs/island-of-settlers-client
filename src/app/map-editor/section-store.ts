import { createExternalStore, type ExternalStore,isShallowEqual } from "../components/ui-store";
import type { EditorText } from "./messages";

/** An option of an editor select: its value (the select's value), its text and its nation association. */
export interface FieldOption {
  label: EditorText;
  /** Nations whose homeland typically shows this option (native option tooltip, NATION-TERRAIN). */
  nations?: readonly string[];
  value: string;
}

/** Options whose value is also their text (the authoring selects). */
export const toTextOptions = (values: readonly string[]): readonly FieldOption[] =>
  values.map(value => ({ label: value, value }));

/**
 * The value a rebuilt select shows: the previous choice while it is still offered, else the first option
 * (as a native select does after its options are replaced), "" without options.
 */
export const keepOption = (options: readonly FieldOption[], previous: string) =>
  options.some(option => option.value === previous) ? previous : options[0]?.value ?? "";

/** A field of a section snapshot: the text value of one of its inputs or selects. */
export type SectionField<T> = { [K in keyof T]: T[K] extends string | EditorText ? K : never }[keyof T] & string;

type FieldElement = HTMLInputElement | HTMLSelectElement;

/** `valueAsNumber` of a number input's text: NaN when empty or not a number. */
export const toValueAsNumber = (value: string) => (value.trim() === "" ? NaN : Number(value));

/** A whole number within the bounds; an empty or invalid text counts as 0 (authoring number fields). */
export const toBoundedWhole = (value: string, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

/**
 * The view state of an editor section (React-free, read with `useSyncExternalStore`): what its DOM used
 * to hold (status texts, list options, disabled flags, input values). Controllers keep their logic and
 * write here instead of into elements; rendered inputs register themselves so the controller can still
 * run the browser's own validation (`reportValidity`) before it acts.
 */
export const createSectionStore = <T extends object>(initial: T) => {
  const store: ExternalStore<T> = createExternalStore(initial);
  const elements = new Map<string, FieldElement>();
  const binders = new Map<string, (element: FieldElement | null) => void>();
  const get = store.getSnapshot;
  const text = (name: SectionField<T>) => get()[name] as string;
  const update = (change: Partial<T>) => {
    const next = { ...get(), ...change };
    if (!isShallowEqual(next, get())) store.set(next);
  };
  return {
    ...store,
    /** The ref callback of a rendered field (stable per name). */
    bind: (name: SectionField<T>) => {
      let binder = binders.get(name);
      if (!binder) {
        binder = element => (element ? elements.set(name, element) : elements.delete(name));
        binders.set(name, binder);
      }
      return binder;
    },
    get,
    /** The field as a bounded whole number (empty or invalid: 0). */
    number: (name: SectionField<T>, min: number, max: number) => toBoundedWhole(text(name), min, max),
    /** The browser's validation of the rendered fields (shows its message); true while not rendered. */
    reportValidity: (...names: SectionField<T>[]) =>
      names.every(name => elements.get(name)?.reportValidity() ?? true),
    update,
    valueAsNumber: (name: SectionField<T>) => toValueAsNumber(text(name))
  };
};

export type SectionStore<T extends object> = ReturnType<typeof createSectionStore<T>>;

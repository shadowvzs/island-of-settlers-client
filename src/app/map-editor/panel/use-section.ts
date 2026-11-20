import { useExternalStore } from "../../components/external-store";
import type { SectionField, SectionStore } from "../section-store";
import type { BoundFieldProps } from "./fields";

/**
 * A section's snapshot and the props binding a field to it: value, change and the ref that lets the
 * controller run the browser's validation on the rendered input.
 */
export const useSection = <T extends object>(section: SectionStore<T>) => {
  const view = useExternalStore(section);
  const field = (name: SectionField<T>): BoundFieldProps => ({
    inputRef: section.bind(name),
    value: view[name] as string,
    onChange: value => section.update({ [name]: value } as Partial<T>)
  });
  return { field, view };
};

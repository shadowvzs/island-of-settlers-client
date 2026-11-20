import type { GrowthFrame } from "./tree-growth";

/** How the static (world) instance of a tree is drawn: its world variant, mature, or not at all. */
export type StaticTreeForm = "hidden" | "mature" | "world";

/**
 * Keeps the renderers' static tree instances in step with the growth: hidden while a tree grows
 * (a stage layer draws it), mature once it is grown, the world variant otherwise. Re-syncs only
 * when the growth revision changed and calls `apply` only for trees whose form changes, so a
 * finishing tree turns into the mature instance in the same frame (no pop).
 */
export const createStaticTreeForms = (apply: (id: number, form: StaticTreeForm) => void) => {
  const forms = new Map<number, StaticTreeForm>();
  let revision = -1;

  const set = (id: number, form: StaticTreeForm) => {
    if ((forms.get(id) ?? "world") === form) return;
    apply(id, form);
    if (form === "world") forms.delete(id);
    else forms.set(id, form);
  };

  const sync = (growth: GrowthFrame) => {
    if (growth.revision() === revision) return;
    revision = growth.revision();
    for (const tree of growth.growing()) set(tree.id, "hidden");
    for (const id of growth.grownIds()) set(id, "mature");
    for (const id of Array.from(forms.keys())) {
      if (!growth.isGrowing(id) && !growth.isGrown(id)) set(id, "world");
    }
  };

  return { sync };
};

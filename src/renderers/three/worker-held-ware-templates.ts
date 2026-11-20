import type { Object3D } from "three";

interface HeldWareTemplate {
  refs: number;
  root: Object3D;
}

/**
 * GPU-LIFECYCLE-03: every worker body built its own merged geometry for every ware it ever carried
 * and kept it in its prop cache, so GPU memory grew with bodies × ware types. Static held wares are
 * now one template per key; bodies hold clones that share its geometry and the shared ware
 * materials. The template (geometry, owned materials) is disposed with its last clone.
 */
const templates = new Map<string, HeldWareTemplate>();

export const acquireHeldWareClone = (
  key: string,
  create: () => Object3D,
  disposeTemplate: (root: Object3D) => void
) => {
  let template = templates.get(key);
  if (!template) {
    template = { refs: 0, root: create() };
    templates.set(key, template);
  }
  const owner = template;
  owner.refs++;
  const clone = owner.root.clone(true);
  let released = false;
  clone.userData.releaseHeldWare = () => {
    if (released) return;
    released = true;
    if (--owner.refs > 0) return;
    templates.delete(key);
    disposeTemplate(owner.root);
  };
  return clone;
};

/** Live templates (receipts and tests). */
export const heldWareTemplateCount = () => templates.size;

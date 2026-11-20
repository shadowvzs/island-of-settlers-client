import { Group, Mesh, type MeshStandardMaterial } from "three";
import { expect, it, vi } from "vitest";

import { adventureBanditStyle } from "../src/render-common/workers/adventure-bandit-style";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createWorkerBanditAccessories } from "../src/renderers/three/worker-bandit-accessories";

it.each([false, true])("releases each shared bandit kit lease once (detailed=%s)", detailed => {
  const create = () => {
    const body = new Group(), head = new Group(); head.name = "Head"; body.add(head);
    return { body, head, accessories: createWorkerBanditAccessories(body, detailed) };
  };
  const a = create(), b = create();
  const frame = { fall: .2, fallenBandit: adventureBanditStyle(1, "forest") } as WorkerFrame;
  a.accessories.update(frame); b.accessories.update(frame);
  const mesh = b.head.getObjectByProperty("type", "Mesh") as Mesh;
  const other = a.head.getObjectByProperty("type", "Mesh") as Mesh;
  expect(mesh.geometry).toBe(other.geometry); expect(mesh.material).toBe(other.material);
  const material = mesh.material as MeshStandardMaterial;
  const resources = [mesh.geometry, material, material.map!, material.normalMap, material.roughnessMap].filter(Boolean);
  const released = resources.map(resource => { const event = vi.fn(); resource!.addEventListener("dispose", event); return event; });
  try {
    a.accessories.dispose(); a.accessories.dispose();
    for (const event of released) expect(event).not.toHaveBeenCalled();
    a.accessories.update(frame);
    expect(a.head.children).toHaveLength(0);
    b.accessories.update(frame);
    expect(mesh.parent?.parent).toBe(b.head);
    b.accessories.dispose(); b.accessories.dispose();
    for (const event of released) expect(event).toHaveBeenCalledOnce();
  } finally { a.accessories.dispose(); b.accessories.dispose(); }
});

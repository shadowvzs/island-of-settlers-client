import { measureNationalHeadFit, nationalHeadBindSpace, placeNationalHeadwear } from "@workers/national-headwear-fit";
import { createNationalWorkerHeadwear, type NationalHeadwear } from "@workers/national-worker-headwear";
import type { Group, Object3D } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";

type Identity = Pick<WorkerFrame, "actorId" | "propNation" | "nation" | "armourRank" | "combat" | "fallenBandit">;
/** Cosmetic selection only. Stable simulation IDs never change the body, job, rig, inventory or animation. */
export const nationalHeadwearFor = (frame: Identity): NationalHeadwear | undefined => {
  if (frame.actorId === undefined || frame.armourRank || frame.combat || frame.fallenBandit) return;
  const nation = frame.propNation ?? frame.nation, id = Math.abs(frame.actorId);
  if (nation === "chinese" && id % 4 === 0) return id % 8 === 0 ? "chinese-conical" : "chinese-folded";
  if (nation === "indigenous" && id % 4 === 1) return "indigenous-headband";
};

interface SharedHeadwear { refs: number; model: ReturnType<typeof createNationalWorkerHeadwear> }
const kits = new Map<string, SharedHeadwear>();
const acquire = (style: NationalHeadwear, detailed: boolean) => {
  const key = `${style}:${detailed}`, known = kits.get(key);
  if (known) { known.refs++; return { key, kit: known }; }
  const kit = { refs: 1, model: createNationalWorkerHeadwear(style, detailed) };
  kits.set(key, kit); return { key, kit };
};
const release = (key: string | undefined) => {
  if (!key) return;
  const kit = kits.get(key); if (!kit) return;
  if (--kit.refs === 0) { kit.model.dispose(); kits.delete(key); }
};

/** Attach in the loaded body's bind pose; subsequent head turns move the rigid accessory naturally. */
export const createWorkerNationalHeadwear = (body: Object3D, detailed: boolean) => {
  const head = body.getObjectByName("Head");
  const fit = head ? measureNationalHeadFit(body, head) : undefined;
  const space = head ? nationalHeadBindSpace(body, head) : undefined;
  let worn: NationalHeadwear | undefined, key: string | undefined, accessory: Group | undefined;
  return {
    update: (frame: Identity) => {
      const style = nationalHeadwearFor(frame);
      if (!style || !head || !fit || !space) { if (accessory) accessory.visible = false; return; }
      if (style !== worn) {
        accessory?.removeFromParent(); release(key);
        const shared = acquire(style, detailed); key = shared.key;
        accessory = shared.kit.model.root.clone(true); worn = style;
        placeNationalHeadwear(body, head, accessory, fit, style === "chinese-conical",
          style === "indigenous-headband", space);
      }
      accessory!.visible = true;
    },
    dispose: () => { accessory?.removeFromParent(); release(key); key = undefined; }
  };
};

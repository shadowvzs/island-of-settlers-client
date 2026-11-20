import { Group, Mesh, type MeshStandardMaterial, Quaternion } from "three";

import { DEFAULT_WORKER_COLOR, getWorkerColorHex } from "../../../render-common/workers/worker-colors";
import type { WorkerAppearance, WorkerNation } from "../../../render-common/workers/worker-unit";
import type { ExplorationBodyLoader, ExplorationLoadedBody } from "../exploration/exploration-appearance";
import { meshMaterials } from "../three-mesh-resources";
import { createWorkerWorkHats } from "../worker-work-hats";
import { type BoatPersonPose,createBoatWorkerPose } from "./boat-worker-pose";

export interface BoatPersonFrame extends BoatPersonPose {
  identity: number;
  appearance?: WorkerAppearance;
  nation?: WorkerNation;
  visible: boolean;
  opacity?: number;
  preload?: boolean;
}
/** Actual crowd body leases; the crowd owns its source pack, textures and clips throughout. */
export const createSmallBoatPeople = (detailed: boolean) => {
  const hats = createWorkerWorkHats(detailed), members = new Set<ReturnType<typeof create>>();
  const pending = new Set<Promise<void>>();
  let loader: ExplorationBodyLoader | undefined, appearances: readonly WorkerAppearance[] = [];
  let unsubscribe: (() => void) | undefined, color: string = getWorkerColorHex(DEFAULT_WORKER_COLOR), disposed = false;
  let failures = 0;
  const choose = (frame: BoatPersonFrame) => {
    if (frame.appearance) return { ...frame.appearance };
    const national = frame.nation ? appearances.filter(item => item.nation === frame.nation) : appearances;
    const pool = national.length ? national : appearances;
    const appearance = pool[frame.identity % Math.max(1, pool.length)];
    return appearance ? { ...appearance } : undefined;
  };
  const create = (parent: Group, role: "paddler" | "passenger") => {
    const root = new Group(); root.name = `canonical_boat_${role}`; parent.add(root);
    let body: ExplorationLoadedBody | undefined, pose: ReturnType<typeof createBoatWorkerPose> | undefined;
    let hat: ReturnType<typeof hats.create> | undefined, latest: BoatPersonFrame | undefined;
    let key = "", token = 0, dead = false;
    const tint = () => body?.root.traverse(object => {
      if (object instanceof Mesh) for (const material of meshMaterials(object))
        if (material.name === "tunic_team_linen") (material as MeshStandardMaterial).color.set(color);
    });
    const clear = () => {
      token++; key = ""; hat?.dispose(); hat = undefined;
      body?.dispose(); body = undefined; pose = undefined;
    };
    const show = () => {
      root.visible = Boolean(latest?.visible && body);
      if (!latest || !body || !pose) return;
      const opacity = latest.opacity ?? 1;
      root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        for (const material of meshMaterials(object)) {
          material.opacity = opacity; material.transparent = opacity < 1; material.depthWrite = opacity >= 1;
        }
      });
      if (root.visible) pose.update(latest);
    };
    const update = (frame: BoatPersonFrame) => {
      latest = frame;
      const appearance = choose(frame), next = appearance ? `${appearance.nation}:${appearance.variant}` : "";
      if ((frame.visible || frame.preload) && !disposed && !dead && loader && appearance && next !== key) {
        clear(); key = next; const request = ++token;
        const load = loader.load(appearance).then(loaded => {
          if (dead || disposed || request !== token) { loaded.dispose(); return; }
          body = loaded; root.add(body.root);
          try {
            pose = createBoatWorkerPose(body.root, body.clips);
            body.root.traverse(object => { if (object instanceof Mesh) { object.castShadow = detailed; object.receiveShadow = true; } });
            // Keep authored population headcloth intact; it is already the canonical national hat.
            const authoredVariant = (body.entry as { variant?: string } | undefined)?.variant ?? appearance.variant;
            // A fisher keeps the same visible body across the shore/seat handoff.
            if (role === "paddler" && !latest?.fisherMotion && !/headcloth/.test(authoredVariant)) {
              const head = body.root.getObjectByName("Head");
              if (head) {
                const bodyRotation = new Quaternion(), headRotation = new Quaternion();
                body.root.updateWorldMatrix(true, true);
                const rest = body.root.getWorldQuaternion(bodyRotation).invert()
                  .multiply(head.getWorldQuaternion(headRotation)).invert();
                hat = hats.create(appearance.nation); hat.root.quaternion.copy(rest); head.add(hat.root);
              }
            }
            tint(); show();
          } catch (error) { failures++; clear(); console.warn("Boat population pose could not load", error); }
          return undefined;
        }).catch(error => {
          if (dead || disposed || request !== token) return;
          failures++; key = ""; console.warn("Boat population body could not load", error);
        });
        pending.add(load); void load.finally(() => pending.delete(load));
      }
      show();
    };
    const member = { root, update, reset: clear, tint,
      handWorld: (target: import("three").Vector3) => {
        const hand = body?.root.getObjectByName("socket_hand_R");
        return hand ? hand.getWorldPosition(target) : undefined;
      },
      source: () => body?.entry ? JSON.stringify(body.entry) : "",
      loaded: () => Boolean(body), visible: () => root.visible, role,
      gripError: () => pose?.gripError() ?? 0,
      dispose: () => { if (dead) return; dead = true; clear(); root.removeFromParent(); members.delete(member); } };
    members.add(member); return member;
  };
  return {
    create,
    setSource: (source: ExplorationBodyLoader, population: readonly WorkerAppearance[]) => {
      unsubscribe?.(); loader = source; appearances = population.map(item => ({ ...item }));
      members.forEach(member => member.reset());
      unsubscribe = source.onSourceChange?.(() => members.forEach(member => member.reset()));
    },
    setColor: (value: string) => { color = value; members.forEach(member => member.tint()); },
    whenReady: async () => { while (pending.size) await Promise.allSettled(pending); },
    stats: () => ({ boatPeopleSources: [...new Set([...members].map(member => member.source()).filter(Boolean))].join("|"),
      boatPeople: members.size, boatPeopleLoaded: [...members].filter(member => member.loaded()).length,
      boatPaddlersVisible: [...members].filter(member => member.role === "paddler" && member.visible()).length,
      boatPassengersVisible: [...members].filter(member => member.role === "passenger" && member.visible()).length,
      boatPeoplePending: pending.size, boatPeopleFailures: failures,
      boatGripError: Math.max(0, ...[...members].map(member => member.gripError())) }),
    dispose: () => { if (disposed) return; disposed = true; unsubscribe?.();
      [...members].forEach(member => member.dispose()); hats.dispose(); }
  };
};
export type SmallBoatPeople = ReturnType<typeof createSmallBoatPeople>;
export type SmallBoatPerson = ReturnType<SmallBoatPeople["create"]>;

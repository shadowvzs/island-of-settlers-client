import { createNativeDeformationHelpers } from "@workers/native-deformation-helpers";
import { createPhysicalHandGrip } from "@workers/physical-hand-grip";
import { actionToolGrip } from "@workers/worker-action-contacts";
import { referenceFellingGrip, referenceFellingElbowPole, usesReferenceFelling } from "@workers/reference-felling";
import { Mesh, type AnimationClip, type BufferGeometry, type Object3D, Quaternion, Vector3 } from "three";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";

/** Opt-in authored characters finish their grips against the prop after its real placement. */
export const createNativeHandContacts = (root: Object3D, clips: readonly AnimationClip[]) => {
  const durations = new Map(clips.map(clip => [clip.name, clip.duration]));
  let physical = false;
  root.traverse(object => { physical ||= object.userData.physicalHandGrip === true; });
  const native = createNativeDeformationHelpers(root);
  const grip = physical ? createPhysicalHandGrip(root) : undefined;
  const referenceFelling = usesReferenceFelling(root);
  const contacts: Array<NonNullable<ReturnType<ReturnType<typeof createPhysicalHandGrip>>> & { id: string; side: string }> = [];
  const owned: Array<{ mesh: Mesh; original: BufferGeometry; fitted: BufferGeometry }> = [];
  const fitted = new WeakSet<Object3D>();
  const vector = new Vector3(), rotation = new Quaternion();
  const fitRomanHilt = (prop: Object3D) => {
    if (fitted.has(prop)) return;
    prop.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const original = object.geometry, geometry = original.clone(), positions = geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) if (positions.getY(i) >= -.068 && positions.getY(i) <= .016) {
        positions.setX(i, positions.getX(i) * .65); positions.setZ(i, positions.getZ(i) * .65);
      }
      geometry.computeVertexNormals(); object.geometry = geometry;
      owned.push({ mesh: object, original, fitted: geometry });
    });
    fitted.add(prop);
  };
  const finish = (frame: WorkerFrame, props: readonly Object3D[], baked = false) => {
    contacts.length = 0;
    if (baked || !physical && !native.count) return;
    if (grip) for (const prop of props) {
      const id = String(prop.userData.workerHeldId ?? "");
      if (!prop.visible || !prop.parent) continue;
      if (frame.combat && id === "sword" && frame.nation === "roman") fitRomanHilt(prop);
      prop.updateWorldMatrix(true, true);
      const shaft = vector.set(0, 1, 0).applyQuaternion(prop.getWorldQuaternion(rotation)).clone();
      const record = (side: "Left" | "Right", target: Vector3, axis: Vector3, radius: number) => {
        const pole=referenceFelling&&frame.action==="chop_tree"?referenceFellingElbowPole(root,side):undefined;
        const result = grip(side, target, axis, radius, pole); if (result) contacts.push({ ...result, id, side });
      };
      if (frame.combat) {
        if (id === "sword") record("Right", prop.localToWorld(new Vector3(0, frame.nation === "roman" ? -.028 : 0, 0)), shaft, .012);
        else if (id === "shield") record("Left", prop.getWorldPosition(new Vector3()), shaft, .009);
        else if (id === "axe") {
          record("Right", prop.localToWorld(new Vector3()), shaft, .015);
          record("Left", prop.localToWorld(new Vector3(0, -.15, 0)), shaft, .015);
        }
        continue;
      }
      if (!["axe", "hammer", "shovel", "pickaxe"].includes(id) || !["chop_tree", "dig", "build_hammer"].includes(frame.action)) continue;
      const clipDuration = durations.get(frame.action);
      if (!clipDuration) continue;
      const phase = (frame.animationTime % clipDuration) / clipDuration;
      for (const [side, key] of [["Right", "R"], ["Left", "L"]] as const) {
        if (side === "Left" && frame.action === "build_hammer") continue;
        const palm = actionToolGrip(frame.action, key, phase);
        const along = referenceFelling && frame.action === "chop_tree" ? referenceFellingGrip(side, phase) : palm[1];
        record(side, prop.localToWorld(new Vector3(0, along, 0)), shaft, .012);
      }
    }
    native.update();
  };
  return { enabled: physical || native.count > 0, contacts: () => contacts, finish, dispose: () => {
    for (const item of owned) { item.mesh.geometry = item.original; item.fitted.dispose(); }
    owned.length = 0;
  } };
};

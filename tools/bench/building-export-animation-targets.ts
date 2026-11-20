import { type AnimationClip, Group, type Object3D, PropertyBinding, QuaternionKeyframeTrack } from "three";

/** Visible-only GLB export must retain animated empty anchors without exposing hidden geometry. */
export const prepareBuildingExportAnimationTargets = (input: Object3D | Object3D[], clips: AnimationClip[] = []) => {
  const changed = new Set<Object3D>(), roots = Array.isArray(input) ? input : [input];
  const animations = clips.map(clip => clip.clone()), proxies = new Map<Object3D, Group>();
  try {
    for (const clip of animations) for (const [index, track] of clip.tracks.entries()) {
      const binding = PropertyBinding.parseTrackName(track.name);
      const target = roots.map(root => PropertyBinding.findNode(root, binding.nodeName)).find(Boolean) as Object3D | undefined;
      if (!target) {
        if (binding.propertyName === "morphTargetInfluences")
          throw new Error(`Missing export morph target: ${clip.name}/${track.name}`);
        continue;
      }
      let owner: Object3D | null = target, hidden = false;
      for (let node: Object3D | null = target; node; node = node.parent) hidden ||= !node.visible;
      while (owner?.parent && owner.userData.buildingId === undefined) owner = owner.parent;
      if (hidden && owner?.userData.buildingId === 35) {
        // Well doors are intentionally hidden in the runtime. Export their legacy channels on
        // an empty anchor, preserving clip timelines without exporting the invisible door mesh.
        let proxy = proxies.get(owner);
        if (!proxy) {
          proxy = new Group(); proxy.name = `${owner.name}_hidden_door_anchor`;
          proxy.userData.exportHiddenDoorAnchor = true; owner.add(proxy); proxies.set(owner, proxy);
        }
        if (binding.propertyName === "morphTargetInfluences") {
          const values = new Float32Array(track.times.length * 4);
          for (let at = 3; at < values.length; at += 4) values[at] = 1;
          clip.tracks[index] = new QuaternionKeyframeTrack(`${proxy.name}.quaternion`, track.times, values,
            track.getInterpolation());
        } else track.name = track.name.replace(binding.nodeName, proxy.name);
        continue;
      }
      if (!target.visible && target.type === "Group" && target.children.length === 0) {
        target.visible = true; changed.add(target);
      }
    }
  } catch (error) {
    for (const target of changed) target.visible = false;
    for (const proxy of proxies.values()) proxy.removeFromParent();
    throw error;
  }
  return { animations, restore: () => {
    for (const target of changed) target.visible = false; changed.clear();
    for (const proxy of proxies.values()) proxy.removeFromParent(); proxies.clear();
  } };
};

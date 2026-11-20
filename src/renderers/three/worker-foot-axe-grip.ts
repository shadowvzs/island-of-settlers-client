import { Object3D, Quaternion } from "three";

import grips from "../../render-common/workers/viking-foot-axe-grips.json";
import { createFootAxeContactAlignment } from "./foot-axe-contact";

/** Offline fits are guarded against each original model/actions SHA in the source-rig tests. */
export const createPreparedFootAxeGrip = (root: Object3D, variant: string) => {
  const profile = grips.profiles.find(profile => profile.variant === variant);
  if (!profile) return undefined;
  const fingers = profile.fingers.flatMap(finger => {
    const bone = root.getObjectByName(finger.bone);
    return bone ? [{ bone, grip: new Quaternion().fromArray(finger.quaternion), original: new Quaternion() }] : [];
  });
  if (fingers.length !== 30 || profile.sockets.some(socket => !root.getObjectByName(socket.hand))) return undefined;
  const sockets = profile.sockets.map(contact => {
    const socket = new Object3D(); socket.name = contact.name; socket.position.fromArray(contact.position);
    root.getObjectByName(contact.hand)!.add(socket); return socket;
  });
  return { fingers, sockets, alignContacts: createFootAxeContactAlignment(root, sockets) };
};

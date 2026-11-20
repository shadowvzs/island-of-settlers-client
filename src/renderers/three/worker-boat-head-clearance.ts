import { Box3, Matrix4, type Object3D, type SkinnedMesh, Triangle, Vector3 } from "three";

/** A native head collider, measured once from the drawn skin in head-bone space. */
export const createBoatHeadClearance = (root: Object3D) => {
  const head = root.getObjectByName("Head"), bounds = new Box3();
  let measured = false;
  const center = new Vector3(), radius = new Vector3(), inverse = new Matrix4();
  const triangle = new Triangle(), closest = new Vector3(), normal = new Vector3(), zero = new Vector3();
  const worldTriangle = new Triangle(), proxyClosest = new Vector3(), proxyNormal = new Vector3();
  return (boat: Object3D, wall?: { x: number; z: number; yaw: number }) => {
    if (!head) return;
    root.updateMatrixWorld(true);
    if (!measured) {
      inverse.copy(head.matrixWorld).invert();
      const points: Vector3[] = [];
      root.traverse(object => {
        const mesh = object as SkinnedMesh;
        if (!mesh.isSkinnedMesh || !mesh.visible) return;
        const positions = mesh.geometry.attributes.position!, joints = mesh.geometry.attributes.skinIndex!, weights = mesh.geometry.attributes.skinWeight!;
        const drawn = mesh.geometry.index ? new Set(Array.from(mesh.geometry.index.array)) : Array.from({ length: positions.count }, (_, index) => index);
        for (const index of drawn) {
          let strongest = 0, bone = "";
          for (let slot = 0; slot < 4; slot++) if (weights.getComponent(index, slot) > strongest) {
            strongest = weights.getComponent(index, slot); bone = mesh.skeleton.bones[joints.getComponent(index, slot)]!.name;
          }
          if (bone === "Head") {
            const point = mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
            points.push(point); bounds.expandByPoint(point);
          }
        }
      });
      if (bounds.isEmpty()) return;
      bounds.getCenter(center); bounds.getSize(radius).multiplyScalar(.5);
      const extent = Math.max(...points.map(point => point.clone().sub(center).divide(radius).length()));
      radius.multiplyScalar(extent * 1.015);
      measured = true;
    }
    let hull: import("three").Mesh | undefined;
    boat.traverse(object => { if ((object as import("three").Mesh).isMesh && !hull) hull = object as import("three").Mesh; });
    if (!hull || !boat.parent) return;
    const geometry = hull.geometry, positions = geometry.attributes.position!, indices = geometry.index;
    // Move the load only as far as its actual head clearance requires. Arm contacts
    // are solved afterwards; the feet and the native body proportions stay fixed.
    for (let pass = 0; pass < 10; pass++) {
      root.updateMatrixWorld(true);
      inverse.copy(head.matrixWorld).invert().multiply(hull.matrixWorld);
      let distance = Infinity, proxyDistance = Infinity, wallGap = Infinity;
      const outward = wall ? new Vector3(Math.sin(wall.yaw), 0, Math.cos(wall.yaw)) : undefined;
      const wallOrigin = wall ? new Vector3(wall.x, 0, wall.z) : undefined;
      const proxyCenter = head.getWorldPosition(new Vector3()); proxyCenter.y += .055;
      for (let index = 0; index < (indices?.count ?? positions.count); index += 3) {
        const vertex = (slot: number, out: Vector3) => out.fromBufferAttribute(positions, indices ? indices.getX(index + slot) : index + slot)
          .applyMatrix4(inverse).sub(center).divide(radius);
        vertex(0, triangle.a); vertex(1, triangle.b); vertex(2, triangle.c);
        triangle.closestPointToPoint(zero, closest);
        if (closest.length() < distance) { distance = closest.length(); normal.copy(closest); }
        const worldVertex = (slot: number, out: Vector3) => out.fromBufferAttribute(positions, indices ? indices.getX(index + slot) : index + slot).applyMatrix4(hull!.matrixWorld);
        worldVertex(0, worldTriangle.a); worldVertex(1, worldTriangle.b); worldVertex(2, worldTriangle.c);
        if (outward && wallOrigin) for (const vertex of [worldTriangle.a, worldTriangle.b, worldTriangle.c])
          wallGap = Math.min(wallGap, vertex.clone().sub(wallOrigin).dot(outward));
        worldTriangle.closestPointToPoint(proxyCenter, proxyClosest);
        const gap = proxyClosest.distanceTo(proxyCenter);
        if (gap < proxyDistance) { proxyDistance = gap; proxyNormal.copy(proxyClosest).sub(proxyCenter); }
      }
      if (distance >= 1.015 && proxyDistance >= .092 && wallGap >= .001 || distance < 1e-6) break;
      normal.normalize().divide(radius).transformDirection(head.matrixWorld);
      const worldRadius = Math.min(radius.x, radius.y, radius.z) * head.getWorldScale(new Vector3()).x;
      const delta = normal.multiplyScalar(Math.max(0, (1.015 - distance) * worldRadius + .001));
      if (proxyDistance < .092) delta.add(proxyNormal.normalize().multiplyScalar(.093 - proxyDistance));
      if (outward) {
        const direction = delta.clone().normalize();
        const correction = Math.max(0, .001 - wallGap - delta.dot(outward));
        if (correction > 0) {
          delta.addScaledVector(outward, correction);
          const lost = Math.max(0, -outward.dot(direction) * correction);
          delta.y += Math.sign(direction.y || 1) * lost / Math.max(.2, Math.abs(direction.y));
        }
      }
      const origin = boat.getWorldPosition(new Vector3());
      boat.position.copy(boat.parent.worldToLocal(origin.add(delta)));
    }
  };
};

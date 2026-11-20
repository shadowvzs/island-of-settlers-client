import { Matrix4, Vector3 } from "three";

const caches = new WeakMap<object, Array<{ mesh: any; index: number; label: string; side: string }>>();
/** Signed distance of actual drawn finger skin to the rendered oar's polygonal shaft. */
export const fisherOarSurface = (body: any, boat: any) => {
  let vertices = caches.get(body);
  if (!vertices) {
    vertices = [];
    body.traverse((mesh: any) => {
      if (!mesh.isSkinnedMesh || !mesh.visible) return;
      const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
      const used = new Set<number>(mesh.geometry.index?.array ?? Array.from({ length: joints.count }, (_, i) => i));
      for (const index of used) {
        let weight = 0, joint = 0;
        for (let k = 0; k < 4; k++) if (weights.getComponent(index, k) > weight) {
          weight = weights.getComponent(index, k); joint = joints.getComponent(index, k);
        }
        const match = /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)/.exec(mesh.skeleton.bones[joint]!.name);
        if (match && weight >= .5) vertices!.push({ mesh, index, side: match[1]!, label: match[1]! + match[2]! });
      }
    });
    caches.set(body, vertices);
  }
  const shafts = new Map<string, { inverse: Matrix4; ring: number[][]; start: number; end: number; length: number; origin: number }>();
  for (const [index, side] of ["Left", "Right"].entries()) {
    const oar = boat.children.filter((object: any) => object.isMesh)[index + 1];
    oar.updateWorldMatrix(true, false);
    const positions = oar.geometry.getAttribute("position"), ring: number[][] = [];
    let start = 0, end = 0, length = Infinity;let origin=Infinity;for(let i=0;i<positions.count;i++)origin=Math.min(origin,positions.getZ(i));
    for (let i = 0; i < positions.count; i++) {
      const z = positions.getZ(i), x = positions.getX(i), y = positions.getY(i);
      if (Math.abs(z-origin) < 1e-8 && !ring.some(p => Math.hypot(p[0]! - x, p[1]! - y) < 1e-8)) {
        ring.push([x, y]); start = Math.hypot(x, y);
      }
      if (z > 0 && z < .8 && Math.hypot(x, y) < .025) { length = z; end = Math.hypot(x, y); }
    }
    ring.sort((a, b) => Math.atan2(a[1]!, a[0]!) - Math.atan2(b[1]!, b[0]!));
    shafts.set(side, { inverse: oar.matrixWorld.clone().invert(), ring, start, end, length, origin });
  }
  const result: Record<string, { minimumGap: number; penetratingVertices: number }> = {};
  const point = new Vector3();
  for (const mesh of new Set(vertices.map(vertex => vertex.mesh))) mesh.skeleton.update();
  for (const vertex of vertices) {
    const shaft = shafts.get(vertex.side)!;
    vertex.mesh.getVertexPosition(vertex.index, point).applyMatrix4(vertex.mesh.matrixWorld).applyMatrix4(shaft.inverse);
    if (point.z < shaft.origin || point.z > shaft.length) continue;
    const scale = (shaft.start + (shaft.end - shaft.start) * (point.z-shaft.origin) / (shaft.length-shaft.origin)) / shaft.start;
    let distance = Infinity, inside = true;
    for (let k = 0; k < shaft.ring.length; k++) {
      const a = shaft.ring[k]!, b = shaft.ring[(k + 1) % shaft.ring.length]!;
      const ax = a[0]! * scale, ay = a[1]! * scale, dx = (b[0]! - a[0]!) * scale, dy = (b[1]! - a[1]!) * scale;
      const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / (dx * dx + dy * dy)));
      distance = Math.min(distance, Math.hypot(point.x - ax - dx * t, point.y - ay - dy * t));
      if (dx * (point.y - ay) - dy * (point.x - ax) < 0) inside = false;
    }
    if (inside) distance = -distance;
    const contact = result[vertex.label] ??= { minimumGap: Infinity, penetratingVertices: 0 };
    contact.minimumGap = Math.min(contact.minimumGap, distance);
    if (distance < -.0015) contact.penetratingVertices++;
  }
  return result;
};

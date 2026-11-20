import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";
const { MeshoptSimplifier } = await import(process.argv[2] ?? "meshoptimizer");
import { mkdirSync } from "node:fs";

import { computeVertexNormals } from "../../src/render-common/rocks/helpers";

/** Offline only: preserve the supplied eagle sculpture, crop its plinth, simplify both quality levels.
 * Usage: npx tsx tools/assets/ship-eagle-model.ts /absolute/path/meshopt_simplifier.js */
const source = resolve("../resources/models/eagle_sculpture.glb");
const bytes = readFileSync(source);
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
const binaryOffset = 28 + jsonLength;

type Point = [number, number, number];
const vertices: Point[] = [];
const triangles: number[] = [];

const readAccessor = (index: number, components: number) => {
  const accessor = gltf.accessors[index];
  if (accessor.sparse || accessor.normalized) throw new Error("Unsupported source accessor");
  const view = gltf.bufferViews[accessor.bufferView];
  const type = accessor.componentType;
  const width = type === 5123 ? 2 : 4;
  const stride = view.byteStride ?? width * components;
  const start = binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from({ length: accessor.count * components }, (_, index) => {
    const offset = start + Math.floor(index / components) * stride + (index % components) * width;
    if (type === 5126) return bytes.readFloatLE(offset);
    if (type === 5125) return bytes.readUInt32LE(offset);
    if (type === 5123) return bytes.readUInt16LE(offset);
    throw new Error(`Unsupported source component type ${type}`);
  });
};

const visit = (index: number, parent: Matrix4) => {
  const node = gltf.nodes[index];
  const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
    new Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new Vector3().fromArray(node.scale ?? [1, 1, 1])
  );
  const matrix = parent.clone().multiply(local);
  if (node.mesh !== undefined) {
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      if ((primitive.mode ?? 4) !== 4) throw new Error("Source must use triangles");
      const positions = readAccessor(primitive.attributes.POSITION, 3);
      const first = vertices.length;
      for (let offset = 0; offset < positions.length; offset += 3) {
        vertices.push(new Vector3().fromArray(positions, offset).applyMatrix4(matrix).toArray());
      }
      const indices = primitive.indices === undefined
        ? Array.from({ length: positions.length / 3 }, (_, index) => index)
        : readAccessor(primitive.indices, 1);
      for (const index of indices) triangles.push(first + index);
    }
  }
  for (const child of node.children ?? []) visit(child, matrix);
};
for (const node of gltf.scenes[gltf.scene ?? 0].nodes) visit(node, new Matrix4());


await MeshoptSimplifier.ready;
const top = Math.max(...vertices.map(p=>p[1]));
const previousFloor = Math.min(...vertices.map(p=>p[1])) + 3.2;
// The original crop retained the shallow gold plinth beneath the talons.
// Crop above that slab, then seat the sculpture directly on the bow stem.
const previousScale = .19 / (top - previousFloor);
const floor = previousFloor + .016 / previousScale;
const usedTriangles=triangles.filter((_,index)=> {
 const offset=Math.floor(index/3)*3;
 return [0,1,2].every(corner=>vertices[triangles[offset+corner]!]![1]>=floor);
});
const centerX=(Math.min(...vertices.map(p=>p[0]))+Math.max(...vertices.map(p=>p[0])))/2;
const centerZ=(Math.min(...vertices.map(p=>p[2]))+Math.max(...vertices.map(p=>p[2])))/2;
const scale=.19/(top-floor);
const transformed=vertices.map(p=>[(p[0]-centerX)*scale,(p[1]-floor)*scale+.43,(p[2]-centerZ)*scale+1.22] as Point);
const known=new Map<string,number>(),welded:Point[]=[];
const remap=transformed.map(point=> {
 const key=point.map(value=>Math.round(value*1e7)).join('/');
 const existing=known.get(key);if(existing!==undefined)return existing;
 const index=welded.length;known.set(key,index);welded.push(point);return index;
});
const indices=Uint32Array.from(usedTriangles,index=>remap[index]!);
const positions=Float32Array.from(welded.flat());
const normals=computeVertexNormals(positions,indices);
const reduce=(target:number)=> {
 const [rawResult,error]=MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,normals,3,[.04,.04,.04],null,target*3,.05,['Permissive']);
 const result = rawResult as Uint32Array;
 const used=[...new Set(result)],mapping=new Map(used.map((vertex,index)=>[vertex,index]));
 return {positions:used.flatMap(vertex=>welded[vertex]!.map(value=>Math.round(value*1e6)/1e6)),
  normals:used.flatMap(vertex=>Array.from(normals.slice(vertex*3,vertex*3+3)).map(value=>Math.round(value*1e6)/1e6)),
  indices:Array.from(result,vertex=>mapping.get(vertex)!),error};
};
const high=reduce(8000),minimal=reduce(1000);
mkdirSync('src/render-common/ships',{recursive:true});
writeFileSync('src/render-common/ships/eagle-sculpture-data.ts',
 '// Derived from Eagle Sculpture by jerryfisher, CC-BY-4.0; see docs/reference/asset-credits.md.\nexport const SHIP_EAGLE_SCULPTURE = '+JSON.stringify({high,minimal})+';\n');
console.log({floor,top,high:high.indices.length/3,minimal:minimal.indices.length/3,errorHigh:high.error,errorMinimal:minimal.error});

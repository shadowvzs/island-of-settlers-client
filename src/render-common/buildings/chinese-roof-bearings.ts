import type { BuildingPart, Point3 } from "./building-recipe";
import { chineseRoofBeddingHeight,chineseRoofContactSamples } from "./chinese-roof-bedding";
import { getOccupationRoofHeight } from "./occupation-roof-height";

/** Exact bedding-shell soffit, including the same hip-aligned pitches and diagonal used by the roof mesh. */
export const chineseRoofSoffit = (roof: BuildingPart, x: number, z: number, detailed: boolean): number | null => {
  const yaw = roof.rotation?.[1] ?? 0, dx = x - roof.position[0], dz = z - roof.position[2];
  const u = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / roof.size[0];
  const v = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / roof.size[2];
  if (Math.abs(u) > .5 || Math.abs(v) > .5) return null;
  const height = chineseRoofBeddingHeight(roof, u, v, detailed, true);
  if (height === null) return null;
  return roof.position[1] + height * roof.size[1];
};

/** Real segmented timber wall plates fill the original gap up to each curved roof's underside. */
const fitChineseBearings = (parts: BuildingPart[], detailed: boolean, roofs: BuildingPart[],
  surfaces: readonly BuildingPart["surface"][], minimumSpan: number): BuildingPart[] => {
  return parts.flatMap(part => {
    if (!["box", "bevel-box"].includes(part.shape) || !surfaces.includes(part.surface) ||
      part.size[1] > .1 || Math.max(part.size[0], part.size[2]) < minimumSpan ||
      part.rotation?.some(angle => Math.abs(angle) > .001)) return [part];
    const top = part.position[1] + part.size[1] / 2;
    const roof = roofs.find(candidate => {
      const soffit = chineseRoofSoffit(candidate, part.position[0], part.position[2], detailed);
      return soffit !== null && soffit - top > .018 && soffit - top < .23;
    });
    if (!roof) return [part];
    const axis = part.size[0] > part.size[2] ? 0 : 2, slices = detailed ? 6 : 2;
    const bottom = part.position[1] - part.size[1] / 2;
    return Array.from({ length: slices }, (_, index): BuildingPart => {
      const size: [number, number, number] = [...part.size];
      const position: [number, number, number] = [...part.position];
      size[axis] = part.size[axis] / slices + .002;
      position[axis] += (index + .5 - slices / 2) * part.size[axis] / slices;
      const samples: number[] = [];
      for (const end of [-1, 0, 1]) for (const edge of [-1, 1]) {
        const x = position[0] + (axis === 0 ? end : edge) * size[0] / 2;
        const z = position[2] + (axis === 2 ? end : edge) * size[2] / 2;
        samples.push(chineseRoofSoffit(roof, x, z, detailed) ?? top);
      }
      const head = Math.max(top, ...samples) + .008;
      size[1] = head - bottom; position[1] = (head + bottom) / 2;
      return { ...part, position, size };
    });
  });
};

/** Headquarters behavior stays exact: its existing painted long plates support the original roof. */
export const fitChineseHeadquartersBearings = (parts: BuildingPart[], detailed: boolean): BuildingPart[] =>
  fitChineseBearings(parts, detailed, parts.filter(part => part.shape === "occupation-roof" &&
    part.roofTiles === "pan-cover"), ["paint"], .65);

/** Short posts carry the gable roof from the existing long wall plates, without filling the eaves. */
export const addChineseGableWallBearings = (parts: BuildingPart[], detailed: boolean): BuildingPart[] => {
  const roofs = parts.filter(part => part.shape === "occupation-roof" && part.occupationRoof === "gable" &&
    part.roofTiles === "pan-cover");
  const bearings: BuildingPart[] = [];
  for (const plate of parts) {
    if (plate.shape !== "box" || plate.surface !== "paint" || plate.roofSupport ||
      plate.size[1] > .1 || Math.max(plate.size[0], plate.size[2]) < .4 ||
      plate.rotation?.some(angle => Math.abs(angle) > .001)) continue;
    const axis = plate.size[0] > plate.size[2] ? 0 : 2;
    const roof = roofs.find(candidate => {
      const turned = Math.abs(Math.sin(candidate.rotation?.[1] ?? 0)) > .5;
      const ridgeAxis = turned ? 0 : 2;
      const height = chineseRoofSoffit(candidate, plate.position[0], plate.position[2], detailed);
      const gap = height === null ? 0 : height - (plate.position[1] + plate.size[1] / 2);
      return axis === ridgeAxis && gap > .018 && gap < .23;
    });
    if (!roof) continue;
    const bottom = plate.position[1] + plate.size[1] / 2 - .005;
    for (const side of [-1, 1]) {
      const position: Point3 = [...plate.position];
      position[axis] += side * plate.size[axis] * .38;
      const height = chineseRoofSoffit(roof, position[0], position[2], detailed);
      if (height === null || height <= bottom) continue;
      const top = height + .005;
      position[1] = (bottom + top) / 2;
      bearings.push({ position, roofSupport: true, shape: "box", size: [.06, top - bottom, .06],
        stage: 2, surface: "paint", tint: plate.tint });
    }
  }
  return [...parts, ...bearings];
};

/** A continuous inset bearing follows the roof's real triangle breaks. The half-hip ceramic
 * ends can overhang the bedding; there the original roof profile continues the contact smoothly. */
export const fitChineseFarmWingBearings = (parts: BuildingPart[], detailed: boolean): BuildingPart[] => {
  const roofs=parts.filter(part=>part.shape==="occupation-roof"&&part.roofTiles==="pan-cover"&&part.position[0]>.2);
  const caps:BuildingPart[]=[];
  for(const part of parts) {
    if(!["box","bevel-box"].includes(part.shape)||!["paint","wood"].includes(part.surface)||
      part.size[1]>.1||Math.max(part.size[0],part.size[2])<.4||part.rotation?.some(angle=>Math.abs(angle)>.001))continue;
    const top=part.position[1]+part.size[1]/2;
    const roof=roofs.find(candidate=>{
      const y=chineseRoofSoffit(candidate,part.position[0],part.position[2],detailed);
      return y!==null&&y-top>.018&&y-top<.23;
    });
    if(!roof)continue;
    const axis=part.size[0]>part.size[2]?0:2,across=axis===0?2:0;
    const size:[number,number,number]=[...part.size],position:[number,number,number]=[...part.position];
    const roofAcross=roof.rotation?.[1]?roof.size[axis]:roof.size[across];
    const low=Math.max(part.position[across]-part.size[across]/2,roof.position[across]-roofAcross/2+.001);
    const high=Math.min(part.position[across]+part.size[across]/2,roof.position[across]+roofAcross/2-.001);
    size[across]=high-low;position[across]=(low+high)/2;
    const tracks=[-1,-.5,0,.5,1];
    const uv=(share:number,side:number):[number,number]=>{
      const at:[number,number,number]=[...position];at[axis]+=(share-.5)*size[axis];at[across]+=side*size[across]/2;
      const yaw=roof.rotation?.[1]??0,dx=at[0]-roof.position[0],dz=at[2]-roof.position[2];
      return [(Math.cos(yaw)*dx-Math.sin(yaw)*dz)/roof.size[0],(Math.sin(yaw)*dx+Math.cos(yaw)*dz)/roof.size[2]];
    };
    const shares=new Set([0,1]);
    for(const side of tracks)for(const sample of chineseRoofContactSamples(roof,uv(0,side),uv(1,side),detailed))shares.add(sample.share);
    for(let i=1;i<16;i++)shares.add(i/16);
    const bottom=top-.004;
    const heightAt=(share:number,side:number)=>{
      const [u,v]=uv(share,side);
      const skin=chineseRoofBeddingHeight(roof,u,v,detailed)??Math.min(.495,getOccupationRoofHeight(roof.occupationRoof,u,v,roof.roofSweep,roof.roofCurve)-.018);
      const low=chineseRoofBeddingHeight(roof,u,v,detailed,true)??Math.max(-.5,skin-.07);
      return Math.max(bottom+.001,roof.position[1]+low*roof.size[1]+.001);
    };
    const samples=[...shares].sort((a,b)=>a-b).filter((share,index,all)=>index===0||share-all[index-1]!>1e-7)
      .map(share=>({share,heights:tracks.map(side=>heightAt(share,side))}));
    const head=Math.max(...samples.flatMap(sample=>sample.heights));
    size[1]=head-bottom;position[1]=(head+bottom)/2;
    caps.push({...part,position,size,shape:"chinese-roof-bearing",chineseRoofBearingProfile:{axis,across:tracks.map(side=>side/2),
      samples:samples.map(sample=>({share:sample.share,heights:sample.heights.map(y=>(y-position[1])/size[1])}))}});
  }
  return [...parts,...caps];
};

const PURLIN_CLEARANCE = .002;
const PURLIN_SAMPLES = 8;

/** A straight eave purlin, re-cut so its top follows (and never crosses) the actual bedding soffit. */
const seatPurlin = (part: BuildingPart, roofs: readonly BuildingPart[], detailed: boolean): BuildingPart => {
  const [pitch = 0, yaw = 0] = part.rotation ?? [];
  const half = part.size[2] / 2, cos = Math.cos(pitch);
  const direction: Point3 = [Math.sin(yaw) * cos * half, -Math.sin(pitch) * half, Math.cos(yaw) * cos * half];
  const at = (share: number): Point3 => part.position.map((value, axis) =>
    value + direction[axis]! * (share * 2 - 1)) as Point3;
  const soffitAt = (roof: BuildingPart, share: number) => {
    const [x, , z] = at(share);
    return chineseRoofSoffit(roof, x, z, detailed);
  };
  const roof = roofs.find(candidate => soffitAt(candidate, 0) !== null && soffitAt(candidate, 1) !== null);
  if (!roof) return part;
  const halfDepth = part.size[1] / 2 + PURLIN_CLEARANCE;
  const from = at(0), to = at(1);
  from[1] = soffitAt(roof, 0)! - halfDepth;
  to[1] = soffitAt(roof, 1)! - halfDepth;
  let excess = 0;
  for (let index = 1; index < PURLIN_SAMPLES; index++) {
    const share = index / PURLIN_SAMPLES, soffit = soffitAt(roof, share);
    if (soffit === null) continue;
    excess = Math.max(excess, from[1] + (to[1] - from[1]) * share + halfDepth - soffit);
  }
  from[1] -= excess; to[1] -= excess;
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], horizontal = Math.hypot(dx, dz);
  return { ...part, position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    rotation: [Math.atan2(-dy, horizontal), yaw, 0] };
};

/**
 * Exposed eave purlins follow the analytic roof curve, while the coarse bedding shell (especially
 * on Minimal) is inset below that curve, so purlin tops pierced the eave. They are seated on it.
 */
export const seatChineseRoofPurlins = (parts: BuildingPart[], detailed: boolean): BuildingPart[] => {
  const roofs = parts.filter(part => part.shape === "occupation-roof" && part.roofTiles === "pan-cover");
  return parts.map(part => part.roofSupport && part.shape === "box" && part.rotation
    ? seatPurlin(part, roofs, detailed) : part);
};

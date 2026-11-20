import { BufferGeometry, Float32BufferAttribute } from "three";

/** A closed, thick palm-thatch shell with lapped bundle courses and a softly irregular organic outline. */
export const createIndigenousPalmRoofGeometry = (detailed: boolean) => {
  const sectors = detailed ? 64 : 32, courses = detailed ? 10 : 5;
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  const radius = (t: number) => .484 * Math.pow(1 - t, .86) + .005;
  const ring = (t: number, lip: number, inside = false) => {
    const start = positions.length / 3;
    for (let sector = 0; sector <= sectors; sector++) {
      const angle = sector / sectors * Math.PI * 2;
      const edge = Math.max(0, 1 - t / .10) ** 2;
      const wave = Math.sin(angle * 13 + t * 4) * .0018 + Math.sin(angle * 27 - t * 9) * .0012;
      const r = (radius(t) + lip + wave * (1 - t)) * (inside ? .962 : 1) - .018 * edge;
      const rough = Math.sin((sector % sectors) * 37.7 + Math.floor(t * courses) * 19.3) * .0045 * (1 - t);
      const y = (inside ? -.5 : -.475 + rough) + t * .975 + (inside ? .055 : .040) * edge;
      positions.push(Math.sin(angle) * r, y, Math.cos(angle) * r);
      uvs.push(sector / sectors, t);
      const shade = inside ? .62 : .95 + Math.sin(angle * 19 + t * 33) * .035;
      colors.push(shade, shade, shade);
    }
    return start;
  };
  const bridge = (from: number, to: number, inward = false) => {
    for (let sector = 0; sector < sectors; sector++) {
      const a=from+sector,b=a+1,c=to+sector,d=c+1;
      if (inward) indices.push(a,c,b,b,c,d);
      else indices.push(a,b,c,b,d,c);
    }
  };
  const outerRings: {at:number;start:number}[]=[];
  let last: number | undefined;
  let outerFoot = 0;
  for (let course = 0; course < courses; course++) {
    const t=course/courses, next=(course+1)/courses;
    for (const [at, lip] of [[t,.005*(1-t)],[t+.14/courses,.002*(1-t)],[next,0]] as const) {
      const current=ring(at,lip);
      outerRings.push({at,start:current});
      if (last!==undefined) bridge(last,current);
      else outerFoot=current;
      last=current;
    }
  }
  const outerTop=last!;
  let innerFoot=0;
  const innerRows=detailed?6:3;
  for (let row=0;row<=innerRows;row++) {
    const current=ring(row/innerRows,0,true);
    if(row===0)innerFoot=current;
    else bridge(last!,current,true);
    last=current;
  }
  // These bearing soffits close the thick eave and apex: no alpha cards or see-through roof edges.
  bridge(outerFoot,innerFoot,true);
  bridge(outerTop,last!);
  const top=positions.length/3;
  positions.push(0,.5,0);uvs.push(.5,1);colors.push(.95,.95,.95);
  for(let sector=0;sector<sectors;sector++)indices.push(top,outerTop+sector,outerTop+sector+1);
  // Individual dry leaflets sit on sampled roof triangles, with wispy ends beyond the thick eave.
  const read=(vertex:number)=>positions.slice(vertex*3,vertex*3+3);
  const surface=(t:number,angle:number,lift:number):number[]=>{
    const across=((angle/(Math.PI*2)%1)+1)%1*sectors,sector=Math.floor(across),a=across-sector;
    let row=0;
    while(row<outerRings.length-2 && outerRings[row+1]!.at<=t)row++;
    const from=outerRings[row]!,to=outerRings[row+1]!;
    const b=Math.max(0,Math.min(1,(t-from.at)/Math.max(.000001,to.at-from.at)));
    const aa=read(from.start+sector),bb=read(from.start+sector+1),
      cc=read(to.start+sector),dd=read(to.start+sector+1);
    const p=[0,1,2].map(axis=>a+b<=1 ? aa[axis]!*(1-a-b)+bb[axis]!*a+cc[axis]!*b :
      bb[axis]!*(1-b)+cc[axis]!*(1-a)+dd[axis]!*(a+b-1));
    p[0]!+=Math.sin(angle)*lift;p[1]!+=lift*.6;p[2]!+=Math.cos(angle)*lift;
    return p;
  };
  // Each leaf is a closed, bent triangular blade, not a flat line on the cone.
  // Its root sinks into the waterproof underlayer; the lifted tip casts a real shadow.
  const fibre=(t:number,angle:number,length:number,seed:number,eave=false)=>{
    const width=(detailed?.0035:.006)+seed*(detailed?.0035:.004);
    const start=positions.length/3;
    for(let row=0;row<3;row++) {
      const along=row/2,at=t-length*along;
      const bend=Math.sin(along*Math.PI*.72)*(.004+seed*.007);
      const tapers=[.7,1,.15] as const,taper=tapers[row]!;
      for(let corner=0;corner<3;corner++) {
        const sides=[-1,1,0] as const,side=sides[corner]!;
        const twist=Math.sin(seed*31+along*2)*.004*along;
        const a=angle+twist+side*width*taper/Math.max(.03,radius(Math.max(0,at)));
        const p=surface(Math.max(0,at),a,(row===0?-.001:.001+bend)+(corner===2?width*.75:0));
        if(at<0) {
          const reach=.002+seed*.003;
          p[0]!+=Math.sin(a)*reach;p[1]!+=at*.975;p[2]!+=Math.cos(a)*reach;
        }
        if(eave && row===2) {
          // Closed slender tips hang at independently varied heights below the inset core.
          // All stay within the original authored box; no shared flat cutoff creates a fascia.
          const drop=Math.abs(Math.sin(seed*71.3+angle*13.7));
          const reach=Math.abs(Math.sin(seed*43.9-angle*19.1));
          const tipRadius=.479+reach*.018;
          p[0]=Math.sin(a)*tipRadius;p[2]=Math.cos(a)*tipRadius;
          p[1]=-.457-drop*.035+(corner===2?.0015:0);
        }
        const radial=Math.hypot(p[0]!,p[2]!);
        if(radial>.499){p[0]!*=.499/radial;p[2]!*=.499/radial;}
        p[1]=Math.max(-.499,Math.min(.499,p[1]!));
        positions.push(...p);uvs.push(a/(Math.PI*2),Math.max(0,at));
        const shade=.94+seed*.11;colors.push(shade,shade,shade);
      }
    }
    // Outward winding on all three sides, with closed root and tapered cut end.
    for(let row=0;row<2;row++)for(let edge=0;edge<3;edge++) {
      const a=start+row*3+edge,b=start+row*3+(edge+1)%3,c=a+3,d=b+3;
      indices.push(a,b,c,b,d,c);
    }
    indices.push(start,start+2,start+1,start+6,start+7,start+8);
  };
  const fringe=detailed?260:76;
  for(let index=0;index<fringe;index++) {
    const seed=Math.abs(Math.sin(index*37.1));
    fibre(.035+seed*.012,(index+.31)/fringe*Math.PI*2,.041+seed*.013,seed,true);
  }
  const rows=detailed?14:5;
  for(let row=1;row<rows;row++) {
    const t=(row+.2)/rows,count=Math.max(8,Math.round((detailed?150:34)*radius(t)/.49));
    for(let index=0;index<count;index++) {
      const seed=Math.abs(Math.sin(index*61.3+row*27.1));
      fibre(t+seed*.025,(index+row*.414)/count*Math.PI*2,.055+seed*.045,seed);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));
  geometry.setAttribute("color",new Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  // The atlas seam has duplicate UV vertices, but it is one continuous curved surface.
  const normals=geometry.getAttribute("normal"), rings=courses*3+innerRows+1;
  for(let row=0;row<rings;row++) {
    const first=row*(sectors+1),last=first+sectors;
    const nx=normals.getX(first)+normals.getX(last),ny=normals.getY(first)+normals.getY(last),
      nz=normals.getZ(first)+normals.getZ(last),length=Math.hypot(nx,ny,nz)||1;
    for(const index of [first,last])normals.setXYZ(index,nx/length,ny/length,nz/length);
  }
  return geometry;
};

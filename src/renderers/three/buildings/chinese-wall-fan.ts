import { BufferGeometry, CanvasTexture, DataTexture, DoubleSide, Float32BufferAttribute,
  MeshStandardMaterial, RGBAFormat, SRGBColorSpace, type Texture } from "three";

import { ownBuildingMaterial } from "./building-material-ownership";

let atlas:Texture|undefined;
/** Original painted plum branch on warm silk: shared by every physical folded fan. */
const fanAtlas=()=>{
  if(atlas)return atlas;
  let texture:Texture;
  if(typeof document==="undefined")texture=new DataTexture(new Uint8Array([229,199,135,255]),1,1,RGBAFormat);
  else {
    const canvas=document.createElement("canvas");canvas.width=canvas.height=512;
    const ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#dfc59a";ctx.fillRect(0,0,512,512);
    // The annular edge bands follow the actual fan arc, not a rectangular decal boundary.
    for(const [radius,width,colour] of [[250,25,"#28534e"],[239,4,"#b38c43"],[230,6,"#934b43"]] as const){
      ctx.beginPath();ctx.ellipse(256,512,radius,radius*2,0,-Math.PI,0);ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.stroke();
    }
    ctx.strokeStyle="#493e2b";ctx.lineCap="round";
    const branch=(points:number[],width:number)=>{
      ctx.beginPath();ctx.moveTo(points[0]!,points[1]!);ctx.bezierCurveTo(...points.slice(2) as [number,number,number,number,number,number]);
      ctx.lineWidth=width;ctx.stroke();
    };
    branch([94,419,174,330,286,344,414,154],9);
    branch([224,331,193,265,222,219,190,177],4);
    branch([295,282,360,296,409,262,455,236],4);
    branch([350,225,316,182,328,144,305,108],3);
    for(const [x,y,scale] of [[192,178,1],[218,231,.85],[240,314,.8],[306,109,.9],
      [330,165,.8],[359,218,1],[410,159,1.05],[409,265,.8],[453,236,.85]] as const){
      for(let petal=0;petal<5;petal++){
        const angle=petal*Math.PI*2/5;
        ctx.beginPath();ctx.ellipse(x+Math.sin(angle)*9*scale,y+Math.cos(angle)*9*scale,
          7*scale,10*scale,-angle,0,Math.PI*2);ctx.fillStyle=petal%2?"#b45052":"#d07873";ctx.fill();
        ctx.strokeStyle="#93484a";ctx.lineWidth=.8;ctx.stroke();
      }
      ctx.beginPath();ctx.arc(x,y,3*scale,0,Math.PI*2);ctx.fillStyle="#d3aa42";ctx.fill();
    }
    // Fine warp threads remain subordinate to the painting.
    ctx.strokeStyle="rgba(87,65,38,.045)";ctx.lineWidth=.5;
    for(let x=0;x<512;x+=3){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,512);ctx.stroke();}
    texture=new CanvasTexture(canvas);
  }
  texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;texture.userData.mimeType="image/png";
  texture.addEventListener("dispose",()=>{if(atlas===texture)atlas=undefined;});atlas=texture;return texture;
};

export const createChineseWallFanMaterial=()=>ownBuildingMaterial(new MeshStandardMaterial({
  map:fanAtlas(),side:DoubleSide,roughness:.82,metalness:0,vertexColors:true
}),undefined,true);

/** Pleated silk on individually raised radial ribs, with real folded thickness and a pivot mount. */
export const createChineseWallFanGeometry=(detailed:boolean)=>{
  const segments=detailed?24:16,positions:number[]=[],uvs:number[]=[],colours:number[]=[];
  type Vertex=readonly[number,number,number];
  const vertex=(point:Vertex,wood:boolean)=>{
    positions.push(point[0]/2,point[1]-.5,point[2]);
    uvs.push(point[0]/2+.5,point[1]);
    colours.push(...(wood?[.27,.16,.08]:[1,1,1]));
  };
  const triangle=(a:Vertex,b:Vertex,c:Vertex,wood=false)=>{vertex(a,wood);vertex(b,wood);vertex(c,wood);};
  const point=(i:number,r:number,back=false):Vertex=>{
    const angle=(-80+i*160/segments)*Math.PI/180;
    const fold=(i%2===0?.28:-.28)*r;
    return [Math.sin(angle)*r,Math.cos(angle)*r,fold+(back?-.04:.04)];
  };
  for(let i=0;i<segments;i++)for(const back of [false,true]){
    const a=point(i,.13,back),b=point(i+1,.13,back),c=point(i+1,1,back),d=point(i,1,back);
    triangle(a,b,c);triangle(a,c,d);
  }
  // Bound the silk leaf thickness along its inner/outer arcs and both folded end edges.
  for(let i=0;i<segments;i++)for(const radius of [.13,1]){
    const a=point(i,radius),b=point(i+1,radius),c=point(i+1,radius,true),d=point(i,radius,true);
    triangle(a,b,c);triangle(a,c,d);
  }
  for(const edge of [0,segments]){
    const a=point(edge,.13),b=point(edge,1),c=point(edge,1,true),d=point(edge,.13,true);
    triangle(a,b,c,true);triangle(a,c,d,true);
  }
  for(let i=0;i<=segments;i++){
    const a=point(i,.04),b=point(i,1.01),width=detailed?.009:.012;
    const left:Vertex=[a[0]-width,a[1],a[2]+.035],right:Vertex=[a[0]+width,a[1],a[2]+.035];
    const endLeft:Vertex=[b[0]-width,b[1],b[2]+.035],endRight:Vertex=[b[0]+width,b[1],b[2]+.035];
    triangle(left,right,endRight,true);triangle(left,endRight,endLeft,true);
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uvs,2));
  geometry.setAttribute("color",new Float32BufferAttribute(colours,3));
  geometry.computeVertexNormals();return geometry;
};

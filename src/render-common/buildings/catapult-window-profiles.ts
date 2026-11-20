export type CatapultWindowStyle = "chinese-round" | "japanese-shoji" | "persian-pointed" | "roman-arch";
export type WindowPoint = readonly [number, number];
export interface WindowBar { from: WindowPoint; to: WindowPoint; width: number }

/** Original fitted profiles, normalized to the existing .32 × .375 frame envelope. */
export const catapultWindowContour = (style: CatapultWindowStyle, detailed: boolean): WindowPoint[] => {
  const halfWidth = .40625, bottom = -.4266667, top = .4266667;
  if(style==="chinese-round")return Array.from({length:detailed?24:12},(_,index)=>{
    const angle=index/(detailed?24:12)*Math.PI*2;
    return [Math.cos(angle)*top,Math.sin(angle)*top] as const;
  });
  if (style === "japanese-shoji") return [
    [-halfWidth, bottom], [halfWidth, bottom], [halfWidth, top], [-halfWidth, top]
  ];
  const spring = .03, steps = detailed ? 10 : 6;
  const contour: WindowPoint[] = [[-halfWidth, bottom], [halfWidth, bottom]];
  for (let index = 0; index <= steps; index++) {
    const x = Math.cos(index / steps * Math.PI);
    let crown = Math.sqrt(Math.max(0, 1 - x * x));
    if (style === "persian-pointed") crown = Math.sqrt(Math.max(0, 1 - Math.abs(x)));
    contour.push([x * halfWidth, spring + (top - spring) * crown]);
  }
  return contour;
};

/** Joined timber bars keep their ends in the surrounding frame; no printed lattice substitute. */
export const catapultWindowBars = (style: CatapultWindowStyle, detailed: boolean): WindowBar[] => {
  const bars: WindowBar[] = [];
  const add = (from: WindowPoint, to: WindowPoint, width = .035) => bars.push({ from, to, width });
  if(style==="chinese-round"){
    // Four connected, rotationally repeated fret arms, original geometry rather than the photo.
    const arm:WindowPoint[]=[[0,.4266667],[0,.19],[.19,.19],[.19,.06],[.07,.06],[.07,.12]];
    for(let turn=0;turn<4;turn++){
      const angle=turn*Math.PI/2,c=Math.cos(angle),s=Math.sin(angle);
      const rotated=arm.map(([x,y]):WindowPoint=>[x*c-y*s,x*s+y*c]);
      const count=detailed?rotated.length:rotated.length-1;
      for(let index=0;index<count-1;index++)add(rotated[index]!,rotated[index+1]!,detailed?.025:.033);
    }
    return bars;
  }
  if (style === "japanese-shoji") {
    for (const x of [-.20, 0, .20]) add([x, -.4266667], [x, .4266667], .025);
    for (const y of [-.21, 0, .21]) add([-.40625, y], [.40625, y], .025);
    return bars;
  }
  if (style === "roman-arch") {
    add([0, -.4266667], [0, .4266667], .042);
    add([-.40625, -.10], [.40625, -.10], .035);
    add([0, .10], [-.29, .31], .035);
    add([0, .10], [.29, .31], .035);
    return bars;
  }
  // A restrained original eight-point geometric panel in the lower rectangular opening.
  const corners: WindowPoint[] = [[0, -.4266667], [.40625, -.10], [0, .4266667], [-.40625, -.10]];
  for (let index = 0; index < corners.length; index++)
    add(corners[index]!, corners[(index + 1) % corners.length]!, .028);
  if (detailed) {
    add([-.27, -.21], [.27, -.21], .022);
    add([.27, -.21], [.27, .08], .022);
    add([.27, .08], [-.27, .08], .022);
    add([-.27, .08], [-.27, -.21], .022);
  }
  return bars;
};

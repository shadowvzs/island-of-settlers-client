import type { BuildingPart, Point3 } from "../building-recipe";
import { getRomanPartBounds } from "../building-recipe-fit";
import { boxOf, heightCap, isFree, isInsidePlot, type LevelKit } from "./level-kit";

interface StandardStyle { height: number; width: number }

const SUPPORT_SURFACES = new Set<BuildingPart["surface"]>(["stone", "plaster", "cut-stone", "wood", "planks"]);
const SUPPORT_SHAPES = new Set<BuildingPart["shape"]>(["box", "bevel-box", "cylinder"]);
interface Mount {
  anchorTop: number;
  axis: 0 | 2;
  centre: Point3;
  face: number;
  sign: number;
  source: BuildingPart;
  top: number;
}

/** Stationary wall and beam faces; inventory and moving mechanisms never carry decorations. */
const supports = (kit: LevelKit) => kit.site.parts.filter(part => !part.stock && !part.rotation &&
  !part.swayPivot && part.windCordSlot === undefined &&
  SUPPORT_SHAPES.has(part.shape) && SUPPORT_SURFACES.has(part.surface) && part.size[1] >= .04);

/** Round towers can use either tangent face; thin walls use their broad face. */
const mountAxes = (part: BuildingPart): readonly (0 | 2)[] => {
  if (part.shape === "cylinder" || Math.min(part.size[0], part.size[2]) > .3) return [0, 2];
  return [part.size[0] >= part.size[2] ? 0 : 2];
};

const mountOnSupport = (source: BuildingPart, style: StandardStyle, bounds: ReturnType<typeof getRomanPartBounds>,
  axis: 0 | 2, sign: number, share: number, top: number): Mount => {
  const across = axis === 0 ? 2 : 0;
  const fraction = Math.min(1, Math.max(0, (top - bounds.min[1]) / source.size[1]));
  const taper = 1 + ((source.topScale?.[across] ?? 1) - 1) * fraction;
  const face = source.position[across] + (source.topOffset?.[across] ?? 0) * fraction +
    sign * source.size[across] * taper / 2;
  const centre: Point3 = [...source.position];
  centre[axis] = bounds.min[axis] + source.size[axis] * share;
  centre[across] = face + sign * .025;
  centre[1] = top - style.height / 2;
  const anchorTop = source.roofSupport ? bounds.min[1] + .01 : top;
  return { anchorTop, axis, centre, face, sign, source, top };
};

const supportCandidates = (kit: LevelKit, style: StandardStyle, source: BuildingPart): Mount[] => {
  const bounds = getRomanPartBounds(source), result: Mount[] = [];
  const lowest = kit.site.definition.style === "well" ? .75 : .85;
  let highest = Math.min(bounds.max[1] - .02, heightCap(kit.site) - .05);
  if (source.roofSupport) highest = bounds.min[1] - .035;
  for (const axis of mountAxes(source)) {
    if (source.size[axis] < style.width + .08) continue;
    const across = axis === 0 ? 2 : 0;
    const outward = Math.sign(source.position[across] - kit.site.centre[across]) || 1;
    const signs = source.shape === "cylinder" ? [outward, -outward] : [outward];
    const shares = source.shape === "cylinder" ? [.5] : [.5, .25, .75];
    const placements = signs.flatMap(sign => [0, .25, .5].flatMap(drop => shares.map(share => ({ drop, share, sign }))));
    for (const { drop, share, sign } of placements) {
      const top = highest - drop;
      if (top - style.height < lowest || top < bounds.min[1] - .04) continue;
      result.push(mountOnSupport(source, style, bounds, axis, sign, share, top));
    }
  }
  return result;
};

const isMountClear = (kit: LevelKit, style: StandardStyle, mount: Mount) => {
  const { axis, centre, face, sign, source, top } = mount, across = axis === 0 ? 2 : 0;
  const size: Point3 = axis === 0 ? [style.width + .08, style.height + .04, .075]
    : [.075, style.height + .04, style.width + .08];
  const box = boxOf(centre, size);
  if(kit.site.parts.some(part=>{
    if(!part.windowShadow)return false;
    const at=part.windowOpeningPosition??part.position,opening=part.windowOpeningSize??part.size;
    const normal=opening[0]<opening[2]?0:2;
    return normal===across&&Math.abs(at[across]-centre[across])<.15&&
      Math.abs(at[axis]-centre[axis])<(opening[axis]+size[axis])/2&&
      Math.abs(at[1]-centre[1])<(opening[1]+size[1])/2;
  }))return false;
  const behind = (bounds: ReturnType<typeof getRomanPartBounds>, part: BuildingPart) => part === source ||
    (sign > 0 ? bounds.max[across] <= face + .002 : bounds.min[across] >= face - .002);
  if (!isInsidePlot(kit.site, box) || !isFree(kit.site, box, .005, behind)) return false;
  return !kit.site.recipe.archerPositions?.some(point => Math.hypot(point[0] - centre[0],
    point[2] - centre[2]) < .4 && top > point[1] - .15);
};

const findMount = (kit: LevelKit, style: StandardStyle) => {
  const facing = (mount: Mount) => (mount.axis === 2 && mount.sign > 0 ? 10 : 0) + mount.top;
  const mounts = supports(kit).flatMap(source => supportCandidates(kit, style, source));
  mounts.sort((first, second) => facing(second) - facing(first));
  for (const mount of mounts)
    if (isMountClear(kit, style, mount)) return mount;
  return null;
};

/** The headquarters alone retains an original quetzal textile, supported clear of its openings. */
export const addWallStandard = (kit: LevelKit) => {
  if (kit.site.nation !== "maya" || kit.site.definition.id !== 0) return;
  const style: StandardStyle = { height: .34, width: .24 };
  const mount = findMount(kit, style);
  if (!mount) return;
  const { axis, centre, sign, top } = mount, across = axis === 0 ? 2 : 0;
  const bar: Point3 = [...centre];
  bar[1] = top;
  bar[across] -= sign * .015;
  kit.add({ position: bar, shape: "box", size: axis === 0 ? [style.width + .06, .025, .05]
    : [.05, .025, style.width + .06], stage: 4, surface: "wood" });
  const yaw = axis === 2 ? sign * Math.PI / 2 : Math.max(0, -sign) * Math.PI;
  kit.add({ position: [centre[0], top - .012 - style.height / 2, centre[2]],
    rotation: [0, yaw, 0],
    shape: "maya-headquarters-textile", size: [style.width, style.height, .012], stage: 4, surface: "cloth" });
};

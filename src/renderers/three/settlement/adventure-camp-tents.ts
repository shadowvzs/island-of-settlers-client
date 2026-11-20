import { BoxGeometry } from "three";

import type {
  AdventureCampStyle, CampTentVariant
} from "../../../render-common/adventure/adventure-camp-style";
import type { CampGeometryBuilder } from "./adventure-camp-geometry";
import { addCampSupplies } from "./adventure-camp-supplies";
import { tentClothPoint, tentRoofHeight } from "./camp-tent-cloth";

const TAU = Math.PI * 2;
const tentHeight = (style: AdventureCampStyle, command: boolean) => {
  if (style.snow) return command ? 2.8 : 2.1;
  return command ? 2.35 : 1.85;
};
const raisedPlatform = (builder: CampGeometryBuilder, width: number, depth: number, detailed: boolean) => {
  const boards = detailed ? 6 : 1;
  for (let index = 0; index < boards; index++) builder.box([width / boards - .012, .11, depth],
    [-width / 2 + (index + .5) * width / boards, .29, 0]);
  for (const x of [-width / 2 + .12, width / 2 - .12]) for (const z of [-depth / 2 + .12, depth / 2 - .12])
    builder.pole([x, 0, z], [x, .35, z], .075);
  builder.add(new BoxGeometry(.72, .11, .32), [.32, .21, .12], 0, .12, depth / 2 + .14);
};

/** Raised Arctic bell tents keep a central pole, a wind-pinned crown and an open entrance sector. */
const roundTent = (builder: CampGeometryBuilder, style: AdventureCampStyle, command: boolean, detailed: boolean) => {
  const radius = command ? 1.42 : 1.12, height = command ? 2.55 : 1.95, eave = command ? .85 : .45;
  builder.surface({ columns: detailed ? 24 : 12, rows: detailed ? 8 : 3,
    point: (u, v) => {
      const angle = u * TAU, r = v * radius;
      return [Math.sin(angle) * r, eave + (height - eave) * (1 - v) ** .8 +
        .025 * Math.sin(angle * 12) * Math.sin(v * Math.PI), Math.cos(angle) * r];
    },
    color: (u, _v) => style.canvas.map(channel => channel * (.93 + .04 * Math.cos(u * Math.PI * 12))) as
      [number, number, number],
    freedom: (_u, v) => Math.sin(v * Math.PI) * .7
  });
  // Leave a broad doorway on the front; quilts hang from the roof seam, never from thin air.
  builder.surface({ columns: detailed ? 24 : 12, rows: detailed ? 5 : 2,
    point: (u, v) => {
      const angle = .46 + u * (TAU - .92), r = radius * (1 + .025 * Math.sin(v * Math.PI));
      return [Math.sin(angle) * r, .09 + (1 - v) * (eave - .09), Math.cos(angle) * r];
    },
    color: u => style.canvas.map(channel => channel * (.92 + .05 * Math.cos(u * Math.PI * 12))) as
      [number, number, number],
    freedom: (_u, v) => Math.sin(v * Math.PI) * .35
  });
  builder.pole([0, 0, 0], [0, height + .09, 0], .046);
  if (command) addCampSupplies(builder, style, radius * 1.7, radius * 1.7, .035, detailed);
  for (let index = 0; index < 8; index++) {
    const angle = index * TAU / 8;
    builder.pole([Math.sin(angle) * radius, eave, Math.cos(angle) * radius],
      [Math.sin(angle) * (radius + .35), .06, Math.cos(angle) * (radius + .35)], .009, style.trim);
    builder.pole([Math.sin(angle) * (radius + .35), 0, Math.cos(angle) * (radius + .35)],
      [Math.sin(angle) * (radius + .35), .15, Math.cos(angle) * (radius + .35)], .025);
  }
};

/** Sloped palm blades have their own ribs rather than substituting a plain green roof plane. */
const palmEaves = (builder: CampGeometryBuilder, width: number, depth: number, detailed: boolean,
  eave: number, height: number) => {
  const blades = detailed ? 10 : 6;
  for (const side of [-1, 1]) for (let blade = 0; blade < blades; blade++) {
    const z = (blade / (blades - 1) - .5) * depth;
    builder.surface({ columns: detailed ? 3 : 2, rows: detailed ? 6 : 3, fabric: false,
      point: (u, v) => {
        const x = side * v * width / 2, leafZ = z + (u - .5) * .2 * Math.sin(v * Math.PI);
        const roofV = Math.max(0, Math.min(1, leafZ / depth + .5));
        return [x, tentRoofHeight("pagoda", x / width + .5, roofV, eave, height) +
          .012 + .018 * Math.sin(v * Math.PI), leafZ];
      },
      color: (u, v) => [(.52 - v * .13) * (1 - .1 * Math.abs(u - .5)), .4 - v * .14, .12],
      freedom: (_u, v) => v * v * .28
    });
  }
};

const getTentEaveHeight = (awning: boolean, shape: AdventureCampStyle["shape"]) => {
  if (awning) return 1.15;
  return shape === "pagoda" ? 1.1 : .64;
};

/** Awnings use a saddle roof; a saddle-style tent swaps to a hipped roof; others keep their shape. */
const getTentRoofShape = (awning: boolean, shape: AdventureCampStyle["shape"]) => {
  if (awning) return "saddle";
  return shape === "saddle" ? "hipped" : shape;
};

export const addCampTent = (
  builder: CampGeometryBuilder, style: AdventureCampStyle, variant: CampTentVariant, detailed: boolean
) => {
  const command = variant === "command", awning = variant === "awning";
  if (!command && !awning) style = { ...style, canvas: style.accent, accent: style.canvas,
    shape: style.shape === "round" ? "ridge" : style.shape };
  if (style.shape === "round" && !awning) { roundTent(builder, style, command, detailed); return; }
  const width = command ? 2.7 : 2.1, depth = command ? 2.8 : 2.25;
  const floor = style.raised ? .35 : .035;
  const height = floor + tentHeight(style, command);
  const eave = floor + getTentEaveHeight(awning, style.shape);
  const shape = getTentRoofShape(awning, style.shape);
  const roofWidth = width * .87, roofDepth = depth * .9;
  const roofPoint = (u: number, v: number): [number, number, number] => {
    const [x, z] = tentClothPoint(roofWidth, roofDepth, u, v);
    return [x, tentRoofHeight(shape, u, v, eave, height), z];
  };
  const shade = (u: number, v: number) => {
    const value = .92 + .04 * Math.cos(u * Math.PI * 8) + .025 * Math.sin(v * Math.PI);
    return style.canvas.map(channel => channel * value) as [number, number, number];
  };
  if (style.raised) raisedPlatform(builder, width, depth, detailed);
  if (command) addCampSupplies(builder, style, width, depth, floor, detailed);
  builder.surface({ columns: detailed ? 18 : 8, rows: detailed ? 16 : 6,
    point: roofPoint, color: shade,
    freedom: (u, v) => Math.sin(u * Math.PI * 2) ** 2 * Math.sin(v * Math.PI) * .75
  });
  const edge = (point: (t: number) => [number, number, number], radius = .006) => {
    const samples = detailed ? 9 : 5;
    builder.rope(Array.from({ length: samples }, (_, i) => point(i / (samples - 1))), radius, style.trim);
  };
  for (const side of [0, 1]) { edge(t => roofPoint(side, t)); edge(t => roofPoint(t, side)); }
  if (!awning) edge(t => roofPoint(.5, t), .007);
  for (const u of [0, 1]) for (const v of [0, 1]) {
    const [x, top, z] = roofPoint(u, v);
    builder.pole([x, 0, z], [x, top + .035, z], .035);
    const anchor: [number, number, number] = [x * 1.32, .04, z * 1.22];
    builder.rope([[x, top + .008, z], [(x + anchor[0]) / 2, top * .4, (z + anchor[2]) / 2], anchor], .0065,
      [.53, .44, .3]);
    builder.pole([anchor[0], 0, anchor[2]], [anchor[0], .13, anchor[2]], .02);
  }
  if (!awning) {
    if (shape === "pagoda") builder.pole([0, 0, 0], [0, height + .035, 0], .038);
    else {
      const rear = shape === "ridge" ? -roofDepth / 2 : -roofDepth * .18;
      const front = roofDepth / 2;
      for (const z of [rear, front]) builder.pole([0, 0, z], [0, height + .035, z], .038);
      builder.pole([0, height + .015, rear], [0, height + .015, front], .024);
    }
    const wall = (u: number, v: number, side: number, rear = false): [number, number, number] => {
      const roofU = rear ? u : side, roofV = rear ? 0 : u;
      const top = roofPoint(roofU, roofV);
      const bottom = tentClothPoint(width, depth, roofU, roofV);
      const fold = .027 * Math.sin(u * Math.PI * 8) * Math.sin(v * Math.PI);
      return [top[0] * (1 - v) + bottom[0] * v + (rear ? 0 : (side === 0 ? -1 : 1) * fold),
        floor + (1 - v) * (top[1] - floor) - .035 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI),
        top[2] * (1 - v) + bottom[1] * v + (rear ? -fold : 0)];
    };
    for (const side of [0, 1]) builder.surface({ columns: detailed ? 16 : 6, rows: detailed ? 8 : 3,
      point: (u, v) => wall(u, v, side), color: shade,
      freedom: (u, v) => Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * .35 });
    builder.surface({ columns: detailed ? 16 : 6, rows: detailed ? 8 : 3,
      point: (u, v) => wall(u, v, 0, true), color: shade,
      freedom: (u, v) => Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * .35 });
    for (const side of [0, 1]) {
      edge(t => wall(t, 1, side));
      edge(t => wall(side, t, 0, true));
    }
    edge(t => wall(t, 1, 0, true));
    // Tied-back entrance cloth slopes to the wider ground hem and gathers into supported folds.
    for (const sign of [-1, 1]) builder.surface({ columns: detailed ? 12 : 6, rows: detailed ? 8 : 3,
      point: (u, v) => {
        const xTop = sign * roofWidth / 2 * (1 - u * .76);
        const roofU = xTop / roofWidth + .5, top = roofPoint(roofU, 1);
        const xBase = sign * width / 2 * (1 - u * .25);
        const base = tentClothPoint(width, depth, xBase / width + .5, 1);
        return [top[0] * (1 - v) + base[0] * v,
          floor + (1 - v) * (top[1] - floor),
          top[2] * (1 - v) + base[1] * v + .025 * Math.sin(u * Math.PI * 6) * Math.sin(v * Math.PI)];
      }, color: (u, _v) => style.accent.map(channel => channel * (.91 + .05 * Math.cos(u * Math.PI * 6))) as
        [number, number, number], freedom: (u, v) => u * Math.sin(v * Math.PI) * .45 });
  }
  if (style.shape === "pagoda" && !command && !awning) palmEaves(builder, roofWidth, roofDepth, detailed, eave, height);
  if (command || awning) builder.surface({ columns: detailed ? 24 : 10, rows: detailed ? 3 : 2,
    point: (u, v) => {
      const [x, y, z] = roofPoint(u, 1);
      const scallop = .055 + .055 * Math.sin(u * Math.PI * 6) ** 2;
      return [x, y - v * scallop, z + .01 * Math.sin(v * Math.PI)];
    }, color: () => style.accent, freedom: (u, v) => Math.sin(u * Math.PI) * v * .3 });
};

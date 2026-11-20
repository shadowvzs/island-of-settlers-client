/** Original painted jade and flame-coloured sculpture finishes, shared by standalone models and placements. */
export const SCULPTURE_MATERIALS = {
  gold: { color: 0xf2be49, metalness: .4, roughness: .44, vertexColors: false },
  dark: { color: 0x27160e, metalness: .05, roughness: .7, vertexColors: false },
  jade: { color: 0xffffff, metalness: .1, roughness: .44, vertexColors: true },
  phoenixCopper: { color: 0xd34d16, metalness: .04, roughness: .58, vertexColors: false },
  phoenixPlumage: { color: 0xffffff, metalness: .02, roughness: .56, vertexColors: true }
} as const;

import { DataTexture, DoubleSide, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from "three";


/** Over-under plaited palm-leaf strips, 8 texels wide (the Nubian awning). */
const matWeave = (x: number, y: number) => {
  const over = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0, along = over ? y % 8 : x % 8;
  const edge = Math.min(along, 7 - along) < 1 ? -38 : 0;
  return (over ? 6 : -16) + edge + Math.sin((over ? x : y) * 1.7) * 6;
};

const PATTERNS = {
  cloth: (x: number, y: number) => (x % 2 === 0 || y % 2 === 0) ? -4 : 1,
  grain: (x: number, y: number) => Math.sin(x * 0.55 + Math.sin(y * 0.035) * 1.8) * 11 - (x % 32 < 2 ? 23 : 0),
  mat: matWeave
} as const;

/** Procedural planking grain, a fine weave or a plaited mat; the premium bitmaps replace the first two. */
const craftTexture = (pattern: keyof typeof PATTERNS) => {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, grain = PATTERNS[pattern](x, y);
    const noise = ((x * 73 + y * 37 + x * y * 11) % 19) - 9;
    const value = Math.max(0, Math.min(255, 226 + grain + (pattern === "grain" ? noise : noise * .25)));
    pixels[i] = value; pixels[i + 1] = value; pixels[i + 2] = value; pixels[i + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size); texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true; return texture;
};

const cloth = (color: number) => new MeshStandardMaterial({ color, roughness: .98, side: DoubleSide });

/**
 * Every ship material, shared by all crafts and nations (one batch per material and hull style).
 * Wood-grained materials take the timber bitmap, cloth ones the linen; the nations' sails are painted
 * over it (ship-premium-textures.ts).
 */
export const createShipMaterials = () => {
  const materials = {
    wood: new MeshStandardMaterial({ color: 0x917257, roughness: 0.87 }),
    dark: new MeshStandardMaterial({ color: 0x493522, roughness: 0.94 }),
    deck: new MeshStandardMaterial({ color: 0xb69973, roughness: 0.9 }),
    cloth: cloth(0xe2d6b3),
    chineseCloth: cloth(0xe5c58f),
    persianCloth: cloth(0xf0ddba),
    mayaCloth: cloth(0xeee1bd),
    indigenousCloth: cloth(0xe5d5b5),
    teak: new MeshStandardMaterial({ color: 0x95643d, roughness: .86, side: DoubleSide }),
    cedar: new MeshStandardMaterial({ color: 0xb77c4c, roughness: .92, side: DoubleSide }),
    bark: new MeshStandardMaterial({ color: 0xc4a77a, roughness: 1, side: DoubleSide }),
    turquoise: new MeshStandardMaterial({ color: 0x357f80, roughness: .9, side: DoubleSide }),
    hide: cloth(0xd8c4a0),
    // Liveries of ships that are not the player's (painted sails replace these tints once loaded).
    enemyCloth: cloth(0x4a3a35),
    neutralCloth: cloth(0xc4c4c0),
    vikingCloth: cloth(0xd8c8a8),
    japaneseCloth: cloth(0xe6dcc6),
    nubianCloth: cloth(0xeae0c8),
    trim: new MeshStandardMaterial({ color: 0x823126, roughness: 0.82 }),
    gold: new MeshStandardMaterial({ color: 0xd9ad49, roughness: .36, metalness: .42 }),
    bronze: new MeshStandardMaterial({ color: 0xb19a52, roughness: .64, metalness: .55 }),
    cargo: new MeshStandardMaterial({ color: 0xb1a384, roughness: 1 }),
    /** Japanese black-brown and vermilion lacquer: glossier than oiled timber. */
    lacquer: new MeshStandardMaterial({ color: 0x2b1d16, roughness: .42 }),
    vermilion: new MeshStandardMaterial({ color: 0xa3241a, roughness: .45 }),
    /** Shoji paper and the Nubian woven palm-leaf awning. */
    paper: new MeshStandardMaterial({ color: 0xeee6d2, roughness: .95, side: DoubleSide }),
    reed: new MeshStandardMaterial({ color: 0xb98f55, roughness: 1, side: DoubleSide }),
    /** Nubian painted strakes. */
    ochre: new MeshStandardMaterial({ color: 0xc27a2c, roughness: .85 }),
    indigo: new MeshStandardMaterial({ color: 0x2c3f73, roughness: .85 }),
    /** The raider galley's pitch-tarred planking and its iron fittings. */
    tar: new MeshStandardMaterial({ color: 0x29221d, roughness: .62 }),
    iron: new MeshStandardMaterial({ color: 0x5d5f63, metalness: .55, roughness: .45 })
  };
  // Hull planking and painted strakes are seen from inside above the deck as well (the junk's
  // vermilion bulwark strake included: single-sided, it left a see-through gap above the deck).
  for (const name of ["wood", "dark", "trim", "lacquer", "vermilion", "ochre", "indigo", "tar"] as const) {
    materials[name].side = DoubleSide;
  }
  const woodTexture = craftTexture("grain"), clothTexture = craftTexture("cloth"), matTexture = craftTexture("mat");
  for (const name of [...TIMBER_MATERIALS, ...PAINTED_MATERIALS]) materials[name].map = woodTexture;
  for (const name of [...SAIL_MATERIALS, "cargo", "paper", "hide"] as const) materials[name].map = clothTexture;
  materials.reed.map = matTexture;
  return { dispose: () => { woodTexture.dispose(); clothTexture.dispose(); matTexture.dispose(); }, materials };
};

export type ShipMaterials = ReturnType<typeof createShipMaterials>["materials"];
export type ShipMaterialName = keyof ShipMaterials;

/** Natural timber: the premium timber bitmap replaces its procedural grain. */
export const TIMBER_MATERIALS = ["wood", "deck", "dark"] as const satisfies readonly ShipMaterialName[];
/** Painted or lacquered planks keep the pale procedural grain, so their paint keeps its colour. */
const PAINTED_MATERIALS = [
  "lacquer", "vermilion", "ochre", "indigo", "tar", "teak", "cedar", "bark", "turquoise"
] as const satisfies readonly ShipMaterialName[];
/** Sail cloths, one per nation and livery. */
export const SAIL_MATERIALS = [
  "cloth", "enemyCloth", "neutralCloth", "vikingCloth", "japaneseCloth", "nubianCloth",
  "chineseCloth", "persianCloth", "mayaCloth", "indigenousCloth"
] as const satisfies readonly ShipMaterialName[];

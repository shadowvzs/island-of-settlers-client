/** One shared brown-pigment atlas, rather than a texture/material for every building instance. */
export const INDIGENOUS_BUILDING_MOTIFS = [
  "granite", "coal", "iron", "gold", "marble", "limestone", "basalt", "bison", "fish", "mountains",
  "trees", "axe", "tools", "volcano", "wheat", "headdress", "people2", "people3", "people4", "fortress",
  "pig-head", "eagle", "berry-drink", "watchful-owl"
] as const;
export type IndigenousPigmentRegion=readonly[u:number,v:number,width:number,height:number];
export type IndigenousBuildingMotif = typeof INDIGENOUS_BUILDING_MOTIFS[number];
export const INDIGENOUS_MOTIF_ATLAS = { columns: 5, rows: 5 } as const;
const MOTIFS: Readonly<Partial<Record<number, IndigenousBuildingMotif>>> = {
  4: "watchful-owl",
  9: "fortress", 10: "granite", 11: "coal", 12: "iron", 13: "gold", 18: "fish", 19: "mountains",
  6: "berry-drink", 20: "trees", 21: "pig-head", 22: "bison", 24: "axe", 25: "tools", 27: "volcano", 37: "wheat", 40: "eagle", 43: "marble",
  47: "limestone", 51: "basalt", 55: "granite", 57: "people2", 58: "people3", 59: "people4", 62: "headdress"
};
export const indigenousBuildingMotif = (typeId: number) => MOTIFS[typeId];

export interface EliteHelmetIconSource {
  brow: number;
  centre: number[];
  headMatrix: number[];
  radii: number[];
  url: string;
}

export interface RaceHelmetIconOptions {
  elites?: Record<string, EliteHelmetIconSource>;
  nations?: string[];
}

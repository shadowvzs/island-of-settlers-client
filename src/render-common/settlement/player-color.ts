/** Linear RGB shared by player flags and minimap ownership overlays. */
export const DEFAULT_PLAYER_COLOR: [number, number, number] = [0.13, 0.32, 0.7];

/** Palette colours are sRGB; render frames use linear RGB. */
export const playerColorFromHex = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16);
  const linear = (byte: number) => {
    const component = byte / 255;
    return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4;
  };
  return [linear((value >> 16) & 255), linear((value >> 8) & 255), linear(value & 255)];
};

/** Linear RGB of hostile sides (the enemy flag, livery and death smoke) and of neutral units. */
export const ENEMY_FACTION_COLOR = playerColorFromHex("#c62828");
export const NEUTRAL_FACTION_COLOR: readonly [number, number, number] = [.55, .56, .56];

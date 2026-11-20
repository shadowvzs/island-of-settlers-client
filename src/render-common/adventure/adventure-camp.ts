import { DMath } from "../../shared/math/deterministic-math";
import type { AdventureCampTheme, CampTentVariant } from "./adventure-camp-style";

/** Camp centres: render dressing and shared solid shells, without buildings or plot reservations. */
export interface AdventureCampFrame {
  id: number; x: number; z: number; fogEnabled?: boolean; theme?: AdventureCampTheme;
  /** Derived solid plots shared by dressing placement and navigation; never a separate saved layout. */
  defencePlots?: readonly { x: number; z: number; width: number; depth: number }[];
}
export type CampDecorationKind = "tent" | "palisade" | "firepit" | "rack";
export interface CampDecoration { kind: CampDecorationKind; x: number; z: number; yaw: number; radius: number; variant?: CampTentVariant }
/** Enemy spawn rings extend 4.8 tiles. Keep the complete central assembly ground unobstructed. */
export const CAMP_ASSEMBLY_RADIUS = 5.4;

export const adventureCampDecorations = (): readonly CampDecoration[] => {
  const decorations: CampDecoration[] = [
    { kind: "tent", variant: "command", radius: 2.6, x: -7.3, yaw: -.35, z: -5.1 },
    { kind: "palisade", radius: 1.4, x: -8.2, yaw: -.6, z: 2.4 },
    { kind: "palisade", radius: 1.4, x: 8.2, yaw: .6, z: 2.4 },
    { kind: "rack", radius: 1, x: -4.5, yaw: -.25, z: -7.5 },
    { kind: "firepit", radius: .85, x: 0, yaw: 0, z: 7.3 }
  ];
  return decorations;
};

/** Separate camps may overlap at the perimeter; keep every other assembly ground clear too. */
export const campDecorationClearsAssemblies = (
  camp: AdventureCampFrame, decoration: CampDecoration, camps: readonly AdventureCampFrame[]
) => camps.every(other => DMath.hypot(camp.x + decoration.x - other.x,
  camp.z + decoration.z - other.z) - decoration.radius >= CAMP_ASSEMBLY_RADIUS);

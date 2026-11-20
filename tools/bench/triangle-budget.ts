/** Up to this share over a triangle budget only warns (owner 2026-10-20); beyond it the export fails. */
const TRIANGLE_BUDGET_TOLERANCE = 0.15;

type TriangleBudgetResult = "ok" | "warn" | "fail";

export const checkTriangleBudget = (triangles: number, budget: number): TriangleBudgetResult => {
  if (triangles < budget) return "ok";
  return triangles <= budget * (1 + TRIANGLE_BUDGET_TOLERANCE) ? "warn" : "fail";
};

/** Logs a tolerated overrun and reports whether the budget check failed. */
export const triangleBudgetFails = (label: string, triangles: number, budget: number) => {
  const result = checkTriangleBudget(triangles, budget);
  if (result === "warn") console.warn(`Triangle budget warning: ${label} (${triangles}/${budget})`);
  return result === "fail";
};

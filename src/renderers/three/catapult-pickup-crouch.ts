/** Keep the shoulders near a floor-level stone during the middle of its physical lift.
 * The original deepest crouch remains the upper bound; feet continue using their fixed leg targets.
 */
export const catapultPickupCrouch = (reach: number, progress: number, pickup: boolean) => {
  const original = .4 * reach;
  if (!pickup || progress <= .4 || progress >= .95) return original;
  const middleLift = Math.sin(Math.PI * (progress - .4) / .55);
  return Math.min(.4, original + .04 * middleLift * middleLift);
};

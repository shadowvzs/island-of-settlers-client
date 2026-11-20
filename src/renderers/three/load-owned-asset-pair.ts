/** Wait for both owned loads so a failed sibling cannot abandon a late successful resource. */
export const loadOwnedAssetPair = async <A, B>(
  first: Promise<A>, second: Promise<B>, disposeFirst: (asset: A) => void,
  disposeSecond: (asset: B) => void
): Promise<[A, B]> => {
  const [left, right] = await Promise.allSettled([first, second]);
  if (left.status === "fulfilled" && right.status === "fulfilled") return [left.value, right.value];
  if (left.status === "fulfilled") disposeFirst(left.value);
  if (right.status === "fulfilled") disposeSecond(right.value);
  throw left.status === "rejected" ? left.reason : (right as PromiseRejectedResult).reason;
};

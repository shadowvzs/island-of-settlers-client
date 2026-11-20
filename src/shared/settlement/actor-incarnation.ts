const incarnations = new WeakMap<object, object>();

/** Session-only identity: a recycled civilian object/UID represents a new person. Never saved. */
export const actorIncarnation = (actor: object) => {
  let identity = incarnations.get(actor);
  if (!identity) {
    identity = {};
    incarnations.set(actor, identity);
  }
  return identity;
};

export const renewActorIncarnation = (actor: object) => {
  incarnations.set(actor, {});
};

import { useState } from "react";

import { MultiboardStack } from "../app/script/multiboard/multiboard-stack";
import { createMultiboardReviewSession, type MultiboardReviewOptions } from "./multiboard-review-session";

interface MultiboardReviewProps {
  options: MultiboardReviewOptions;
}
/** The multiboard stack (TRG8) fed by the real script engine; the buttons stand in for the simulation's events. */
export const MultiboardReview = ({ options }: MultiboardReviewProps) => {
  const [session] = useState(() => createMultiboardReviewSession(options));
  return (
    <>
      <div className="review__multiboard-tools">
        <button data-review="plant" type="button" onClick={session.plantTree}>Plant a tree</button>
        <button data-review="recruit" type="button" onClick={session.recruitSoldier}>Recruit a soldier</button>
        <button data-review="second" type="button" onClick={session.passSecond}>Pass a second</button>
      </div>
      <div className="settlement-ui review__multiboard-hud">
        <div className="multiboard-layer"><MultiboardStack /></div>
      </div>
    </>
  );
};

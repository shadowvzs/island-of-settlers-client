import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";

import { translateDomainText } from "../../shared/i18n/domain";
import type { RoadDecorationFrame } from "../../shared/settlement/road-decoration-state";
import { ROAD_DECORATION_MESSAGES as M } from "./road-decoration-presentation";
import type { RoadDecorationWindowControl } from "./road-decoration-window";

interface Options {
  control: RoadDecorationWindowControl;
  frame?: RoadDecorationFrame;
  close(): void;
  refresh(uid: number): void;
}

export const useRoadDecorationActions = ({ close, control, frame, refresh }: Options) => {
  const { i18n } = useLingui(), alive = useRef(true), working = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (action: "pickUp" | "rotate" | "move") => {
    if (!frame || working.current) return;
    working.current = true; setBusy(true); setMessage(i18n._(M.working));
    try {
      const result = await control[action](frame.uid);
      if (!alive.current) return;
      if (result !== true) {
        setMessage(result === "decoration-not-placed" ? i18n._(M.missing) : translateDomainText(result, i18n));
        return;
      }
      if (action === "rotate") { refresh(frame.uid); setMessage(""); return; }
      setMessage(""); close();
    } catch { if (alive.current) setMessage(i18n._(M.missing)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  return { busy, message, move: () => { void run("move"); }, pickUp: () => { void run("pickUp"); },
    rotate: () => { void run("rotate"); } };
};

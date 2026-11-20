import { useLingui } from "@lingui/react";
import { type KeyboardEvent, type PointerEvent, useState } from "react";

import { translateMessage } from "../../../../shared/i18n/translate";
import type { CampaignEditor } from "../campaign-editor";
import { MAP_VIEW_BOX } from "../constants";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { useCampaignEditorState } from "../use-campaign-editor";
import {
  mapViewAspect, mapViewModel, mapViewRatio, nudgeNodePosition, pointerToNodePosition, setNodePosition
} from "./helpers";

interface NodeDrag {
  mapId: string;
  pointerId: number;
  u: number;
  v: number;
}

/**
 * The campaign map view: nodes over the campaign image, dashed arrows along the campaign's paths. A drag moves the
 * node locally (no store write per pointer move) and commits u,v once on release; arrow keys nudge.
 */
export const useMapView = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<NodeDrag | null>(null);
  const draft = state.draft!;
  const shown = drag ? setNodePosition(draft, drag.mapId, drag.u, drag.v) : draft;
  const image = draft.imageId ? state.images[draft.imageId] ?? null : null;
  const ratio = mapViewRatio(image);
  const { endings, nodes, paths } = mapViewModel(shown, state.maps, state.selectedMapId, i18n.locale, ratio);
  const positionAt = (event: PointerEvent) => {
    const rect = frame?.getBoundingClientRect();
    return rect ? pointerToNodePosition(rect, event.clientX, event.clientY) : null;
  };
  return {
    aspect: mapViewAspect(image),
    endings,
    help: translateMessage(i18n, M.notes.mapView),
    imageUrl: image?.url ?? null,
    noImageNote: translateMessage(i18n, M.notes.noImage),
    nodes: nodes.map(node => ({
      ...node,
      ariaLabel: translateMessage(i18n, M.notes.mapNode, { name: node.name, position: node.label }),
      dragging: drag?.mapId === node.id
    })),
    paths,
    setFrame,
    title: translateMessage(i18n, M.sections.mapView),
    viewBox: `0 0 ${MAP_VIEW_BOX * ratio} ${MAP_VIEW_BOX}`,
    onNodeKeyDown: (event: KeyboardEvent, node: { id: string; u: number; v: number }) => {
      const next = nudgeNodePosition(node, event.key, event.shiftKey);
      if (!next) return;
      event.preventDefault();
      editor.setNode(node.id, next.u, next.v);
    },
    onNodePointerDown: (event: PointerEvent, mapId: string) => {
      const position = positionAt(event);
      if (!position || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      editor.selectMap(mapId);
      setDrag({ mapId, pointerId: event.pointerId, ...position });
    },
    onNodePointerMove: (event: PointerEvent) => {
      const position = positionAt(event);
      if (drag && position && event.pointerId === drag.pointerId) setDrag({ ...drag, ...position });
    },
    onNodePointerUp: (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      editor.setNode(drag.mapId, drag.u, drag.v);
      setDrag(null);
    }
  };
};

import type { CampaignEditor } from "../campaign-editor";
import { MAP_ENDING_RADIUS } from "../constants";
import { useMapView } from "./use-map-view";

interface MapViewProps {
  editor: CampaignEditor;
}
/**
 * The campaign map view (plan item 52): the image scaled to the width, an SVG overlay for the dashed path arrows
 * and campaign-end markers (no WebGL) and 44 px node buttons at their u,v positions.
 */
export const MapView = ({ editor }: MapViewProps) => {
  const { setFrame, ...view } = useMapView(editor);
  return (
    <section aria-label={view.title} className="campaign-editor__map-view-section">
      <p className="campaign-editor__hint">{view.help}</p>
      <div className="campaign-editor__map-view" ref={setFrame} style={{ aspectRatio: view.aspect }}>
        {view.imageUrl && <img alt="" className="campaign-editor__map-image" draggable={false} src={view.imageUrl} />}
        {!view.imageUrl && <p className="campaign-editor__map-placeholder">{view.noImageNote}</p>}
        <svg aria-hidden="true" className="campaign-editor__map-paths" preserveAspectRatio="none"
          viewBox={view.viewBox}>
          {view.paths.map(path => (
            <g className="campaign-editor__map-path" key={path.id}>
              <line vectorEffect="non-scaling-stroke" x1={path.x1} x2={path.x2} y1={path.y1} y2={path.y2} />
              <polygon points={path.head} />
            </g>
          ))}
          {view.endings.map(ending => (
            <g className="campaign-editor__map-ending" key={ending.id}>
              <line vectorEffect="non-scaling-stroke" x1={ending.x1} x2={ending.x2} y1={ending.y1} y2={ending.y2} />
              <circle cx={ending.x2} cy={ending.y2} r={MAP_ENDING_RADIUS} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
        {view.nodes.map(node => (
          <button aria-label={node.ariaLabel} className="campaign-editor__map-node" data-dragging={node.dragging}
            data-selected={node.selected} key={node.id} style={{ left: node.left, top: node.top }}
          title={node.name} type="button" onKeyDown={event => view.onNodeKeyDown(event, node)}
          onPointerCancel={view.onNodePointerUp} onPointerDown={event => view.onNodePointerDown(event, node.id)}
          onPointerMove={view.onNodePointerMove} onPointerUp={view.onNodePointerUp}>
            <span>{node.label}</span>
            <span className="campaign-editor__map-node-name">{node.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

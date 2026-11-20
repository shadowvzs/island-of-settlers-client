import { PATH_ENDING_RADIUS } from "./constants";
import type { PathGraphModel } from "./path-graph-helpers";

interface CampaignPathGraphProps {
  graph: PathGraphModel;
  label: string;
  onSelect: (id: string) => void;
}
/**
 * The compact path graph (BR4): numbered map circles by graph layer, SVG arrows along the campaign's edges and end
 * rings; it scrolls sideways when the campaign is wider than the window. A node selects its map like a list row.
 */
export const CampaignPathGraph = ({ graph, label, onSelect }: CampaignPathGraphProps) => (
  <div aria-label={label} className="campaign-window__path-graph" role="group">
    <div className="campaign-window__path-canvas" style={{ height: graph.height, width: graph.width }}>
      <svg aria-hidden="true" className="campaign-window__paths" height={graph.height} viewBox={graph.viewBox}
        width={graph.width}>
        {graph.edges.map(edge => (
          <g className={edge.className} key={edge.id}>
            <line x1={edge.x1} x2={edge.x2} y1={edge.y1} y2={edge.y2} />
            <polygon points={edge.head} />
          </g>
        ))}
        {graph.endings.map(ending => (
          <g className={ending.className} key={ending.id}>
            <line x1={ending.x1} x2={ending.x2} y1={ending.y1} y2={ending.y2} />
            <circle cx={ending.x2} cy={ending.y2} r={PATH_ENDING_RADIUS} />
          </g>
        ))}
      </svg>
      {graph.nodes.map(node => (
        <button aria-label={node.title} aria-pressed={node.selected} className={node.className}
          data-campaign-node={node.id} data-status={node.node} key={node.id} style={{ left: node.left, top: node.top }}
          title={node.title} type="button" onClick={() => onSelect(node.id)}>
          <span className="campaign-window__path-number">{node.label}</span>
          <span className="campaign-window__path-name">{node.name}</span>
        </button>
      ))}
    </div>
  </div>
);

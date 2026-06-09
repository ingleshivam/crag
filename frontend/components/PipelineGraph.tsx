"use client";

// Node positions in a 500×220 viewBox
// retrieve → grade_documents → generate (main path)
//                           ↘ transform_query → (loop back to retrieve)

const NODES = [
  { id: "retrieve",          x: 60,  y: 110, label: "Retrieve",         color: "#3b82f6" },
  { id: "grade_documents",   x: 190, y: 110, label: "Grade",            color: "#f59e0b" },
  { id: "transform_query",   x: 310, y: 185, label: "Rewrite Query",    color: "#f97316" },
  { id: "generate",          x: 420, y: 110, label: "Generate",         color: "#10b981" },
] as const;

type NodeId = (typeof NODES)[number]["id"];

const EDGES: { from: NodeId; to: NodeId; label?: string; dashed?: boolean }[] = [
  { from: "retrieve",        to: "grade_documents" },
  { from: "grade_documents", to: "generate",        label: "relevant" },
  { from: "grade_documents", to: "transform_query", label: "not relevant" },
  { from: "transform_query", to: "retrieve",        label: "retry",     dashed: true },
];

interface Props {
  activeNode?: string | null;
}

function nodeById(id: NodeId) {
  return NODES.find((n) => n.id === id)!;
}

function arrow(fromId: NodeId, toId: NodeId, dashed: boolean) {
  const from = nodeById(fromId);
  const to = nodeById(toId);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / len;
  const ny = dy / len;
  const r = 28;
  const x1 = from.x + nx * r;
  const y1 = from.y + ny * r;
  const x2 = to.x - nx * r;
  const y2 = to.y - ny * r;

  if (dashed) {
    // Curved arc for the loop-back
    return `M ${from.x - 10} ${from.y + 30} C ${from.x - 30} ${from.y + 70} ${to.x - 30} ${to.y + 70} ${to.x - 10} ${to.y + 30}`;
  }
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

export default function PipelineGraph({ activeNode }: Props) {
  return (
    <svg
      viewBox="0 0 500 240"
      className="w-full"
      style={{ fontFamily: "inherit" }}
    >
      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--pipe-edge)" />
        </marker>
        <marker id="arr-dashed" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--pipe-edge)" />
        </marker>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Edges */}
      {EDGES.map((e) => {
        const d = arrow(e.from, e.to, !!e.dashed);
        const mx = (nodeById(e.from).x + nodeById(e.to).x) / 2;
        const my = e.dashed ? 210 : (nodeById(e.from).y + nodeById(e.to).y) / 2 - 8;
        return (
          <g key={`${e.from}-${e.to}`}>
            <path
              d={d}
              fill="none"
              stroke="var(--pipe-edge)"
              strokeWidth="1.5"
              strokeDasharray={e.dashed ? "4 3" : undefined}
              markerEnd={e.dashed ? "url(#arr-dashed)" : "url(#arr)"}
            />
            {e.label && (
              <text
                x={mx}
                y={my}
                textAnchor="middle"
                fontSize="8"
                fill="var(--pipe-label)"
              >
                {e.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {NODES.map((node) => {
        const isActive = activeNode === node.id;
        return (
          <g key={node.id} transform={`translate(${node.x},${node.y})`}>
            {/* Glow ring when active */}
            {isActive && (
              <circle
                r="32"
                fill="none"
                stroke={node.color}
                strokeWidth="3"
                opacity="0.35"
                filter="url(#glow)"
              >
                <animate attributeName="r" values="30;34;30" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0.15;0.35" dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}
            {/* Node circle */}
            <circle
              r="26"
              fill="var(--pipe-node-bg)"
              stroke={node.color}
              strokeWidth={isActive ? 2 : 1.5}
            />
            {/* Dot indicator */}
            <circle cx="0" cy="-10" r="4" fill={node.color} opacity={isActive ? 1 : 0.7} />
            {/* Label */}
            <text
              y="6"
              textAnchor="middle"
              fontSize="7.5"
              fontWeight={isActive ? "700" : "500"}
              fill={isActive ? node.color : "var(--pipe-label)"}
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

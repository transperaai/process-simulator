"use client";

import { Background, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import type { SimulationResult } from "@transpera-flow/engine";
import type { ProcessBundle, RoleRow, StepRow } from "@transpera-flow/db";
import { formatHours, formatNumber } from "@/lib/format";

type StepNodeData = {
  step: StepRow;
  role: RoleRow | null;
  avgQueue: number | null;
  bottleneck: boolean;
};

type StepFlowNode = Node<StepNodeData, "step">;
type TerminalFlowNode = Node<{ step: StepRow }, "terminal">;

function StepNode({ data }: NodeProps<StepFlowNode>) {
  const { step, role, avgQueue, bottleneck } = data;
  const label = `${step.name}${role ? `, ${role.name}` : ""}, ${formatHours(step.work_hours)} work, ${formatHours(step.wait_hours)} wait`;
  return (
    <div
      aria-label={label}
      className={`w-44 overflow-hidden rounded-token border bg-panel shadow-token ${bottleneck ? "border-crit ring-2 ring-crit/40" : "border-line-2"}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-line-2" />
      <div className="h-1" style={{ background: role?.color ?? "var(--line-2)" }} />
      <div className="px-2.5 py-2">
        <p className="font-semibold leading-tight">{step.name}</p>
        <p className="text-xs text-fg-2">{role?.name ?? (step.kind === "decision" ? "Decision" : "Wait")}</p>
        <p className="mt-1 flex justify-between font-mono text-[11px] text-fg-3 tabular-nums">
          <span>{step.work_hours ? `${formatHours(step.work_hours)} work` : "—"}</span>
          <span>{step.wait_hours ? `${formatHours(step.wait_hours)} wait` : ""}</span>
        </p>
        {avgQueue !== null && role && (
          <p className={`mt-1 text-xs tabular-nums ${bottleneck ? "font-semibold text-crit" : "text-fg-2"}`}>
            avg queue {formatNumber(avgQueue)}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-line-2" />
    </div>
  );
}

function TerminalNode({ data }: NodeProps<TerminalFlowNode>) {
  const { step } = data;
  const tone = step.outcome === "won" ? "bg-good-soft text-fg" : step.outcome === "lost" ? "bg-panel-2 text-fg-2" : "bg-accent-soft text-fg";
  return (
    <div aria-label={step.name} className={`rounded-full border border-line-2 px-3 py-1.5 text-xs font-semibold ${tone}`}>
      {step.kind !== "start" && <Handle type="target" position={Position.Left} className="!bg-line-2" />}
      {step.name}
      {step.kind === "start" && <Handle type="source" position={Position.Right} className="!bg-line-2" />}
    </div>
  );
}

const nodeTypes = { step: StepNode, terminal: TerminalNode };

export function ProcessCanvas({ bundle, result }: { bundle: ProcessBundle; result: SimulationResult | null }) {
  const { nodes, edges } = useMemo(() => {
    const roles = new Map(bundle.roles.map((r) => [r.id, r]));
    const nodes: (StepFlowNode | TerminalFlowNode)[] = bundle.steps.map((step) =>
      step.kind === "start" || step.kind === "end"
        ? { id: step.id, type: "terminal", position: { x: Number(step.x), y: Number(step.y) }, data: { step } }
        : {
            id: step.id,
            type: "step",
            position: { x: Number(step.x), y: Number(step.y) },
            data: {
              step,
              role: step.role_id ? (roles.get(step.role_id) ?? null) : null,
              avgQueue: result?.steps[step.id]?.avgQueue ?? null,
              bottleneck: result?.bnStep === step.id,
            },
          },
    );
    const edges: Edge[] = bundle.edges.map((e) => {
      const p = Number(e.probability);
      return {
        id: e.id,
        source: e.from_step_id,
        target: e.to_step_id,
        type: "smoothstep",
        label: p < 1 ? `${Math.round(p * 100)}%` : undefined,
        labelBgStyle: { fill: "var(--panel)" },
        labelStyle: { fill: "var(--fg-2)", fontSize: 11 },
        style: { stroke: "var(--line-2)", strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--line-2)" },
      };
    });
    return { nodes, edges };
  }, [bundle, result]);

  return (
    <div className="h-[28rem] w-full rounded-token border border-line bg-panel md:h-[34rem]" aria-label={`${bundle.process.name} process map`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.3}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--line)" gap={24} />
      </ReactFlow>
    </div>
  );
}

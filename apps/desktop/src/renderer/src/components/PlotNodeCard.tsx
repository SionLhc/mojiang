import { Handle, Position, type NodeProps } from '@xyflow/react';
import { plotKindStyle, type PlotNode } from '@mojiang/core';

/** 节点卡片的数据 */
export interface PlotNodePayload {
    node: PlotNode;
    /** AI 诊断是否指向了它 */
    issue?: 'warn' | 'error';
}

/**
 * 画布上的剧情节点卡片
 * 左侧色条表示类型，底部人物标签，绑定章节时右上角显示章号
 */
export default function PlotNodeCard({ data, selected }: NodeProps) {
    const payload = data as unknown as PlotNodePayload;
    const node = payload.node;
    if (!node) {
        return null;
    }

    const style = plotKindStyle(node.kind);

    return (
        <div
            className={`plot-node ${selected ? 'is-selected' : ''} ${
                payload.issue ? `has-${payload.issue}` : ''
            }`}
            style={{ borderLeftColor: style.color, backgroundColor: style.tint }}
        >
            <Handle type="target" position={Position.Left} className="plot-handle" />

            <div className="flex items-center gap-1.5">
                <span
                    className="rounded px-1 py-0.5 text-[12px] font-medium text-white"
                    style={{ backgroundColor: style.color }}
                >
                    {style.name}
                </span>
                {node.chapter ? (
                    <span className="text-[12px] text-ink-500">第 {node.chapter} 章</span>
                ) : null}
            </div>

            <p className="mt-1 truncate text-[14px] font-medium text-ink-100">{node.title}</p>

            {node.summary.trim().length > 0 && (
                <p className="mt-0.5 overflow-hidden text-[13px] leading-snug text-ink-400" style={{ maxHeight: 54 }}>
                    {node.summary}
                </p>
            )}

            {node.characters.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                    {node.characters.map((name) => (
                        <span
                            key={name}
                            className="rounded bg-ink-800 px-1 py-0.5 text-[12px] text-ink-300"
                        >
                            {name}
                        </span>
                    ))}
                </div>
            )}

            <Handle type="source" position={Position.Right} className="plot-handle" />
        </div>
    );
}

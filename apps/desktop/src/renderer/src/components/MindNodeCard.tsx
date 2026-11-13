import { Handle, Position, type NodeProps } from '@xyflow/react';
import { mindDepthColor, type MindBoardNode } from '@mojiang/core';

/** 导图节点卡片的数据 */
export interface MindNodePayload {
    node: MindBoardNode;
}

/**
 * 画布上的导图节点卡片
 * 左侧色条和层级徽标按深度着色：中心主题 → 一级 → 二级 → 三级
 */
export default function MindNodeCard({ data, selected }: NodeProps) {
    const payload = data as unknown as MindNodePayload;
    const node = payload.node;
    if (!node) {
        return null;
    }

    const color = mindDepthColor(node.depth);
    // 层级徽标文案：0 是中心主题，往后是 L1 / L2 …
    const depthLabel = node.depth === 0 ? '主题' : `L${node.depth}`;

    return (
        <div
            className={`mind-node ${selected ? 'is-selected' : ''}`}
            style={{ borderLeftColor: color }}
        >
            <Handle type="target" position={Position.Left} className="plot-handle" />

            <div className="flex items-center gap-1.5">
                <span
                    className="rounded px-1 py-0.5 text-[12px] font-medium text-white"
                    style={{ backgroundColor: color }}
                >
                    {depthLabel}
                </span>
            </div>

            <p className="mt-1 text-[14px] font-medium leading-snug text-ink-100">{node.title}</p>

            <Handle type="source" position={Position.Right} className="plot-handle" />
        </div>
    );
}

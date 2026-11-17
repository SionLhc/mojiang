/**
 * 剧情画板摘要
 * 喂给 AI 的画板不是"前 N 个节点"，而是"最近 N 个"——
 * 书写到几十万字时，前面最早的那批节点早就跟当前情节无关了。
 */

import { PLOT_NODE_KINDS, type PlotGraph, type PlotNode } from './plot';

/** 最多带多少个节点 */
export const PLOT_NODE_LIMIT = 60;

/** 最多带多少条连线 */
export const PLOT_EDGE_LIMIT = 12;

/**
 * 把剧情图压成一段摘要
 * 有章号的按章号排序取最近的，没章号的补在后面；连线只在两端都还在时输出
 * @param graph 剧情图
 * @returns 摘要文本，画板为空时返回空串
 */
export function renderPlotDigest(graph: PlotGraph): string {
    const kindName = new Map(PLOT_NODE_KINDS.map((item) => [item.kind, item.name]));
    /** 章号有效才参与排序 */
    const hasChapter = (node: PlotNode): boolean =>
        typeof node.chapter === 'number' && node.chapter > 0;

    const located = graph.nodes
        .filter(hasChapter)
        .sort((a, b) => (a.chapter as number) - (b.chapter as number));
    const floating = graph.nodes.filter((node) => !hasChapter(node));
    // 最近的在后面，接上没绑章号的节点，再整体截到上限
    const recent = [...located.slice(-PLOT_NODE_LIMIT), ...floating].slice(0, PLOT_NODE_LIMIT);
    if (recent.length === 0) {
        return '';
    }

    const titleById = new Map(recent.map((node) => [node.id, node.title]));
    const lines = recent.map((node) => {
        const name = kindName.get(node.kind) ?? node.kind;
        const head = hasChapter(node) ? `第${node.chapter}章 ` : '';
        const summary = node.summary.trim();
        return `- ${head}【${name}】${node.title}${summary ? `：${summary}` : ''}`;
    });

    const edges = graph.edges
        .filter((edge) => titleById.has(edge.source) && titleById.has(edge.target))
        .slice(0, PLOT_EDGE_LIMIT)
        .map((edge) => {
            const kind =
                edge.kind === 'cause' ? '因果' : edge.kind === 'foreshadow' ? '伏笔' : '并行';
            const label = edge.label ? `（${edge.label}）` : '';
            return `- ${titleById.get(edge.source)} → ${titleById.get(edge.target)}：${kind}${label}`;
        });

    const blocks = [...lines];
    if (edges.length > 0) {
        blocks.push('', '【连线】', ...edges);
    }
    return blocks.join('\n');
}

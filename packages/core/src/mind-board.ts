/**
 * 思维导图画板：数据结构与自动排版
 *
 * 和剧情画板（plot）是两块不同的画板：
 * - 剧情画板管剧情节点、伏笔、AI 结构诊断
 * - 导图板管思维导图/流程图，按层级着色，可以自动排版
 * 两者数据各存各的，互不混用。
 */

import type { DiagramLayout } from './text/diagram';

/** 导图板节点 */
export interface MindBoardNode {
    /** 短 id，b1 / b2 …… */
    id: string;
    /** 节点文字 */
    title: string;
    /** 层级：0 是中心主题，越大越靠外 */
    depth: number;
    x: number;
    y: number;
}

/** 导图板连线 */
export interface MindBoardEdge {
    id: string;
    source: string;
    target: string;
    /** 连线文字，如"是/否" */
    label?: string;
}

/** 整张导图板 */
export interface MindBoardGraph {
    nodes: MindBoardNode[];
    edges: MindBoardEdge[];
    updatedAt: string;
}

/** 层级配色：中心主题到最外圈共 4 档 */
export const MIND_DEPTH_COLORS = ['#1f7a5c', '#3b6cb5', '#b4761f', '#7c6bc4'];

/**
 * 按层级取颜色
 * @param depth 层级，超出范围夹住
 * @returns 十六进制颜色
 */
export function mindDepthColor(depth: number): string {
    const safe = Math.min(Math.max(Math.round(depth), 0), MIND_DEPTH_COLORS.length - 1);
    return MIND_DEPTH_COLORS[safe];
}

/**
 * 生成下一个节点 id
 * @param nodes 现有节点
 * @returns 形如 b7
 */
export function nextMindBoardNodeId(nodes: MindBoardNode[]): string {
    let max = 0;
    for (const node of nodes) {
        const matched = node.id.match(/^b(\d+)$/);
        if (matched) {
            max = Math.max(max, Number(matched[1]));
        }
    }
    return `b${max + 1}`;
}

/**
 * 建一个导图板节点
 * @param title 文字
 * @param x 横坐标
 * @param y 纵坐标
 * @param depth 层级
 * @param id 指定 id，不传用 b1
 * @returns 节点
 */
export function createMindBoardNode(
    title: string,
    x: number,
    y: number,
    depth = 0,
    id = 'b1',
): MindBoardNode {
    return { id, title, depth, x, y };
}

/**
 * 把图表布局（思维导图/流程图）转成导图板节点
 * 布局里的临时 id 换成导图板 id，层级原样保留
 * @param layout 图表布局结果
 * @param existing 现有节点，用于续编号
 * @param offset 坐标偏移，多次铺入时错开用
 * @returns 节点与连线
 */
export function layoutToMindBoard(
    layout: DiagramLayout,
    existing: MindBoardNode[],
    offset: { x: number; y: number } = { x: 0, y: 0 },
): { nodes: MindBoardNode[]; edges: MindBoardEdge[] } {
    // 布局里的 id（m0 / 流程 id）映射到导图板 id（b1 / b2…）
    // 用最大编号往后续，删过节点也不会撞号
    let maxId = 0;
    for (const node of existing) {
        const matched = node.id.match(/^b(\d+)$/);
        if (matched) {
            maxId = Math.max(maxId, Number(matched[1]));
        }
    }
    const idMap = new Map<string, string>();
    const nodes: MindBoardNode[] = layout.boxes.map((box, index) => {
        const id = `b${maxId + index + 1}`;
        idMap.set(box.id, id);
        return {
            id,
            title: box.label,
            depth: box.depth,
            x: Math.round(box.x + offset.x),
            y: Math.round(box.y + offset.y),
        };
    });

    const edges: MindBoardEdge[] = [];
    layout.edges.forEach((edge, index) => {
        const source = idMap.get(edge.from);
        const target = idMap.get(edge.to);
        // 两端不在本次转换里就不带过去，画板上不留悬空线
        if (!source || !target) {
            return;
        }
        edges.push({
            id: `e-${source}-${target}-${index}`,
            source,
            target,
            label: edge.label,
        });
    });

    return { nodes, edges };
}

/**
 * 自动排版：从根节点往叶子展开，同层竖向等距
 * 有环也能排：走过的节点不再重复展开
 * @param graph 导图板
 * @returns 排好版的新图（不改原对象）
 */
export function autoArrangeMindBoard(graph: MindBoardGraph): MindBoardGraph {
    const childrenMap = new Map<string, string[]>();
    const incoming = new Set<string>();
    for (const edge of graph.edges) {
        const bucket = childrenMap.get(edge.source) ?? [];
        bucket.push(edge.target);
        childrenMap.set(edge.source, bucket);
        incoming.add(edge.target);
    }
    // 没有入边的是根；全是环就各排各的
    const roots = graph.nodes.filter((node) => !incoming.has(node.id));
    const startNodes = roots.length > 0 ? roots : graph.nodes.slice(0, 1);

    const positions = new Map<string, { x: number; y: number; depth: number }>();
    let nextRow = 0;
    const visited = new Set<string>();

    /**
     * 深度优先摆一个子树：叶子占一行，父节点取子节点中间
     * @param nodeId 节点 id
     * @param depth 层级
     * @returns 该子树的纵向中心
     */
    function place(nodeId: string, depth: number): number {
        const children = (childrenMap.get(nodeId) ?? []).filter((child) => !visited.has(child));
        visited.add(nodeId);
        const x = depth * 300 + 60;
        if (children.length === 0) {
            const y = nextRow * 130 + 60;
            nextRow += 1;
            positions.set(nodeId, { x, y, depth });
            return y;
        }
        const centers = children.map((child) => place(child, depth + 1));
        const center = (centers[0] + centers[centers.length - 1]) / 2;
        positions.set(nodeId, { x, y: center, depth });
        return center;
    }

    for (const root of startNodes) {
        if (!visited.has(root.id)) {
            place(root.id, 0);
        }
    }

    // 孤立节点（不在任何边上）也给个位置，排在最下面
    for (const node of graph.nodes) {
        if (!positions.has(node.id)) {
            positions.set(node.id, { x: 60, y: nextRow * 130 + 60, depth: 0 });
            nextRow += 1;
        }
    }

    return {
        nodes: graph.nodes.map((node) => {
            const position = positions.get(node.id) ?? { x: node.x, y: node.y, depth: node.depth };
            return { ...node, x: position.x, y: position.y, depth: position.depth };
        }),
        edges: graph.edges.map((edge) => ({ ...edge })),
        updatedAt: new Date().toISOString(),
    };
}

/**
 * 把导图画板序列化回文本源（画板 → 文本，和"应用到画板"反向）
 * 思维导图模式：按树结构输出缩进列表，两个空格一级
 * 流程图模式：每条边一行「A -> B : 文字」，孤立节点单行输出
 * @param graph 导图画板
 * @param mode 图的类型
 * @returns 文本源
 */
export function mindBoardToOutline(graph: MindBoardGraph, mode: 'mindmap' | 'flow'): string {
    const titleOf = new Map(graph.nodes.map((node) => [node.id, node.title]));

    if (mode === 'flow') {
        const lines: string[] = [];
        const connected = new Set<string>();
        for (const edge of graph.edges) {
            const from = titleOf.get(edge.source);
            const to = titleOf.get(edge.target);
            // 悬空线不输出
            if (!from || !to) {
                continue;
            }
            connected.add(edge.source);
            connected.add(edge.target);
            lines.push(edge.label ? `${from} -> ${to} : ${edge.label}` : `${from} -> ${to}`);
        }
        // 孤立节点单行输出，parseFlow 认这种写法
        for (const node of graph.nodes) {
            if (!connected.has(node.id)) {
                lines.push(node.title);
            }
        }
        return lines.join('\n');
    }

    // 思维导图：先按边建树，再深度优先展开成缩进列表
    const childrenMap = new Map<string, string[]>();
    const incoming = new Set<string>();
    for (const edge of graph.edges) {
        if (!titleOf.has(edge.source) || !titleOf.has(edge.target)) {
            continue;
        }
        const bucket = childrenMap.get(edge.source) ?? [];
        bucket.push(edge.target);
        childrenMap.set(edge.source, bucket);
        incoming.add(edge.target);
    }
    // 没有入边的是根；全是环就从第一个开始
    const roots = graph.nodes.filter((node) => !incoming.has(node.id));
    const startNodes = roots.length > 0 ? roots : graph.nodes.slice(0, 1);

    const lines: string[] = [];
    const visited = new Set<string>();

    /**
     * 深度优先输出一行节点和它的子树
     * @param nodeId 节点 id
     * @param depth 缩进层级
     */
    function walk(nodeId: string, depth: number): void {
        if (visited.has(nodeId)) {
            return;
        }
        visited.add(nodeId);
        lines.push(`${'  '.repeat(depth)}- ${titleOf.get(nodeId) ?? nodeId}`);
        for (const child of childrenMap.get(nodeId) ?? []) {
            walk(child, depth + 1);
        }
    }

    for (const root of startNodes) {
        walk(root.id, 0);
    }
    // 孤立节点补在最后，当顶级
    for (const node of graph.nodes) {
        if (!visited.has(node.id)) {
            walk(node.id, 0);
        }
    }
    return lines.join('\n');
}

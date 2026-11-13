/**
 * 图表：思维导图 + 流程图的解析与自动布局
 * 数据源是纯文本（缩进列表 / A -> B 边列表），布局结果是 SVG 要用的坐标。
 * 不依赖任何绘图库，方便自检，也方便以后换渲染方式。
 */

/** 节点形状：圆角（起止）/ 矩形（步骤）/ 菱形（判断） */
export type DiagramShape = 'round' | 'rect' | 'diamond';

/** 布局后的节点 */
export interface DiagramBox {
    id: string;
    label: string;
    shape: DiagramShape;
    x: number;
    y: number;
    width: number;
    height: number;
    /** 所在层级，思维导图是缩进级，流程图是拓扑层 */
    depth: number;
}

/** 布局后的连线 */
export interface DiagramEdge {
    from: string;
    to: string;
    /** 连线上的文字，如判断分支的"是/否" */
    label?: string;
}

/** 整张图的布局结果 */
export interface DiagramLayout {
    boxes: DiagramBox[];
    edges: DiagramEdge[];
    /** 画布宽高，SVG viewBox 用 */
    width: number;
    height: number;
}

/** 思维导图节点（树） */
export interface MindNode {
    id: string;
    label: string;
    children: MindNode[];
}

/** 流程图原始数据 */
export interface FlowGraph {
    nodes: Array<{ id: string; label: string; shape: DiagramShape }>;
    edges: DiagramEdge[];
}

const NODE_HEIGHT = 36;
const MIND_COL_WIDTH = 230;
const FLOW_COL_WIDTH = 190;
const ROW_GAP = 18;
const COL_GAP = 60;
const PADDING = 24;

/**
 * 估算文字宽度，中日韩全角算 1 个字号，西文算 0.55
 * @param text 文字
 * @param fontSize 字号
 * @returns 像素宽
 */
export function estimateTextWidth(text: string, fontSize = 13): number {
    let units = 0;
    for (const char of text) {
        // 0x2E80 以上按全角（中日韩）算 1 个字宽，其余按半个
        const code = char.codePointAt(0) ?? 0;
        units += code > 0x2e7f ? 1 : 0.55;
    }
    return Math.round(units * fontSize) + 24;
}

/**
 * 解析思维导图源文本（缩进的 - 列表）
 * @param source 源文本，两个空格一级
 * @returns 树根列表
 */
export function parseMindmap(source: string): MindNode[] {
    const roots: MindNode[] = [];
    // 栈里存"这一层最后一个节点"，缩进回退时出栈
    const stack: Array<{ level: number; node: MindNode }> = [];
    let sequence = 0;

    for (const rawLine of source.split('\n')) {
        const matched = rawLine.match(/^(\s*)[-*+]\s+(.+?)\s*$/);
        if (!matched) {
            continue;
        }
        // 制表符按 2 空格算，两个空格一级
        const indent = matched[1].replace(/\t/g, '  ').length;
        const level = Math.floor(indent / 2);
        const node: MindNode = { id: `m${sequence++}`, label: matched[2], children: [] };
        // 回退到父层
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            stack.pop();
        }
        const parent = stack[stack.length - 1];
        if (parent) {
            parent.node.children.push(node);
        } else {
            roots.push(node);
        }
        stack.push({ level, node });
    }
    return roots;
}

/**
 * 思维导图自动布局：叶子按行排开，父节点取子节点纵向中点
 * @param roots 树根列表
 * @returns 布局结果
 */
export function layoutMindmap(roots: MindNode[]): DiagramLayout {
    const boxes: DiagramBox[] = [];
    const edges: DiagramEdge[] = [];
    let nextRow = 0;

    /**
     * 递归摆一个子树
     * @param node 节点
     * @param depth 缩进级
     * @returns 该子树的纵向中心 y
     */
    function place(node: MindNode, depth: number): number {
        const width = estimateTextWidth(node.label);
        const x = PADDING + depth * MIND_COL_WIDTH;
        if (node.children.length === 0) {
            const y = PADDING + nextRow * (NODE_HEIGHT + ROW_GAP);
            nextRow += 1;
            boxes.push({ id: node.id, label: node.label, shape: 'round', x, y, width, height: NODE_HEIGHT, depth });
            return y + NODE_HEIGHT / 2;
        }
        const childCenters = node.children.map((child) => {
            const center = place(child, depth + 1);
            edges.push({ from: node.id, to: child.id });
            return center;
        });
        // 父节点对齐到首末子节点的中间
        const centerY = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
        boxes.push({
            id: node.id,
            label: node.label,
            shape: 'round',
            x,
            y: centerY - NODE_HEIGHT / 2,
            width,
            height: NODE_HEIGHT,
            depth,
        });
        return centerY;
    }

    for (const root of roots) {
        place(root, 0);
    }

    const width = Math.max(0, ...boxes.map((box) => box.x + box.width)) + PADDING;
    const height = Math.max(0, ...boxes.map((box) => box.y + box.height)) + PADDING;
    return { boxes, edges, width, height };
}

/**
 * 解析流程图源文本
 * 行格式：`A -> B`、`A -> B -> C`（链条）、`A -> B : 是`（连线文字）
 * 节点可带形状：`步骤[解析]`、`判断{合法?}`、`起止(开始)`
 * @param source 源文本
 * @returns 流程图原始数据
 */
export function parseFlow(source: string): FlowGraph {
    const nodes = new Map<string, { id: string; label: string; shape: DiagramShape }>();
    const edges: DiagramEdge[] = [];

    /**
     * 登记一个节点写法，形如 `id[label]` 或裸名字
     * @param token 节点写法
     * @returns 节点 id
     */
    function registerNode(token: string): string {
        // 全角括号也认，中文输入法友好
        const matched = token.match(/^(.+?)[\(\[\{（【｛](.+?)[\)\]\}）】｝]$/);
        let id = token.trim();
        let label = id;
        let shape: DiagramShape = 'rect';
        if (matched) {
            id = matched[1].trim();
            label = matched[2].trim();
            const bracket = token.match(/[\(\[\{（【｛]/)?.[0] ?? '[';
            shape = bracket === '(' || bracket === '（' ? 'round' : bracket === '{' || bracket === '｛' ? 'diamond' : 'rect';
        }
        if (!nodes.has(id)) {
            nodes.set(id, { id, label, shape });
        }
        return id;
    }

    for (const rawLine of source.split('\n')) {
        // 去掉 # 注释
        const line = rawLine.replace(/#.*$/, '').trim();
        if (line.length === 0) {
            continue;
        }
        // 连线文字在最后一段的 : 后面
        const [body, ...labelParts] = line.split(':');
        const edgeLabel = labelParts.join(':').trim();
        const parts = body.split('->').map((part) => part.trim()).filter((part) => part.length > 0);
        // 单节点行：登记孤立项（画板同步回来的孤立节点不会丢）
        if (parts.length === 1) {
            registerNode(parts[0]);
            continue;
        }
        for (let index = 0; index + 1 < parts.length; index += 1) {
            const from = registerNode(parts[index]);
            const to = registerNode(parts[index + 1]);
            // 链条中间的边不带文字，只有最后一段带
            const isLast = index === parts.length - 2;
            edges.push({ from, to, label: isLast && edgeLabel.length > 0 ? edgeLabel : undefined });
        }
    }
    return { nodes: [...nodes.values()], edges };
}

/**
 * 流程图自动布局：按拓扑层级自上而下排，起点是没有任何入边的节点
 * 有环也能画：第二次访问就不再往下传层
 * @param graph 流程图原始数据
 * @returns 布局结果
 */
export function layoutFlow(graph: FlowGraph): DiagramLayout {
    const { nodes, edges } = graph;
    const depthMap = new Map<string, number>();
    const incoming = new Set(edges.map((edge) => edge.to));
    // 入度为 0 的是起点；全是环就随便挑第一个
    const roots = nodes.filter((node) => !incoming.has(node.id));
    const startIds = roots.length > 0 ? roots.map((node) => node.id) : nodes.slice(0, 1).map((node) => node.id);

    for (const id of startIds) {
        depthMap.set(id, 0);
    }
    // 最长路径分层：重复扫到不动为止，轮数封顶防死循环
    for (let round = 0; round < nodes.length; round += 1) {
        let changed = false;
        for (const edge of edges) {
            const fromDepth = depthMap.get(edge.from);
            if (fromDepth === undefined) {
                continue;
            }
            const nextDepth = fromDepth + 1;
            if (nextDepth > (depthMap.get(edge.to) ?? -1)) {
                depthMap.set(edge.to, nextDepth);
                changed = true;
            }
        }
        if (!changed) {
            break;
        }
    }

    // 同层按首次出现顺序排
    const layers = new Map<number, string[]>();
    for (const node of nodes) {
        const depth = depthMap.get(node.id) ?? 0;
        const bucket = layers.get(depth) ?? [];
        bucket.push(node.id);
        layers.set(depth, bucket);
    }

    const boxes: DiagramBox[] = [];
    const sortedDepths = [...layers.keys()].sort((a, b) => a - b);
    sortedDepths.forEach((depth, row) => {
        const ids = layers.get(depth) ?? [];
        ids.forEach((id, column) => {
            const node = nodes.find((item) => item.id === id);
            if (!node) {
                return;
            }
            boxes.push({
                id: node.id,
                label: node.label,
                shape: node.shape,
                x: PADDING + column * (FLOW_COL_WIDTH + COL_GAP),
                y: PADDING + row * (NODE_HEIGHT * 2 + ROW_GAP + 30),
                width: Math.max(96, estimateTextWidth(node.label)),
                height: NODE_HEIGHT,
                depth,
            });
        });
    });

    const width = Math.max(0, ...boxes.map((box) => box.x + box.width)) + PADDING;
    const height = Math.max(0, ...boxes.map((box) => box.y + box.height)) + PADDING;
    return { boxes, edges, width, height };
}

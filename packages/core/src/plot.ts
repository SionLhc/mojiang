/**
 * 剧情编排画布：数据结构、序列化、AI 诊断协议
 *
 * 设计约束：
 * 1. 节点 id 一旦生成不再变，AI 建议要靠它定位
 * 2. AI 只能引用已有节点，编造的 id 直接丢弃
 * 3. 诊断结果必须能落到具体节点上，否则就是废话
 */

/** 节点类型 */
export type PlotNodeKind = 'setup' | 'turn' | 'climax' | 'foreshadow' | 'suspense';

/** 一个剧情节点 */
export interface PlotNode {
    /** 短 id，n1 / n2 …… */
    id: string;
    kind: PlotNodeKind;
    title: string;
    /** 一两句话，写清这场戏发生了什么 */
    summary: string;
    /** 关联的人设卡名字 */
    characters: string[];
    /** 绑定章节号，双击跳转 */
    chapter?: number;
    /** 伏笔节点关联的伏笔 id */
    foreshadowId?: string;
    x: number;
    y: number;
}

/** 连线语义 */
export type PlotEdgeKind = 'cause' | 'parallel' | 'foreshadow';

/** 一条连线 */
export interface PlotEdge {
    id: string;
    source: string;
    target: string;
    kind: PlotEdgeKind;
    /** 连线上显示的文字 */
    label?: string;
}

/** 整张图 */
export interface PlotGraph {
    nodes: PlotNode[];
    edges: PlotEdge[];
    updatedAt: string;
}

/** 节点类型的展示配置 */
export const PLOT_NODE_KINDS: Array<{
    kind: PlotNodeKind;
    name: string;
    /** 左侧色条与标签色 */
    color: string;
    /** 卡片底色（很淡） */
    tint: string;
}> = [
    { kind: 'setup', name: '铺垫', color: '#7c6bc4', tint: 'rgba(124, 107, 196, 0.08)' },
    { kind: 'turn', name: '转折', color: '#c4761f', tint: 'rgba(196, 118, 31, 0.08)' },
    { kind: 'climax', name: '高潮', color: '#bf3a2c', tint: 'rgba(191, 58, 44, 0.08)' },
    { kind: 'foreshadow', name: '伏笔', color: '#7a58a6', tint: 'rgba(122, 88, 166, 0.09)' },
    { kind: 'suspense', name: '悬念', color: '#23806a', tint: 'rgba(35, 128, 106, 0.08)' },
];

/** 连线类型的展示配置 */
export const PLOT_EDGE_KINDS: Array<{ kind: PlotEdgeKind; name: string }> = [
    { kind: 'cause', name: '因果推进' },
    { kind: 'parallel', name: '平行推进' },
    { kind: 'foreshadow', name: '伏笔关联' },
];

/**
 * 按类型取配色
 * @param kind 节点类型
 * @returns 配色配置
 */
export function plotKindStyle(kind: PlotNodeKind): (typeof PLOT_NODE_KINDS)[number] {
    return PLOT_NODE_KINDS.find((item) => item.kind === kind) ?? PLOT_NODE_KINDS[0];
}

/**
 * 生成下一个节点 id
 * @param nodes 现有节点
 * @returns 形如 n7
 */
export function nextPlotNodeId(nodes: PlotNode[]): string {
    let max = 0;
    for (const node of nodes) {
        const match = node.id.match(/^n(\d+)$/);
        if (match) {
            max = Math.max(max, Number.parseInt(match[1], 10));
        }
    }
    return `n${max + 1}`;
}

/**
 * 新建一个节点
 * @param kind 类型
 * @param x 坐标
 * @param y 坐标
 * @param id 指定 id，不传则用 n1
 * @returns 节点
 */
export function createPlotNode(
    kind: PlotNodeKind,
    x: number,
    y: number,
    id: string = 'n1',
): PlotNode {
    const name = plotKindStyle(kind).name;
    return {
        id,
        kind,
        title: `新的${name}`,
        summary: '',
        characters: [],
        x: Math.round(x),
        y: Math.round(y),
    };
}

/**
 * 把图序列化成给模型看的文本
 * 只给结构，不给正文，控制 token
 * @param graph 剧情图
 * @returns 文本
 */
export function serializePlotForPrompt(graph: PlotGraph): string {
    const lines: string[] = [];

    if (graph.nodes.length === 0) {
        return '（画布是空的）';
    }

    lines.push('【剧情节点】');
    for (const node of graph.nodes) {
        const kindName = plotKindStyle(node.kind).name;
        const characters = node.characters.length > 0 ? node.characters.join('、') : '未标注';
        const chapter = node.chapter ? ` | 第${node.chapter}章` : '';
        const summary = node.summary.trim().length > 0 ? node.summary.trim() : '（无摘要）';
        lines.push(`[${node.id}] ${kindName} | ${node.title} | ${summary} | 人物：${characters}${chapter}`);
    }

    lines.push('');
    lines.push('【关系】');
    if (graph.edges.length === 0) {
        lines.push('（没有连线）');
    } else {
        for (const edge of graph.edges) {
            const kindName = PLOT_EDGE_KINDS.find((item) => item.kind === edge.kind)?.name ?? '关联';
            const label = edge.label ? `：${edge.label}` : '';
            lines.push(`${edge.source} → ${edge.target}（${kindName}${label}）`);
        }
    }

    lines.push('');
    lines.push('【统计】');
    const kindCounts = PLOT_NODE_KINDS.map((item) => {
        const count = graph.nodes.filter((node) => node.kind === item.kind).length;
        return count > 0 ? `${item.name} ${count}` : '';
    }).filter((text) => text.length > 0);
    lines.push(`节点 ${graph.nodes.length} 个：${kindCounts.join('、') || '无'}`);

    const characterCounts = new Map<string, number>();
    for (const node of graph.nodes) {
        for (const name of node.characters) {
            characterCounts.set(name, (characterCounts.get(name) ?? 0) + 1);
        }
    }
    if (characterCounts.size > 0) {
        const text = [...characterCounts.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([name, count]) => `${name} ${count} 次`)
            .join('、');
        lines.push(`人物出现：${text}`);
    }

    return lines.join('\n');
}

/** 诊断问题的类型 */
export type PlotFindingKind =
    | 'pacing'
    | 'broken-chain'
    | 'weak-cause'
    | 'absence'
    | 'climax-position'
    | 'branch-overload';

/** 一条诊断结论 */
export interface PlotFinding {
    kind: PlotFindingKind;
    severity: 'info' | 'warn' | 'error';
    /** 涉及的节点，必须都是真实存在的 id */
    nodeIds: string[];
    message: string;
    suggestion: string;
}

/** 一次诊断结果 */
export interface PlotDiagnosis {
    structureScore: number;
    findings: PlotFinding[];
    /** 模型原始输出，解析失败时保留以便排查 */
    raw?: string;
    /** 被丢弃的条目数（引用不存在的节点） */
    dropped: number;
}

/** 合法的 finding kind */
const FINDING_KINDS: PlotFindingKind[] = [
    'pacing',
    'broken-chain',
    'weak-cause',
    'absence',
    'climax-position',
    'branch-overload',
];

/** 系统提示：只允许输出 JSON */
export const PLOT_SYSTEM_PROMPT = [
    '你是剧情结构分析器。用户给你一张剧情节点图，你只能基于给出的节点和连线分析。',
    '',
    '硬规则：',
    '1. 只能引用给出的节点 id，不得编造不存在的节点。',
    '2. 每条结论必须用 nodeIds 指明涉及哪些节点，否则不要输出。',
    '3. 不写"建议增加冲突""节奏可以更紧凑"这类空话，必须说清在哪两个节点之间、加什么、为什么。',
    '4. 没发现问题的维度不要硬凑，findings 可以是空数组。',
    '5. 只输出 JSON，不要任何解释文字、不要 markdown 代码块。',
    '',
    '评分：structureScore 0-100，只反映结构完整度（因果链是否闭合、节奏是否有起伏、伏笔是否有回收），不评价文笔。',
    '',
    '输出格式：',
    '{"structureScore":0,"findings":[{"kind":"pacing","severity":"warn","nodeIds":["n1","n2"],"message":"...","suggestion":"..."}]}',
    '',
    'kind 只能是：pacing（节奏）、broken-chain（断链）、weak-cause（因果薄弱）、absence（人物缺席）、climax-position（高潮位置）、branch-overload（支线过载）。',
    'severity 只能是：info / warn / error。',
].join('\n');

/**
 * 构造用户消息
 * @param graph 剧情图
 * @returns 提示词
 */
export function buildPlotUserPrompt(graph: PlotGraph): string {
    return [
        serializePlotForPrompt(graph),
        '',
        '请分析这张剧情图的结构，找出真实存在的问题。',
        '要求：每条结论必须指向具体节点；没有问题就返回空 findings，不要为了凑数编问题。',
    ].join('\n');
}

/**
 * 从模型输出里抠出 JSON
 * 模型经常包 ```json 或者加一两句解释，这里都容忍
 * @param raw 原始输出
 * @returns JSON 文本，失败返回 null
 */
function extractJson(raw: string): string | null {
    const trimmed = raw.trim();

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
        return fenced[1].trim();
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
        return trimmed.slice(start, end + 1);
    }

    return null;
}

/**
 * 解析诊断结果
 * @param raw 模型输出
 * @param validNodeIds 真实存在的节点 id
 * @returns 诊断结果；完全无法解析时返回 null
 */
export function parsePlotDiagnosis(raw: string, validNodeIds: string[]): PlotDiagnosis | null {
    const jsonText = extractJson(raw);
    if (!jsonText) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return null;
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return null;
    }

    const record = parsed as Record<string, unknown>;
    const validSet = new Set(validNodeIds);

    const rawScore = Number(record.structureScore);
    const structureScore = Number.isFinite(rawScore)
        ? Math.min(100, Math.max(0, Math.round(rawScore)))
        : 0;

    const findings: PlotFinding[] = [];
    let dropped = 0;

    const list = Array.isArray(record.findings) ? record.findings : [];
    for (const item of list) {
        if (typeof item !== 'object' || item === null) {
            dropped += 1;
            continue;
        }
        const entry = item as Record<string, unknown>;

        const kind = String(entry.kind ?? '');
        if (!FINDING_KINDS.includes(kind as PlotFindingKind)) {
            dropped += 1;
            continue;
        }

        const nodeIds = Array.isArray(entry.nodeIds)
            ? entry.nodeIds.map((id) => String(id)).filter((id) => validSet.has(id))
            : [];

        // 引用不到真实节点的结论没法定位，直接丢
        if (nodeIds.length === 0) {
            dropped += 1;
            continue;
        }

        const message = String(entry.message ?? '').trim();
        const suggestion = String(entry.suggestion ?? '').trim();
        if (message.length === 0) {
            dropped += 1;
            continue;
        }

        const severityRaw = String(entry.severity ?? 'warn');
        const severity: PlotFinding['severity'] =
            severityRaw === 'info' || severityRaw === 'error' ? severityRaw : 'warn';

        findings.push({
            kind: kind as PlotFindingKind,
            severity,
            nodeIds,
            message,
            suggestion,
        });
    }

    return { structureScore, findings, raw, dropped };
}

/**
 * 空图判断
 * @param graph 剧情图
 * @returns 是否为空
 */
export function isPlotGraphEmpty(graph: PlotGraph | null): boolean {
    return !graph || graph.nodes.length === 0;
}

/**
 * 剧情编排画布：数据结构、序列化、AI 诊断协议
 *
 * 设计约束：
 * 1. 节点 id 一旦生成不再变，AI 建议要靠它定位
 * 2. AI 只能引用已有节点，编造的 id 直接丢弃
 * 3. 诊断结果必须能落到具体节点上，否则就是废话
 */

import type { DiagramLayout } from './text/diagram';

/**
 * 节点类型
 * 分两组：剧情组给小说用，通用组给笔记/工作文档用
 */
export type PlotNodeKind =
    | 'setup'
    | 'turn'
    | 'climax'
    | 'foreshadow'
    | 'suspense'
    | 'idea'
    | 'task'
    | 'question'
    | 'note'
    | 'result';

/** 节点类型的分组 */
export type PlotNodeGroup = 'novel' | 'general';

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
    /** 属于哪一组 */
    group: PlotNodeGroup;
}> = [
    // 剧情组
    { kind: 'setup', name: '铺垫', color: '#7c6bc4', tint: 'rgba(124, 107, 196, 0.08)', group: 'novel' },
    { kind: 'turn', name: '转折', color: '#c4761f', tint: 'rgba(196, 118, 31, 0.08)', group: 'novel' },
    { kind: 'climax', name: '高潮', color: '#bf3a2c', tint: 'rgba(191, 58, 44, 0.08)', group: 'novel' },
    { kind: 'foreshadow', name: '伏笔', color: '#7a58a6', tint: 'rgba(122, 88, 166, 0.09)', group: 'novel' },
    { kind: 'suspense', name: '悬念', color: '#23806a', tint: 'rgba(35, 128, 106, 0.08)', group: 'novel' },
    // 通用组：笔记、工作文档、项目梳理
    { kind: 'idea', name: '想法', color: '#c4761f', tint: 'rgba(196, 118, 31, 0.08)', group: 'general' },
    { kind: 'task', name: '待办', color: '#2f6fb8', tint: 'rgba(47, 111, 184, 0.08)', group: 'general' },
    { kind: 'question', name: '问题', color: '#bf3a2c', tint: 'rgba(191, 58, 44, 0.08)', group: 'general' },
    { kind: 'note', name: '资料', color: '#6b7280', tint: 'rgba(107, 114, 128, 0.08)', group: 'general' },
    { kind: 'result', name: '结论', color: '#23806a', tint: 'rgba(35, 128, 106, 0.08)', group: 'general' },
];

/**
 * 取某个项目类型可用的节点类型
 * 小说用剧情组，其余一律用通用组
 * @param isNovel 是否小说项目
 * @returns 节点类型列表
 */
export function plotKindsFor(isNovel: boolean): typeof PLOT_NODE_KINDS {
    const group: PlotNodeGroup = isNovel ? 'novel' : 'general';
    return PLOT_NODE_KINDS.filter((item) => item.group === group);
}

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
export function serializePlotForPrompt(graph: PlotGraph, isNovel = true): string {
    const lines: string[] = [];
    /** 小说叫"人物"，通用画布叫"关联"，同一个字段 */
    const peopleLabel = isNovel ? '人物' : '关联';

    if (graph.nodes.length === 0) {
        return '（画布是空的）';
    }

    lines.push(isNovel ? '【剧情节点】' : '【画布节点】');
    for (const node of graph.nodes) {
        const kindName = plotKindStyle(node.kind).name;
        const characters = node.characters.length > 0 ? node.characters.join('、') : '未标注';
        const chapter = node.chapter ? ` | 第${node.chapter}章` : '';
        const summary = node.summary.trim().length > 0 ? node.summary.trim() : '（无摘要）';
        lines.push(`[${node.id}] ${kindName} | ${node.title} | ${summary} | ${peopleLabel}：${characters}${chapter}`);
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

/**
 * 诊断问题的类型
 * 前六个偏剧情分析，后两个通用（孤立节点、缺少支撑）
 */
export type PlotFindingKind =
    | 'pacing'
    | 'broken-chain'
    | 'weak-cause'
    | 'absence'
    | 'climax-position'
    | 'branch-overload'
    | 'isolated'
    | 'missing-support';

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
    'isolated',
    'missing-support',
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

/** 通用画布的系统提示：笔记、工作文档、项目梳理都用这套 */
export const CANVAS_SYSTEM_PROMPT = [
    '你是结构分析器。用户给你一张关系图（节点 + 连线），你只能基于给出的内容分析。',
    '',
    '硬规则：',
    '1. 只能引用给出的节点 id，不得编造不存在的节点。',
    '2. 每条结论必须用 nodeIds 指明涉及哪些节点，否则不要输出。',
    '3. 不写"建议补充内容""可以更清晰"这类空话，必须说清在哪两个节点之间、缺什么、为什么。',
    '4. 没发现问题的维度不要硬凑，findings 可以是空数组。',
    '5. 只输出 JSON，不要任何解释文字、不要 markdown 代码块。',
    '',
    '评分：structureScore 0-100，只反映信息组织是否完整（有没有孤立节点、有没有结论缺支撑、层次是否清晰），不评价内容本身写得好不好。',
    '',
    '输出格式：',
    '{"structureScore":0,"findings":[{"kind":"isolated","severity":"warn","nodeIds":["n1"],"message":"...","suggestion":"..."}]}',
    '',
    'kind 只能是：isolated（孤立节点）、missing-support（缺少支撑）、pacing（堆叠）、broken-chain（断链）、weak-cause（关系薄弱）、absence（关键信息缺失）、branch-overload（分支过多）。',
    'severity 只能是：info / warn / error。',
].join('\n');

/**
 * 构造用户消息
 * 小说走剧情分析，其余走通用结构分析
 * @param graph 画布数据
 * @param isNovel 是否小说项目
 * @returns 提示词
 */
export function buildCanvasUserPrompt(graph: PlotGraph, isNovel: boolean): string {
    const request = isNovel
        ? '请分析这张剧情图的结构，找出真实存在的问题。'
        : '请分析这张图的信息组织，找出真实存在的问题（孤立、断链、缺支撑、堆叠）。';
    return [
        serializePlotForPrompt(graph, isNovel),
        '',
        request,
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

/**
 * 把图表布局（思维导图/流程图）转成画板的节点和连线
 * 节点 id 从现有最大编号继续往后编，坐标整体偏移避免盖住已有节点
 * @param layout 图表布局结果
 * @param existing 现有画板节点，用于续编号和避让
 * @param kind 新节点的类型
 * @param edgeKind 连线语义：导图用平行，流程用因果
 * @returns 可以直接并进画布的节点与连线
 */
export function layoutToPlotItems(
    layout: DiagramLayout,
    existing: PlotNode[],
    kind: PlotNodeKind = 'idea',
    edgeKind: PlotEdgeKind = 'parallel',
): { nodes: PlotNode[]; edges: PlotEdge[] } {
    // 现有节点的最大右缘 + 间距 = 新图的起始 x，避免铺上去就重叠
    const maxRight = existing.reduce((max, node) => Math.max(max, node.x + 240), 0);
    const offsetX = existing.length > 0 ? maxRight + 80 : 0;

    // 布局里的 id（m0/流程 id）要换成画板的短 id（n1/n2…）
    const idMap = new Map<string, string>();
    const nodes: PlotNode[] = layout.boxes.map((box, index) => {
        const id = `n${existing.length + index + 1}`;
        idMap.set(box.id, id);
        return {
            id,
            kind,
            title: box.label,
            summary: '',
            characters: [],
            x: Math.round(box.x * 1.15 + offsetX),
            // 画板卡片比导图盒子高，纵向拉开放止贴在一起
            y: Math.round(box.y * 1.35),
        };
    });

    const edges: PlotEdge[] = [];
    layout.edges.forEach((edge, index) => {
        const source = idMap.get(edge.from);
        const target = idMap.get(edge.to);
        // 源头或目标不在本次转换里就丢掉，画板上不允许悬空线
        if (!source || !target) {
            return;
        }
        edges.push({
            id: `e-${source}-${target}-${index}`,
            source,
            target,
            kind: edgeKind,
            label: edge.label,
        });
    });

    return { nodes, edges };
}
